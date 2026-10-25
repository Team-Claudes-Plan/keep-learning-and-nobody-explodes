use std::time::Instant;

use apalis::prelude::{BoxDynError, Data};
use tracing::Instrument;
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
    let document_id = Uuid::parse_str(&job.id).map_err(|error| {
        tracing::error!(id = %job.id, error = %error, "chronicle id is not a UUID");
        anyhow::anyhow!("chronicle id `{}` is not a UUID: {error}", job.id)
    })?;

    let span = tracing::info_span!(
        "chronicle",
        id = %job.id,
        document_id = %document_id,
        island_id = %job.island_id,
        island = %job.island_name,
        language = %job.language,
        characters = job.text.len(),
    );

    let result = run_chronicle(job, pipeline, database.clone(), document_id)
        .instrument(span)
        .await;
    if result.is_err()
        && let Err(error) = database.mark_trials_failed(document_id).await
    {
        tracing::error!(document_id = %document_id, error = %error, "failed to record failed chronicle");
    }
    result
}

async fn run_chronicle(
    job: ChronicleJob,
    pipeline: AkashaPipeline,
    database: Database,
    document_id: Uuid,
) -> Result<(), BoxDynError> {
    let started = Instant::now();

    tracing::info!("chronicle processing started");

    // TODO: Implement some sort of lock so if multiple process jobs run in parallel,
    //  which might result in same skill names in different wordings, they can be written
    //  to the db without duplication
    let existing = database
        .topic_skills(job.island_id)
        .await
        .map_err(|error| {
            tracing::error!(
                island_id = %job.island_id,
                error = %error,
                "failed to load island topic catalog"
            );
            error
        })?;
    tracing::info!(
        island_id = %job.island_id,
        topics = existing.len(),
        skills = existing.iter().map(|topic| topic.skills.len()).sum::<usize>(),
        "loaded island topic catalog"
    );
    tracing::debug!(?existing, "existing topics and skills");

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
            tracing::error!(
                document_id = %document_id,
                island_id = %job.island_id,
                elapsed_ms = started.elapsed().as_millis(),
                error = %error,
                "pipeline aborted"
            );
            return Err(Box::new(error));
        }
    };

    let skill_count = topics.iter().map(|topic| topic.skills.len()).sum::<usize>();
    let question_count = topics
        .iter()
        .flat_map(|topic| &topic.skills)
        .map(|skill| skill.questions.len())
        .sum::<usize>();

    tracing::info!(
        topics = topics.len(),
        skills = skill_count,
        questions = question_count,
        elapsed_ms = started.elapsed().as_millis(),
        "pipeline completed"
    );

    tracing::info!(
        document_id = %document_id,
        island_id = %job.island_id,
        "persisting generated questions"
    );

    if let Err(error) = database
        .store_questions(document_id, job.island_id, &topics)
        .await
    {
        tracing::error!(
            document_id = %document_id,
            island_id = %job.island_id,
            error = %error,
            "failed to store generated questions"
        );
        return Err(Box::new(error));
    }

    tracing::info!(
        id = %job.id,
        document_id = %document_id,
        topics = topics.len(),
        skills = skill_count,
        questions = question_count,
        elapsed_ms = started.elapsed().as_millis(),
        "chronicle complete"
    );

    Ok(())
}
