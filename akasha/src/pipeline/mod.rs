//! Step-based agentic pipeline.
//!
//! Steps are deliberately not hard-wired into a straight sequence: a step can
//! jump to any other step on success or failure. The runner itself only knows
//! how to execute steps, count their failures and resolve step IDs.

use std::collections::HashMap;
use std::fmt;

use serde_json::Value;

pub mod error;
mod prompt;
pub mod schema;
mod steps;

pub use error::{PipelineError, StepError};
pub use schema::{Question, TopicQuestions};
pub use steps::{ExtractStep, ReviewStep, SchemaStep, Step};

/// Concrete pipeline used by the Akasha worker.
pub type AkashaPipeline = Pipeline<Step<crate::provider::Client>>;

/// Stable identifier of one pipeline step.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct StepId(&'static str);

impl StepId {
    #[must_use]
    pub const fn new(name: &'static str) -> Self {
        Self(name)
    }
}

impl fmt::Display for StepId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0)
    }
}

pub const EXTRACT: StepId = StepId::new("extract");
pub const SCHEMA: StepId = StepId::new("schema");
pub const REVIEW: StepId = StepId::new("review");

/// Input of one pipeline run.
#[derive(Clone, Debug)]
pub struct PipelineInput {
    pub id: String,
    pub language: String,
    /// Name of the island the document was uploaded to, as context.
    pub island_name: String,
    /// Topics the island already has; the extraction reuses them where they fit.
    pub existing_topics: Vec<String>,
    pub text: String,
}

/// Shared state passed to every step.
#[derive(Debug)]
pub struct PipelineContext {
    pub input: PipelineInput,
    /// JSON emitted by the extraction step.
    pub candidate: Option<Value>,
    /// Static and semantic validation result of the schema step.
    pub topics: Option<Vec<TopicQuestions>>,
    /// Human-readable error of the previous failed step, fed into the next
    /// extraction attempt.
    pub last_feedback: Option<String>,
}

impl PipelineContext {
    fn new(input: PipelineInput) -> Self {
        Self {
            input,
            candidate: None,
            topics: None,
            last_feedback: None,
        }
    }
}

/// What a successful step wants to do next.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StepOutcome {
    /// Continue with the next registered step.
    Next,
    /// Continue with an arbitrary step.
    #[allow(dead_code, reason = "future steps can jump to arbitrary steps")]
    Goto(StepId),
}

/// A failed step with its own retry target.
#[derive(Debug)]
pub struct StepFailure {
    pub error: Box<StepError>,
    pub retry: StepId,
}

impl StepFailure {
    #[must_use]
    pub fn new(error: impl Into<StepError>, retry: StepId) -> Self {
        Self {
            error: Box::new(error.into()),
            retry,
        }
    }
}

/// One unit of work in the pipeline.
///
/// This is a native async trait: the returned future is explicitly `Send`, so
/// the runner can be used from the Apalis worker without `async-trait` or
/// boxed futures.
pub trait PipelineStep: Send + Sync {
    fn id(&self) -> StepId;

    fn run<'a>(
        &'a self,
        context: &'a mut PipelineContext,
    ) -> impl Future<Output = Result<StepOutcome, StepFailure>> + Send + 'a;
}

/// Generic pipeline runner.
#[derive(Clone, Debug)]
pub struct Pipeline<S> {
    steps: Vec<S>,
    indexes: HashMap<StepId, usize>,
    max_step_errors: usize,
    max_transitions: usize,
}

impl<S: PipelineStep> Pipeline<S> {
    pub fn new(
        steps: Vec<S>,
        max_step_errors: usize,
        max_transitions: usize,
    ) -> Result<Self, PipelineError> {
        if steps.is_empty() {
            return Err(PipelineError::NoSteps);
        }

        let mut indexes = HashMap::with_capacity(steps.len());

        for (index, step) in steps.iter().enumerate() {
            let id = step.id();

            if indexes.insert(id, index).is_some() {
                return Err(PipelineError::DuplicateStep(id));
            }
        }

        Ok(Self {
            steps,
            indexes,
            max_step_errors,
            max_transitions,
        })
    }

    /// Runs the configured steps until a step finishes the pipeline.
    ///
    /// A step failure is counted against the step that produced it. If that
    /// count exceeds `max_step_errors`, the pipeline aborts and reports the
    /// step in [`PipelineError::StepErrorLimit`].
    pub async fn run(&self, input: PipelineInput) -> Result<Vec<TopicQuestions>, PipelineError> {
        let mut context = PipelineContext::new(input);
        let mut failures: HashMap<StepId, usize> = HashMap::new();
        let mut index = 0usize;
        let mut transitions = 0usize;

        loop {
            if transitions >= self.max_transitions {
                return Err(PipelineError::TransitionLimitExceeded {
                    limit: self.max_transitions,
                });
            }
            transitions += 1;

            let step = &self.steps[index];
            let id = step.id();

            tracing::debug!(step = %id, transition = transitions, "running pipeline step");

            match step.run(&mut context).await {
                Ok(StepOutcome::Next) => {
                    if index + 1 == self.steps.len() {
                        return context.topics.ok_or(PipelineError::MissingOutput);
                    }

                    index += 1;
                }
                Ok(StepOutcome::Goto(target)) => {
                    index = self.resolve(id, target)?;
                }
                Err(failure) => {
                    let count = {
                        let count = failures.entry(id).or_insert(0);
                        *count += 1;
                        *count
                    };

                    tracing::warn!(
                        step = %id,
                        attempt = count,
                        error = %failure.error,
                        "pipeline step failed"
                    );

                    if count > self.max_step_errors {
                        return Err(PipelineError::StepErrorLimit {
                            step: id,
                            limit: self.max_step_errors,
                            last_error: failure.error,
                        });
                    }

                    context.last_feedback = Some(failure.error.to_string());
                    index = self.resolve(id, failure.retry)?;
                }
            }
        }
    }

    fn resolve(&self, from: StepId, target: StepId) -> Result<usize, PipelineError> {
        self.indexes
            .get(&target)
            .copied()
            .ok_or(PipelineError::UnknownStep { from, target })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::Mutex;

    use super::error::ExtractError;
    use super::*;

    #[derive(Clone, Debug)]
    enum Action {
        Emit,
        Fail(StepId),
        Goto(StepId),
    }

    #[derive(Clone, Debug)]
    struct FakeStep {
        id: StepId,
        actions: std::sync::Arc<Mutex<VecDeque<Action>>>,
    }

    impl FakeStep {
        fn new(id: StepId, actions: impl IntoIterator<Item = Action>) -> Self {
            Self {
                id,
                actions: std::sync::Arc::new(Mutex::new(actions.into_iter().collect())),
            }
        }
    }

    impl PipelineStep for FakeStep {
        fn id(&self) -> StepId {
            self.id
        }

        fn run<'a>(
            &'a self,
            context: &'a mut PipelineContext,
        ) -> impl Future<Output = Result<StepOutcome, StepFailure>> + Send + 'a {
            let action = self
                .actions
                .lock()
                .expect("fake step mutex")
                .pop_front()
                .expect("fake step has no action left");

            std::future::ready(match action {
                Action::Emit => {
                    context.topics = Some(Vec::new());
                    Ok(StepOutcome::Next)
                }
                Action::Fail(retry) => Err(StepFailure::new(
                    StepError::Extract(ExtractError::EmptyInput),
                    retry,
                )),
                Action::Goto(target) => Ok(StepOutcome::Goto(target)),
            })
        }
    }

    fn input() -> PipelineInput {
        PipelineInput {
            id: "chronicle".to_owned(),
            language: "German".to_owned(),
            island_name: "island".to_owned(),
            existing_topics: Vec::new(),
            text: "source".to_owned(),
        }
    }

    #[tokio::test]
    async fn runs_steps_in_order() {
        let pipeline = Pipeline::new(
            vec![
                FakeStep::new(EXTRACT, [Action::Emit]),
                FakeStep::new(SCHEMA, [Action::Emit]),
            ],
            2,
            10,
        )
        .expect("valid pipeline");

        let topics = pipeline.run(input()).await.expect("pipeline succeeds");
        assert_eq!(topics, Vec::<TopicQuestions>::new());
    }

    #[tokio::test]
    async fn jumps_to_non_first_step_on_success() {
        let pipeline = Pipeline::new(
            vec![
                FakeStep::new(EXTRACT, [Action::Goto(REVIEW)]),
                FakeStep::new(SCHEMA, [Action::Fail(EXTRACT)]),
                FakeStep::new(REVIEW, [Action::Emit]),
            ],
            2,
            10,
        )
        .expect("valid pipeline");

        pipeline.run(input()).await.expect("jump skips schema");
    }

    #[tokio::test]
    async fn retries_at_the_failure_retry_target() {
        let pipeline = Pipeline::new(
            vec![
                FakeStep::new(EXTRACT, [Action::Emit, Action::Emit]),
                FakeStep::new(SCHEMA, [Action::Fail(EXTRACT), Action::Goto(REVIEW)]),
                FakeStep::new(REVIEW, [Action::Emit]),
            ],
            2,
            10,
        )
        .expect("valid pipeline");

        pipeline.run(input()).await.expect("retry recovers");
    }

    #[tokio::test]
    async fn aborts_when_a_step_exceeds_its_error_limit() {
        let pipeline = Pipeline::new(
            vec![FakeStep::new(
                SCHEMA,
                [
                    Action::Fail(SCHEMA),
                    Action::Fail(SCHEMA),
                    Action::Fail(SCHEMA),
                ],
            )],
            2,
            10,
        )
        .expect("valid pipeline");

        let error = pipeline
            .run(input())
            .await
            .expect_err("third failure aborts the pipeline");

        match error {
            PipelineError::StepErrorLimit { step, limit, .. } => {
                assert_eq!(step, SCHEMA);
                assert_eq!(limit, 2);
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn rejects_unknown_jump_targets() {
        let pipeline = Pipeline::new(vec![FakeStep::new(EXTRACT, [Action::Goto(REVIEW)])], 2, 10)
            .expect("valid pipeline");

        let error = pipeline
            .run(input())
            .await
            .expect_err("unknown target is an error");

        assert!(matches!(error, PipelineError::UnknownStep { .. }));
    }

    #[test]
    fn rejects_duplicate_step_ids() {
        assert!(matches!(
            Pipeline::new(
                vec![FakeStep::new(EXTRACT, []), FakeStep::new(EXTRACT, [])],
                2,
                10
            ),
            Err(PipelineError::DuplicateStep(EXTRACT))
        ));
    }

    #[test]
    fn rejects_empty_pipelines() {
        assert!(matches!(
            Pipeline::new(Vec::<FakeStep>::new(), 2, 10),
            Err(PipelineError::NoSteps)
        ));
    }
}
