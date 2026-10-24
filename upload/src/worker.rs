use apalis::prelude::{BoxDynError, Monitor, TaskSink, WorkerBuilder};
use apalis_postgres::{Config, PostgresStorage};
use sqlx::PgPool;

const OCR_QUEUE: &str = "ocr";

pub async fn run(pool: PgPool) -> Result<(), BoxDynError> {
    PostgresStorage::setup(&pool).await?;

    let mut backend =
        PostgresStorage::<()>::new(&pool).with_config(Config::default().queue(OCR_QUEUE));

    backend.push(()).await?;
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

async fn process_ocr(_job: ()) -> Result<(), BoxDynError> {
    println!("  processed proof-of-concept OCR job");
    Ok(())
}
