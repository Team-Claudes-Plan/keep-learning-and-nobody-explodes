//! Ingestion service.
//!
//! Accepts course material over HTTP, stores it in S3, and processes `RustFS`
//! object-created webhooks through a Postgres-backed OCR worker.

mod akasha;
mod api;
mod config;
mod db;
mod knowledge;
mod presence;
mod session;
mod upload;
mod webhook;
mod worker;

use crate::{akasha::AkashaClient, config::Config, db::Database};
use anyhow::{Context, Result};
use axum::{Router, routing::get};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[derive(Debug)]
pub struct GlobalState {
    pub db: Database,
    pub sessions: session::Sessions,
    pub presence: presence::Hub,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=debug")),
        )
        .init();

    let config = Config::from_env()?;
    let db = Database::connect(&config.database_url, 10).await?;
    db.migrate().await?;
    worker::setup(&db).await?;
    let backend = worker::backend(&db);
    let store = upload::ObjectStore::connect(&config.s3).await;
    let akasha = AkashaClient::lazy(&config.akasha_grpc_url, config.akasha_language)?;

    let state = Arc::new(GlobalState {
        db: db.clone(),
        sessions: session::Sessions::new(db.clone()),
        presence: presence::Hub::new(),
    });

    let app = Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .merge(upload::router(
            upload::Uploader::new(store.clone(), db.clone()),
            config.max_upload_bytes,
        ))
        .merge(webhook::router(webhook::WebhookState {
            db: db.clone(),
            backend: backend.clone(),
            bucket: config.s3.bucket.clone(),
            token: config.webhook_token,
        }))
        .merge(api::routes().with_state(Arc::clone(&state)))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive());

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
        worker::run(db, store, backend, akasha),
        presence::listener::run(state),
    )?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}
