use apalis::prelude::{BoxDynError, Data, Monitor, WorkerBuilder};
use apalis_postgres::{Config, PostgresStorage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use xberg::{ExtractInput, ExtractionConfig, extract};

use crate::{
    akasha::AkashaClient,
    db::Database,
    upload::{self, ObjectStore},
};

const OCR_QUEUE: &str = "ocr";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OcrJob {
    pub bucket: String,
    pub key: String,
    pub etag: Option<String>,
}

impl OcrJob {
    #[must_use]
    pub fn idempotency_key(&self) -> String {
        format!(
            "ocr:{}:{}:{}",
            self.bucket,
            self.key,
            self.etag.as_deref().unwrap_or("")
        )
    }

    /// The island the document belongs to, read from the object key.
    ///
    /// Not stored in the job: jobs already in the queue must keep decoding, and
    /// the key is the single source of truth for where a file was uploaded.
    #[must_use]
    pub fn island_id(&self) -> Option<Uuid> {
        upload::island_of_key(&self.key)
    }

    #[must_use]
    pub fn filename(&self) -> &str {
        self.key.rsplit('/').next().unwrap_or("document")
    }
}

pub type OcrBackend = PostgresStorage<OcrJob>;

pub fn backend(db: &Database) -> OcrBackend {
    PostgresStorage::new(db.pool()).with_config(Config::default().queue(OCR_QUEUE))
}

pub async fn setup(db: &Database) -> Result<(), apalis_postgres::Error> {
    PostgresStorage::setup(db.pool()).await
}

pub async fn run(
    db: Database,
    store: ObjectStore,
    backend: OcrBackend,
    akasha: AkashaClient,
) -> anyhow::Result<()> {
    Monitor::new()
        .register(move |_| {
            WorkerBuilder::new("ocr-worker")
                .backend(backend.clone())
                .data(db.clone())
                .data(store.clone())
                .data(akasha.clone())
                .build(process_ocr)
        })
        .run_with_signal(tokio::signal::ctrl_c())
        .await?;

    Ok(())
}

async fn process_ocr(
    job: OcrJob,
    Data(db): Data<Database>,
    Data(store): Data<ObjectStore>,
    Data(akasha): Data<AkashaClient>,
) -> Result<(), BoxDynError> {
    let Some(island_id) = job.island_id() else {
        // Queued before islands existed; retrying cannot give it an island.
        tracing::warn!(name: "ocr.skipped", key = %job.key, "object key does not name an island, skipping OCR job");
        return Ok(());
    };
    db.mark_processing(island_id, &job.bucket, &job.key, job.etag.as_deref())
        .await?;

    let text = match extract_and_save(&job, &db, &store).await {
        Ok(text) => text,
        Err(error) => {
            if let Err(db_error) = db
                .mark_failed(&job.bucket, &job.key, &error.to_string())
                .await
            {
                tracing::error!(error = %db_error, key = %job.key, "failed to record OCR error");
            }
            return Err(error);
        }
    };

    let Some(document_id) = db.document_id(&job.bucket, &job.key).await? else {
        return Err(std::io::Error::other("document row is missing").into());
    };
    let Some(island_name) = db.island_name(island_id).await? else {
        return Err(std::io::Error::other("island row is missing").into());
    };

    akasha
        .manifest_trials(document_id, island_id, &island_name, &text)
        .await?;

    tracing::info!(
        name: "ocr.completed",
        key = %job.key,
        island = %island_name,
        document_id = %document_id,
        "completed OCR job and sent chronicle to Akasha"
    );
    Ok(())
}

async fn extract_and_save(
    job: &OcrJob,
    db: &Database,
    store: &ObjectStore,
) -> Result<String, BoxDynError> {
    let object = store.get(&job.key).await?;
    let content_type = object
        .content_type
        .unwrap_or_else(|| "application/octet-stream".to_owned());
    let input = ExtractInput::from_bytes(
        object.bytes,
        content_type.clone(),
        Some(job.filename().to_owned()),
    );
    let config = ExtractionConfig::default();
    let output = Box::pin(extract(input, &config)).await?;

    if !output.errors.is_empty() {
        return Err(
            std::io::Error::other(format!("Xberg extraction failed: {:?}", output.errors)).into(),
        );
    }
    if output.results.is_empty() {
        return Err(std::io::Error::other("Xberg returned no document").into());
    }

    let text = output
        .results
        .into_iter()
        .map(|document| document.content)
        .collect::<Vec<_>>()
        .join("\n\n");
    db.mark_completed(&job.bucket, &job.key, job.filename(), &content_type, &text)
        .await?;
    Ok(text)
}
