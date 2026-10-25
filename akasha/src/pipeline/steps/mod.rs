//! Concrete pipeline steps and the enum that dispatches between them.
//!
//! Adding a step means adding a variant here and registering it in `main.rs`.
//! The runner itself does not need to change.

mod extract;
mod review;
mod schema;

pub use extract::ExtractStep;
pub use review::ReviewStep;
pub use schema::SchemaStep;

use crate::provider::Llm;

use super::{PipelineContext, PipelineStep, StepFailure, StepId, StepOutcome};

/// Enum dispatch keeps the native async trait usable without `dyn` or an
/// external async-trait crate.
#[derive(Clone, Debug)]
pub enum Step<L: Llm> {
    Extract(ExtractStep<L>),
    Schema(SchemaStep),
    Review(ReviewStep<L>),
}

impl<L: Llm> PipelineStep for Step<L> {
    fn id(&self) -> StepId {
        match self {
            Self::Extract(step) => step.id(),
            Self::Schema(step) => step.id(),
            Self::Review(step) => step.id(),
        }
    }

    async fn run<'a>(
        &'a self,
        context: &'a mut PipelineContext,
    ) -> Result<StepOutcome, StepFailure> {
        match self {
            Self::Extract(step) => step.run(context).await,
            Self::Schema(step) => step.run(context).await,
            Self::Review(step) => step.run(context).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::pipeline::error::{ExtractError, ReviewError, StepError};
    use crate::pipeline::{EXTRACT, PipelineInput};
    use crate::provider::{OutputFormat, ProviderError};

    #[derive(Clone, Debug)]
    struct FakeLlm {
        responses: Arc<Mutex<VecDeque<String>>>,
        calls: Arc<Mutex<Vec<(String, String)>>>,
    }

    impl FakeLlm {
        fn new(responses: impl IntoIterator<Item = &'static str>) -> Self {
            Self {
                responses: Arc::new(Mutex::new(
                    responses.into_iter().map(str::to_owned).collect(),
                )),
                calls: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn calls(&self) -> Vec<(String, String)> {
            self.calls.lock().expect("fake LLM calls").clone()
        }
    }

    impl Llm for FakeLlm {
        fn complete<'a>(
            &'a self,
            system: &'a str,
            user: &'a str,
            _temperature: f32,
            _format: OutputFormat,
        ) -> impl Future<Output = Result<String, ProviderError>> + Send + 'a {
            self.calls
                .lock()
                .expect("fake LLM calls")
                .push((system.to_owned(), user.to_owned()));

            let response = self
                .responses
                .lock()
                .expect("fake LLM responses")
                .pop_front()
                .expect("fake LLM has no response left");

            std::future::ready(Ok(response))
        }
    }

    fn context(text: &str) -> PipelineContext {
        PipelineContext {
            input: PipelineInput {
                id: "chronicle".to_owned(),
                language: "German".to_owned(),
                topic: "photosynthesis".to_owned(),
                text: text.to_owned(),
            },
            candidate: None,
            questions: None,
            last_feedback: None,
        }
    }

    #[tokio::test]
    async fn extract_step_stores_candidate_and_renders_prompt() {
        let llm = FakeLlm::new([
            r#"[{"type": "text_input", "prompt": "Frage", "correct_answer": "Antwort"}]"#,
        ]);
        let step = ExtractStep::new(llm.clone(), 5);
        let mut context = context("Pflanzen nutzen Licht.");

        let outcome = step.run(&mut context).await.expect("extraction succeeds");

        assert_eq!(outcome, StepOutcome::Next);
        assert!(context.candidate.expect("candidate").is_array());

        let calls = llm.calls();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].0.contains("German"));
        assert!(calls[0].0.contains('5'));
        assert!(calls[0].1.contains("Pflanzen nutzen Licht."));
    }

    #[tokio::test]
    async fn extract_step_passes_previous_feedback_to_the_llm() {
        let llm = FakeLlm::new(["[]"]);
        let step = ExtractStep::new(llm.clone(), 5);
        let mut context = context("source");
        context.last_feedback = Some("question 0 `prompt`: must not be empty".to_owned());

        step.run(&mut context).await.expect("extraction succeeds");

        let calls = llm.calls();
        assert!(calls[0].1.contains("question 0 `prompt`"));
    }

    #[tokio::test]
    async fn extract_step_rejects_non_array_json() {
        let llm = FakeLlm::new([r#"{"questions": []}"#]);
        let step = ExtractStep::new(llm, 5);
        let mut context = context("source");

        let failure = step
            .run(&mut context)
            .await
            .expect_err("object is not an array");

        assert_eq!(failure.retry, EXTRACT);
        assert!(matches!(
            *failure.error,
            StepError::Extract(ExtractError::NotAnArray)
        ));
    }

    #[tokio::test]
    async fn extract_step_rejects_empty_source() {
        let llm = FakeLlm::new(["[]"]);
        let step = ExtractStep::new(llm.clone(), 5);
        let mut context = context("   ");

        let failure = step
            .run(&mut context)
            .await
            .expect_err("empty source is not sent to the LLM");

        assert!(matches!(
            *failure.error,
            StepError::Extract(ExtractError::EmptyInput)
        ));
        assert_eq!(llm.calls(), Vec::<(String, String)>::new());
    }

    #[tokio::test]
    async fn review_step_accepts_valid_text() {
        let llm = FakeLlm::new([r#"{"valid": true, "issues": []}"#]);
        let step = ReviewStep::new(llm.clone());
        let mut context = context("source");
        context.questions = Some(Vec::new());

        let outcome = step.run(&mut context).await.expect("review succeeds");

        assert_eq!(outcome, StepOutcome::Next);
        let calls = llm.calls();
        assert!(calls[0].0.contains("German"));
    }

    #[tokio::test]
    async fn review_step_returns_review_issues_and_retries_extract() {
        let llm = FakeLlm::new([r#"{
            "valid": false,
            "issues": [
                {"question": 0, "field": "prompt", "reason": "contains gibberish"}
            ]
        }"#]);
        let step = ReviewStep::new(llm);
        let mut context = context("source");
        context.questions = Some(Vec::new());

        let failure = step
            .run(&mut context)
            .await
            .expect_err("review rejects the questions");

        assert_eq!(failure.retry, EXTRACT);
        match *failure.error {
            StepError::Review(ReviewError::Rejected(issues)) => {
                assert_eq!(issues.0.len(), 1);
                assert_eq!(issues.0[0].reason, "contains gibberish");
            }
            other => panic!("unexpected error: {other}"),
        }
    }
}
