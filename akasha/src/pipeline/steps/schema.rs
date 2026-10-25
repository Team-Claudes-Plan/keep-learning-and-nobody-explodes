//! Step 2: statically convert the JSON candidate into Rust questions.

use crate::pipeline::{
    EXTRACT, PipelineContext, PipelineStep, StepFailure, StepId, StepOutcome, error::SchemaError,
    schema,
};

/// Deserializes and validates the candidate without any LLM call.
#[derive(Clone, Copy, Debug, Default)]
pub struct SchemaStep;

impl PipelineStep for SchemaStep {
    fn id(&self) -> StepId {
        crate::pipeline::SCHEMA
    }

    fn run<'a>(
        &'a self,
        context: &'a mut PipelineContext,
    ) -> impl Future<Output = Result<StepOutcome, StepFailure>> + Send + 'a {
        std::future::ready(convert(context))
    }
}

fn convert(context: &mut PipelineContext) -> Result<StepOutcome, StepFailure> {
    let candidate = context
        .candidate
        .clone()
        .ok_or_else(|| StepFailure::new(SchemaError::NoCandidate, EXTRACT))?;

    let topics = schema::convert(&candidate)
        .map_err(|issues| StepFailure::new(SchemaError::Invalid(issues), EXTRACT))?;

    let canonical = serde_json::to_value(&topics)
        .map_err(|error| StepFailure::new(SchemaError::Serialize(error), EXTRACT))?;

    context.candidate = Some(canonical);
    context.topics = Some(topics);

    Ok(StepOutcome::Next)
}
