use sqlx::postgres::{PgPool, PgPoolOptions};

pub async fn connect(database_url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .connect(database_url)
        .await?;

    sqlx::query("SELECT 1").execute(&pool).await?;

    Ok(pool)
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

pub async fn mark_queued(
    pool: &PgPool,
    bucket: &str,
    key: &str,
    etag: Option<&str>,
    filename: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO documents (bucket, object_key, etag, filename)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (bucket, object_key) DO NOTHING",
    )
    .bind(bucket)
    .bind(key)
    .bind(etag)
    .bind(filename)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_processing(
    pool: &PgPool,
    bucket: &str,
    key: &str,
    etag: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO documents (bucket, object_key, etag, ocr_status)
         VALUES ($1, $2, $3, 'processing')
         ON CONFLICT (bucket, object_key) DO UPDATE SET
             ocr_status = 'processing',
             ocr_error = NULL,
             updated_at = now()",
    )
    .bind(bucket)
    .bind(key)
    .bind(etag)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_completed(
    pool: &PgPool,
    bucket: &str,
    key: &str,
    filename: &str,
    content_type: &str,
    text: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE documents
         SET filename = $3,
             content_type = $4,
             ocr_text = $5,
             ocr_status = 'completed',
             ocr_error = NULL,
             updated_at = now()
         WHERE bucket = $1 AND object_key = $2",
    )
    .bind(bucket)
    .bind(key)
    .bind(filename)
    .bind(content_type)
    .bind(text)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn mark_failed(
    pool: &PgPool,
    bucket: &str,
    key: &str,
    error: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE documents
         SET ocr_status = 'failed', ocr_error = $3, updated_at = now()
         WHERE bucket = $1 AND object_key = $2",
    )
    .bind(bucket)
    .bind(key)
    .bind(error)
    .execute(pool)
    .await?;
    Ok(())
}
