//! Ingestion service.
//!
//! Accepts course material (PDFs, images, ...) over HTTP and stores it in an
//! S3-compatible object store. OCR job enqueueing will follow.

mod config;
mod upload;

use anyhow::{Context, Result};
use axum::{Router, routing::get};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::config::Config;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=debug")),
        )
        .init();

    let config = Config::from_env()?;
    let store = upload::ObjectStore::connect(&config.s3).await;

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(upload::router(store, config.max_upload_bytes))
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&config.listen_addr)
        .await
        .with_context(|| format!("failed to bind {}", config.listen_addr))?;
    tracing::info!(name: "server.listening", addr = %config.listen_addr, "server listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            // Failing to install the handler only disables graceful shutdown.
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .context("server failed")
}
