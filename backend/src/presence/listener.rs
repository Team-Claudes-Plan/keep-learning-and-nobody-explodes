//! Forwards "a document finished processing" from Postgres to the user
//! channel. Akasha runs in its own process, so it cannot reach the hub; a
//! trigger on `documents` (migration 0008) notifies `island_documents` with
//! the island id instead.

use std::sync::Arc;

use anyhow::{Context, Result};
use sqlx::postgres::PgListener;
use uuid::Uuid;

use crate::GlobalState;

const CHANNEL: &str = "island_documents";

/// Runs until the process stops. `recv` reconnects on its own after a lost
/// connection; notifications sent in between are lost, and clients catch up
/// on their next island fetch.
pub async fn run(state: Arc<GlobalState>) -> Result<()> {
    let mut listener = PgListener::connect_with(state.db.pool())
        .await
        .context("failed to connect the island listener")?;
    listener
        .listen(CHANNEL)
        .await
        .context("failed to listen for island updates")?;

    loop {
        let notification = listener.recv().await.context("island listener failed")?;
        let Ok(island_id) = Uuid::parse_str(notification.payload()) else {
            tracing::warn!(
                payload = notification.payload(),
                "island update without an island id"
            );
            continue;
        };
        match state.db.content_audience(island_id).await {
            Ok(audience) => {
                tracing::info!(island_id = %island_id, users = audience.len(), "island updated");
                state.presence.island_updated(island_id, &audience);
            }
            Err(error) => {
                tracing::error!(island_id = %island_id, error = %error, "failed to load island audience");
            }
        }
    }
}
