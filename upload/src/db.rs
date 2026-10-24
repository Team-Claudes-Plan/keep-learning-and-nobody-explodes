//! Postgres connection pool setup.

use sqlx::postgres::{PgPool, PgPoolOptions};

/// Creates a connection pool for `database_url` and verifies it with a ping.
///
/// Connecting eagerly: if the database is unreachable, startup fails loudly
/// instead of the error surfacing in the first request. `PgPool` is internally
/// reference-counted and cheap to clone, so it can be shared freely and later
/// handed to axum as router state.
pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;

    // End-to-end check: exercises the query path, not just the socket.
    sqlx::query("SELECT 1").execute(&pool).await?;

    Ok(pool)
}
