use apalis::prelude::{BoxDynError, Data, Monitor, WorkerBuilder};
use apalis_postgres::{Config, PostgresStorage};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use xberg::{ExtractInput, ExtractionConfig, extract};

use crate::{db, upload::ObjectStore};

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

    #[must_use]
    pub fn filename(&self) -> &str {
        self.key.rsplit('/').next().unwrap_or("document")
    }
}

pub type OcrBackend = PostgresStorage<OcrJob>;

pub fn backend(pool: &PgPool) -> OcrBackend {
    PostgresStorage::new(pool).with_config(Config::default().queue(OCR_QUEUE))
}

pub async fn setup(pool: &PgPool) -> Result<(), apalis_postgres::Error> {
    PostgresStorage::setup(pool).await
}

pub async fn run(pool: PgPool, store: ObjectStore, backend: OcrBackend) -> anyhow::Result<()> {
    Monitor::new()
        .register(move |_| {
            WorkerBuilder::new("ocr-worker")
                .backend(backend.clone())
                .data(pool.clone())
                .data(store.clone())
                .build(process_ocr)
        })
        .run_with_signal(tokio::signal::ctrl_c())
        .await?;

    Ok(())
}

async fn process_ocr(
    job: OcrJob,
    Data(pool): Data<PgPool>,
    Data(store): Data<ObjectStore>,
) -> Result<(), BoxDynError> {
    db::mark_processing(&pool, &job.bucket, &job.key, job.etag.as_deref()).await?;

    if let Err(error) = extract_and_save(&job, &pool, &store).await {
        if let Err(db_error) =
            db::mark_failed(&pool, &job.bucket, &job.key, &error.to_string()).await
        {
            tracing::error!(error = %db_error, key = %job.key, "failed to record OCR error");
        }
        return Err(error);
    }

    tracing::info!(name: "ocr.completed", key = %job.key, "completed OCR job");
    Ok(())
}

async fn extract_and_save(
    job: &OcrJob,
    pool: &PgPool,
    store: &ObjectStore,
) -> Result<(), BoxDynError> {
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
    db::mark_completed(
        pool,
        &job.bucket,
        &job.key,
        job.filename(),
        &content_type,
        &text,
    )
    .await?;
    Ok(())
}
