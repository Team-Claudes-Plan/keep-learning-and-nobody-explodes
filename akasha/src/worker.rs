use anyhow::Context;
use apalis::prelude::{BoxDynError, Data};
use uuid::Uuid;

use crate::db::Database;
use crate::pipeline::{AkashaPipeline, PipelineInput};

#[derive(Clone, Debug)]
pub struct ChronicleJob {
    pub id: String,
    pub language: String,
    pub topic: String,
    pub text: String,
}

pub async fn process_chronicle(
    job: ChronicleJob,
    Data(pipeline): Data<AkashaPipeline>,
    Data(database): Data<Database>,
) -> Result<(), BoxDynError> {
    let document_id = Uuid::parse_str(&job.id)
        .with_context(|| format!("chronicle id `{}` is not a UUID", job.id))?;

    tracing::info!(
        id = %job.id,
        document_id = %document_id,
        language = %job.language,
        topic = %job.topic,
        characters = job.text.len(),
        "processing chronicle"
    );

    let input = PipelineInput {
        id: job.id.clone(),
        language: job.language,
        topic: job.topic,
        text: job.text,
    };

    let questions = match pipeline.run(input).await {
        Ok(questions) => questions,
        Err(error) => {
            tracing::error!(id = %job.id, error = %error, "pipeline aborted");
            return Err(Box::new(error));
        }
    };

    if let Err(error) = database.store_questions(document_id, &questions).await {
        tracing::error!(
            document_id = %document_id,
            error = %error,
            "failed to store generated questions"
        );
        return Err(Box::new(error));
    }

    tracing::info!(
        id = %job.id,
        document_id = %document_id,
        count = questions.len(),
        "stored generated questions"
    );

    Ok(())
}
