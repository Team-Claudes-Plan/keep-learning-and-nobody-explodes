//! HTTP endpoint that stores uploaded course material in the object store.
//!
//! [`router`] exposes `POST /upload`, which accepts `multipart/form-data`.
//! Every part carrying a filename is written to
//! `uploads/<uuid>/<sanitized-filename>`; other form fields are ignored.
//!
//! File bytes are spooled to a temporary file one chunk at a time and then
//! streamed to the object store. A request therefore does not retain the whole
//! file in memory, and concurrent uploads cannot multiply the body limit into
//! a larger resident set.

mod error;
mod store;

use std::path::PathBuf;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, State, multipart::Field},
    routing::post,
};
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

pub use error::UploadError;
pub use store::ObjectStore;

/// Content type assumed when a part does not declare one.
const FALLBACK_CONTENT_TYPE: &str = "application/octet-stream";

/// Filename used when the client-supplied one sanitizes to nothing.
const FALLBACK_FILENAME: &str = "file";

/// Object stored by a successful upload.
#[derive(Debug, Serialize)]
pub struct StoredObject {
    /// Object key within the bucket.
    pub key: String,
    /// Filename as sent by the client.
    pub filename: String,
    /// Content type of the stored object.
    pub content_type: String,
    /// Size in bytes.
    pub size: usize,
}

/// Response body of `POST /upload`.
#[derive(Debug, Serialize)]
pub struct UploadResponse {
    /// All files stored by the request, in request order.
    pub objects: Vec<StoredObject>,
}

/// Builds the upload routes, rejecting bodies larger than `max_body_bytes`.
pub fn router(store: ObjectStore, max_body_bytes: usize) -> Router {
    Router::new()
        .route("/upload", post(upload))
        .layer(DefaultBodyLimit::max(max_body_bytes))
        .with_state(store)
}

async fn upload(
    State(store): State<ObjectStore>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, UploadError> {
    let mut objects = Vec::new();

    while let Some(mut field) = multipart.next_field().await? {
        let Some(filename) = field.file_name().map(str::to_owned) else {
            continue;
        };
        let content_type = field
            .content_type()
            .unwrap_or(FALLBACK_CONTENT_TYPE)
            .to_owned();
        // Hold at most one chunk in memory; the rest of the part lives on disk.
        let spooled = spool_field(&mut field).await?;
        let size = spooled.len;

        let key = format!(
            "uploads/{}/{}",
            Uuid::new_v4(),
            sanitize_filename(&filename)
        );
        store.put(&key, &content_type, &spooled.path, size).await?;

        tracing::info!(name: "upload.stored", key = %key, size, "stored uploaded file");
        objects.push(StoredObject {
            key,
            filename,
            content_type,
            size,
        });
    }

    if objects.is_empty() {
        return Err(UploadError::invalid_request(
            "no file part found in request",
        ));
    }
    Ok(Json(UploadResponse { objects }))
}

/// A file part written to disk so it can be streamed to the object store.
///
/// Dropping the value removes the temporary file, including when upload fails.
struct SpooledFile {
    path: PathBuf,
    len: usize,
}

impl Drop for SpooledFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Copies `field` to a temporary file without collecting it into one buffer.
///
/// # Errors
///
/// Returns a multipart error when the part cannot be read, or a storage error
/// when the temporary file cannot be created or written.
async fn spool_field(field: &mut Field<'_>) -> Result<SpooledFile, UploadError> {
    let path = std::env::temp_dir().join(format!("upload-{}", Uuid::new_v4()));
    let mut spooled = SpooledFile { path, len: 0 };
    let mut file = tokio::fs::File::create(&spooled.path)
        .await
        .map_err(UploadError::storage)?;

    while let Some(chunk) = field.chunk().await? {
        file.write_all(&chunk).await.map_err(UploadError::storage)?;
        spooled.len += chunk.len();
    }
    file.flush().await.map_err(UploadError::storage)?;

    Ok(spooled)
}

/// Reduces a client-supplied filename to a safe single path segment.
fn sanitize_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let cleaned: String = base
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_start_matches('.');

    if cleaned.is_empty() {
        FALLBACK_FILENAME.to_owned()
    } else {
        cleaned.to_owned()
    }
}

#[cfg(test)]
mod tests;
