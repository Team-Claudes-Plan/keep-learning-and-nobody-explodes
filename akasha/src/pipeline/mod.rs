//! Step-based agentic pipeline.
//!
//! Steps are deliberately not hard-wired into a straight sequence: a step can
//! jump to any other step on success or failure. The runner itself only knows
//! how to execute steps, count their failures and resolve step IDs.

use std::collections::HashMap;
use std::fmt;
use std::time::Instant;

use serde_json::Value;

pub mod error;
mod prompt;
pub mod schema;
pub(crate) mod skill;
mod steps;

pub use error::{PipelineError, StepError};
pub use schema::{Question, TopicQuestions};
pub use skill::{ExistingTopic, TopicSkills};
pub use steps::{ExtractStep, ReviewStep, SchemaStep, SkillStep, Step};

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
pub const SKILL: StepId = StepId::new("skill");

/// Input of one pipeline run.
#[derive(Clone, Debug)]
pub struct PipelineInput {
    pub id: String,
    pub language: String,
    /// Name of the island the document was uploaded to, as context.
    pub island_name: String,
    /// Topics the island already has; the extraction reuses them where they fit.
    pub existing_topics: Vec<String>,
    /// Those topics with their existing skills, for the classification step.
    pub existing_skills: Vec<ExistingTopic>,
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
    /// Topics with their questions grouped into skills.
    pub skills: Option<Vec<TopicSkills>>,
    /// Human-readable error of the previous failed step, fed into the next
    /// attempt.
    pub last_feedback: Option<String>,
}

impl PipelineContext {
    fn new(input: PipelineInput) -> Self {
        Self {
            input,
            candidate: None,
            topics: None,
            skills: None,
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
    #[allow(
        clippy::too_many_lines,
        reason = "the runner is one small state machine; splitting it would obscure the control flow"
    )]
    pub async fn run(&self, input: PipelineInput) -> Result<Vec<TopicSkills>, PipelineError> {
        let mut context = PipelineContext::new(input);
        let mut failures: HashMap<StepId, usize> = HashMap::new();
        let mut index = 0usize;
        let mut transitions = 0usize;
        let pipeline_started = Instant::now();

        tracing::info!(
            chronicle = %context.input.id,
            island = %context.input.island_name,
            language = %context.input.language,
            characters = context.input.text.len(),
            existing_topics = context.input.existing_topics.len(),
            max_transitions = self.max_transitions,
            "pipeline started"
        );

        loop {
            if transitions >= self.max_transitions {
                tracing::error!(
                    limit = self.max_transitions,
                    transitions,
                    "pipeline aborted: transition limit exceeded"
                );
                return Err(PipelineError::TransitionLimitExceeded {
                    limit: self.max_transitions,
                });
            }
            transitions += 1;

            let step = &self.steps[index];
            let id = step.id();
            let attempt = failures.get(&id).map_or(1, |count| count + 1);
            let step_started = Instant::now();

            tracing::debug!(
                step = %id,
                transition = transitions,
                attempt,
                "pipeline step starting"
            );

            match step.run(&mut context).await {
                Ok(outcome) => {
                    tracing::info!(
                        step = %id,
                        transition = transitions,
                        attempt,
                        elapsed_ms = step_started.elapsed().as_millis(),
                        outcome = ?outcome,
                        "pipeline step completed"
                    );

                    match outcome {
                        StepOutcome::Next => {
                            context.last_feedback = None;

                            if index + 1 == self.steps.len() {
                                let topics = context.skills.ok_or_else(|| {
                                    tracing::error!(
                                        transitions,
                                        "pipeline finished without skill-grouped questions"
                                    );
                                    PipelineError::MissingOutput
                                })?;
                                tracing::info!(
                                    transitions,
                                    elapsed_ms = pipeline_started.elapsed().as_millis(),
                                    topics = topics.len(),
                                    skills = topics
                                        .iter()
                                        .map(|topic| topic.skills.len())
                                        .sum::<usize>(),
                                    questions = topics
                                        .iter()
                                        .flat_map(|topic| &topic.skills)
                                        .map(|skill| skill.questions.len())
                                        .sum::<usize>(),
                                    "pipeline finished"
                                );
                                return Ok(topics);
                            }

                            index += 1;
                            tracing::debug!(
                                transition = transitions,
                                next_step = %self.steps[index].id(),
                                "pipeline advancing"
                            );
                        }
                        StepOutcome::Goto(target) => {
                            context.last_feedback = None;
                            tracing::debug!(
                                step = %id,
                                target = %target,
                                "pipeline jumping"
                            );
                            index = self.resolve(id, target)?;
                        }
                    }
                }
                Err(failure) => {
                    let elapsed_ms = step_started.elapsed().as_millis();
                    let count = {
                        let count = failures.entry(id).or_insert(0);
                        *count += 1;
                        *count
                    };

                    tracing::warn!(
                        step = %id,
                        transition = transitions,
                        attempt = count,
                        elapsed_ms = elapsed_ms,
                        retry = %failure.retry,
                        error = %failure.error,
                        "pipeline step failed"
                    );

                    if count > self.max_step_errors {
                        tracing::error!(
                            step = %id,
                            error_limit = self.max_step_errors,
                            attempts = count,
                            "pipeline aborted: step error limit exceeded"
                        );
                        return Err(PipelineError::StepErrorLimit {
                            step: id,
                            limit: self.max_step_errors,
                            last_error: failure.error,
                        });
                    }

                    context.last_feedback = Some(failure.error.to_string());
                    index = self.resolve(id, failure.retry)?;
                    tracing::info!(
                        step = %id,
                        retry = %failure.retry,
                        attempt = count,
                        "retrying pipeline step"
                    );
                }
            }
        }
    }

    fn resolve(&self, from: StepId, target: StepId) -> Result<usize, PipelineError> {
        self.indexes.get(&target).copied().ok_or_else(|| {
            tracing::error!(
                from = %from,
                target = %target,
                "pipeline jump target does not exist"
            );
            PipelineError::UnknownStep { from, target }
        })
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
                    context.skills = Some(Vec::new());
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
            existing_skills: Vec::new(),
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
        assert_eq!(topics, Vec::<TopicSkills>::new());
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
