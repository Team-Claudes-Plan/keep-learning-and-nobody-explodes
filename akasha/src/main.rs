use std::net::Ipv4Addr;
use std::net::SocketAddr;
use std::process::exit;

pub(crate) mod db;
pub(crate) mod pipeline;
pub(crate) mod provider;
pub(crate) mod service;
pub(crate) mod worker;

use service::Akasha;
use worker::process_chronicle;

use apalis::prelude::{Monitor, WorkerBuilder, WorkerBuilderExt};
use apalis_core::backend::dequeue::VecDequeBackend;
use config::{Config, define_config};
use grpc::akasha::akasha_service_server::AkashaServiceServer;
use tonic::transport::Server;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

use crate::db::Database;
use crate::pipeline::{
    AkashaPipeline, ExtractStep, Pipeline, ReviewStep, SchemaStep, SkillStep, Step,
};
use crate::provider::Client;

define_config!(AkashaConfig {
    address("ADDRESS"): SocketAddr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 50051)),
    concurrency("CONCURRENCY"): usize = 8,
    database_url("DATABASE_URL"): String,
    llm_base_url("LLM_BASE_URL"): String,
    llm_api_key("LLM_API_KEY"): String,
    llm_model("LLM_MODEL"): String,
    pipeline_max_step_errors("PIPELINE_MAX_STEP_ERRORS"): usize = 3,
    pipeline_max_questions("PIPELINE_MAX_QUESTIONS"): usize = 10,
    pipeline_max_transitions("PIPELINE_MAX_TRANSITIONS"): usize = 100,
});

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if let Err(e) = init().await {
        error!("Failed to start: {e}");
        exit(1);
    }
}

async fn init() -> anyhow::Result<()> {
    info!("Starting Akasha");

    let config = AkashaConfig::init()?;

    info!(
        address = %config.address,
        concurrency = config.concurrency,
        llm_base_url = %config.llm_base_url,
        llm_model = %config.llm_model,
        max_questions = config.pipeline_max_questions,
        max_step_errors = config.pipeline_max_step_errors,
        max_transitions = config.pipeline_max_transitions,
        "Akasha configuration loaded"
    );

    let database = Database::connect(&config.database_url, 5).await?;
    let client = Client::new(&config.llm_base_url, &config.llm_api_key, &config.llm_model);

    let pipeline: AkashaPipeline = Pipeline::new(
        vec![
            Step::Extract(ExtractStep::new(
                client.clone(),
                config.pipeline_max_questions,
            )),
            Step::Schema(SchemaStep),
            Step::Review(ReviewStep::new(client.clone())),
            Step::Skill(SkillStep::new(client)),
        ],
        config.pipeline_max_step_errors,
        config.pipeline_max_transitions,
    )?;

    info!(
        pipeline = "extract -> schema -> review -> skill",
        "Akasha pipeline configured"
    );

    let concurrency = config.concurrency;

    let storage = VecDequeBackend::new();
    let worker_storage = storage.clone();

    let monitor = Monitor::new().register(move |_| {
        WorkerBuilder::new("akasha-llm-worker")
            .backend(worker_storage.clone())
            .concurrency(concurrency)
            .data(pipeline.clone())
            .data(database.clone())
            .build(process_chronicle)
    });

    tokio::spawn(async move {
        info!(
            worker = "akasha-llm-worker",
            concurrency, "starting worker monitor"
        );

        if let Err(e) = monitor.run().await {
            error!("Failed to run monitor: {e}");
        }
    });

    let service = Akasha::new(storage);

    let server = Server::builder().add_service(AkashaServiceServer::new(service));

    info!(address = %config.address, "Akasha gRPC server listening");
    Ok(server.serve(config.address).await?)
}
