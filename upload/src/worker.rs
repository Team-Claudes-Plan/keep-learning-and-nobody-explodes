use apalis::prelude::{BoxDynError, Monitor, TaskSink, WorkerBuilder};
use apalis_postgres::{Config, PostgresStorage};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use xberg::{ExtractInput, ExtractionConfig, extract};

const OCR_QUEUE: &str = "ocr";

#[derive(Debug, Serialize, Deserialize)]
struct OcrJob {
    uri: String,
}

pub async fn run(pool: PgPool, poc_uri: String) -> Result<(), BoxDynError> {
    PostgresStorage::setup(&pool).await?;

    let mut backend =
        PostgresStorage::<OcrJob>::new(&pool).with_config(Config::default().queue(OCR_QUEUE));

    backend.push(OcrJob { uri: poc_uri }).await?;
    println!("  enqueued proof-of-concept OCR job");

    Monitor::new()
        .register(move |_| {
            WorkerBuilder::new("ocr-worker")
                .backend(backend.clone())
                .build(process_ocr)
        })
        .run_with_signal(tokio::signal::ctrl_c())
        .await?;

    Ok(())
}

async fn process_ocr(job: OcrJob) -> Result<(), BoxDynError> {
    let config = ExtractionConfig::default();
    let output = Box::pin(extract(ExtractInput::from_uri(job.uri), &config)).await?;
    let document = output.results.first().ok_or_else(|| {
        std::io::Error::other(format!("Xberg returned no document: {:?}", output.errors))
    })?;

    println!("{}", document.content);
    Ok(())
}
