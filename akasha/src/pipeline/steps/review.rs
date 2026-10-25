//! Step 3: let the LLM judge language and text quality.

use serde::Deserialize;

use crate::pipeline::{
    EXTRACT, PipelineContext, PipelineStep, StepFailure, StepId, StepOutcome,
    error::{ReviewError, ReviewIssue, ReviewIssues},
    prompt,
};
use crate::provider::{Llm, OutputFormat};

#[derive(Debug, Deserialize)]
struct ReviewVerdict {
    valid: bool,
    #[serde(default)]
    issues: Vec<ReviewIssue>,
}

/// Reviews the statically validated questions for language and text quality.
#[derive(Clone, Debug)]
pub struct ReviewStep<L: Llm> {
    llm: L,
}

impl<L: Llm> ReviewStep<L> {
    #[must_use]
    pub fn new(llm: L) -> Self {
        Self { llm }
    }
}

impl<L: Llm> PipelineStep for ReviewStep<L> {
    fn id(&self) -> StepId {
        crate::pipeline::REVIEW
    }

    async fn run<'a>(
        &'a self,
        context: &'a mut PipelineContext,
    ) -> Result<StepOutcome, StepFailure> {
        let questions = context
            .questions
            .as_ref()
            .ok_or_else(|| StepFailure::new(ReviewError::MissingQuestions, EXTRACT))?;

        let questions = serde_json::to_string_pretty(questions)
            .map_err(|error| StepFailure::new(ReviewError::Serialize(error), EXTRACT))?;

        let system = prompt::render(
            prompt::REVIEW,
            &[("language", context.input.language.as_str())],
        );
        let user = format!(
            "Topic: {}\nTarget language: {}\n\nQuestions to review:\n{}",
            context.input.topic, context.input.language, questions
        );

        let response = self
            .llm
            .complete(&system, &user, 0.0, OutputFormat::JsonObject)
            .await
            .map_err(|error| StepFailure::new(ReviewError::Llm(error), EXTRACT))?;

        if response.trim().is_empty() {
            return Err(StepFailure::new(ReviewError::EmptyResponse, EXTRACT));
        }

        let value = prompt::parse_json_response(&response)
            .map_err(|error| StepFailure::new(ReviewError::InvalidResponse(error), EXTRACT))?;
        let verdict = serde_json::from_value::<ReviewVerdict>(value)
            .map_err(|error| StepFailure::new(ReviewError::InvalidResponse(error), EXTRACT))?;

        if verdict.valid && verdict.issues.is_empty() {
            return Ok(StepOutcome::Next);
        }

        let issues = if verdict.issues.is_empty() {
            vec![ReviewIssue {
                question: None,
                field: None,
                reason: "reviewer did not accept the questions".to_owned(),
            }]
        } else {
            verdict.issues
        };

        Err(StepFailure::new(
            ReviewError::Rejected(ReviewIssues(issues)),
            EXTRACT,
        ))
    }
}
