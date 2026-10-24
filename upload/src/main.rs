//! Ingestion service.
//!
//! Accepts course material over HTTP, stores it in S3, and processes `RustFS`
//! object-created webhooks through a Postgres-backed OCR worker.

mod config;
mod db;
mod upload;
mod webhook;
mod worker;

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
    let pool = db::connect(&config.database_url, 10).await?;
    db::migrate(&pool).await?;
    worker::setup(&pool).await?;
    let backend = worker::backend(&pool);
    let store = upload::ObjectStore::connect(&config.s3).await;

    let app = Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .merge(upload::router(store.clone(), config.max_upload_bytes))
        .merge(webhook::router(webhook::WebhookState {
            pool: pool.clone(),
            backend: backend.clone(),
            bucket: config.s3.bucket.clone(),
            token: config.webhook_token,
        }))
        .layer(TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(&config.listen_addr)
        .await
        .with_context(|| format!("failed to bind {}", config.listen_addr))?;
    tracing::info!(name: "server.listening", addr = %config.listen_addr, "server listening");

    let server = axum::serve(listener, app).with_graceful_shutdown(async {
        // Failing to install the handler only disables graceful shutdown.
        let _ = tokio::signal::ctrl_c().await;
    });

    tokio::try_join!(
        async { server.await.context("server failed") },
        worker::run(pool, store, backend),
    )?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
