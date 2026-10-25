use anyhow::Context;
use apalis::prelude::{BoxDynError, Data};
use uuid::Uuid;

use crate::db::Database;
use crate::pipeline::{AkashaPipeline, PipelineInput};

#[derive(Clone, Debug)]
pub struct ChronicleJob {
    pub id: String,
    pub language: String,
    /// Island that owns the document and receives the generated topics.
    pub island_id: Uuid,
    pub island_name: String,
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
        island_id = %job.island_id,
        island = %job.island_name,
        characters = job.text.len(),
        "processing chronicle"
    );

    // TODO: Implement some sort of lock so if multiple process jobs run in parallel,
    //  which might result in same skill names in different wordings, they can be written
    //  to the db without duplication
    let existing = database.topic_skills(job.island_id).await?;
    let existing_topics = existing
        .iter()
        .map(|topic| topic.topic.clone())
        .collect::<Vec<_>>();

    let input = PipelineInput {
        id: job.id.clone(),
        language: job.language,
        island_name: job.island_name,
        existing_topics,
        existing_skills: existing,
        text: job.text,
    };

    let topics = match pipeline.run(input).await {
        Ok(topics) => topics,
        Err(error) => {
            tracing::error!(id = %job.id, error = %error, "pipeline aborted");
            return Err(Box::new(error));
        }
    };

    if let Err(error) = database
        .store_questions(document_id, job.island_id, &topics)
        .await
    {
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
        topics = topics.len(),
        skills = topics
            .iter()
            .map(|topic| topic.skills.len())
            .sum::<usize>(),
        count = topics
            .iter()
            .flat_map(|topic| &topic.skills)
            .map(|skill| skill.questions.len())
            .sum::<usize>(),
        "stored generated questions"
    );

    Ok(())
}
