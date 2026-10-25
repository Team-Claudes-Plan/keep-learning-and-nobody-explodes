//! Step 1: turn raw chronicle text into a JSON candidate with the LLM.

use crate::pipeline::{
    EXTRACT, PipelineContext, PipelineStep, StepFailure, StepId, StepOutcome, error::ExtractError,
    prompt, schema::TYPES,
};
use crate::provider::{Llm, OutputFormat};

const IMAGE_SECTION: &str = "Only use an image location that is explicitly provided or allowed by the source material. \
     Never invent an image URL.";

/// Renders the extraction prompt and asks the LLM for a JSON question array.
#[derive(Clone, Debug)]
pub struct ExtractStep<L: Llm> {
    llm: L,
    max_questions: usize,
}

impl<L: Llm> ExtractStep<L> {
    #[must_use]
    pub fn new(llm: L, max_questions: usize) -> Self {
        Self { llm, max_questions }
    }
}

impl<L: Llm> PipelineStep for ExtractStep<L> {
    fn id(&self) -> StepId {
        EXTRACT
    }

    async fn run<'a>(
        &'a self,
        context: &'a mut PipelineContext,
    ) -> Result<StepOutcome, StepFailure> {
        if context.input.text.trim().is_empty() {
            return Err(StepFailure::new(ExtractError::EmptyInput, EXTRACT));
        }

        let max_questions = self.max_questions.to_string();
        let allowed_types = TYPES.join(", ");
        let topic_context = format!(
            "The source material belongs to the course topic \"{}\".",
            context.input.topic
        );
        let system = prompt::render(
            prompt::EXTRACTION,
            &[
                ("language", context.input.language.as_str()),
                ("max_questions", max_questions.as_str()),
                ("allowed_types", allowed_types.as_str()),
                ("image_section", IMAGE_SECTION),
                ("topic_context", topic_context.as_str()),
            ],
        );

        let mut user = format!(
            "Chronicle id: {}\nTopic: {}\nTarget language: {}\n\n\
             Source material:\n<<<\n{}\n>>>\n",
            context.input.id, context.input.topic, context.input.language, context.input.text
        );

        if let Some(feedback) = &context.last_feedback {
            user.push_str(
                "\nThe previous attempt was rejected for these reasons. \
                 Fix every issue and return the complete JSON array again:\n",
            );
            user.push_str(feedback);
            user.push('\n');
        }

        let response = self
            .llm
            .complete(&system, &user, 0.2, OutputFormat::Text)
            .await
            .map_err(|error| StepFailure::new(ExtractError::Llm(error), EXTRACT))?;

        if response.trim().is_empty() {
            return Err(StepFailure::new(ExtractError::EmptyResponse, EXTRACT));
        }

        let candidate = prompt::parse_json_response(&response)
            .map_err(|error| StepFailure::new(ExtractError::InvalidJson(error), EXTRACT))?;

        if !candidate.is_array() {
            return Err(StepFailure::new(ExtractError::NotAnArray, EXTRACT));
        }

        context.candidate = Some(candidate);

        Ok(StepOutcome::Next)
    }
}
