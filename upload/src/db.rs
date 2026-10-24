use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;

    sqlx::query("SELECT 1").execute(&pool).await?;

    Ok(pool)
}
