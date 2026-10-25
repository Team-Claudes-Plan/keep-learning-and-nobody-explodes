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

    tracing::debug!(
        chronicle = %context.input.id,
        groups = candidate.as_array().map_or(0, Vec::len),
        "validating candidate schema"
    );

    let topics = schema::convert(&candidate)
        .map_err(|issues| StepFailure::new(SchemaError::Invalid(issues), EXTRACT))?;

    let canonical = serde_json::to_value(&topics)
        .map_err(|error| StepFailure::new(SchemaError::Serialize(error), EXTRACT))?;

    let question_count = topics
        .iter()
        .map(|topic| topic.questions.len())
        .sum::<usize>();
    tracing::info!(
        chronicle = %context.input.id,
        topics = topics.len(),
        questions = question_count,
        "schema validation passed"
    );
    tracing::debug!(
        chronicle = %context.input.id,
        topics = ?topics.iter().map(|topic| topic.topic.as_str()).collect::<Vec<_>>(),
        "validated topics"
    );

    context.candidate = Some(canonical);
    context.topics = Some(topics);

    Ok(StepOutcome::Next)
}
