use std::net::Ipv4Addr;
use std::net::SocketAddr;
use std::process::exit;

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

use crate::provider::Client;

define_config!(AkashaConfig {
    address("ADDRESS"): SocketAddr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 50051)),
    concurrency("CONCURRENCY"): usize = 8,
    llm_base_url("LLM_BASE_URL"): String,
    llm_api_key("LLM_API_KEY"): String,
    llm_model("LLM_MODEL"): String,
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

    let client = Client::new();
    let concurrency = config.concurrency;

    let storage = VecDequeBackend::new();
    let worker_storage = storage.clone();

    let monitor = Monitor::new().register(move |_| {
        WorkerBuilder::new("akasha-llm-worker")
            .backend(worker_storage.clone())
            .concurrency(concurrency)
            .data(client.clone())
            .build(process_chronicle)
    });

    tokio::spawn(async move {
        info!("Running Monitor");

        if let Err(e) = monitor.run().await {
            error!("Failed to run monitor: {e}");
        }
    });

    let service = Akasha::new(storage);

    let server = Server::builder().add_service(AkashaServiceServer::new(service));

    Ok(server.serve(config.address).await?)
}
