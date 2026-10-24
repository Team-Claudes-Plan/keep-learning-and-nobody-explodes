//! HTTP endpoint that stores uploaded course material in the object store.
//!
//! [`router`] exposes `POST /upload`, which accepts `multipart/form-data`.
//! Every part carrying a filename is written to
//! `uploads/<uuid>/<sanitized-filename>`; other form fields are ignored.

mod error;
mod store;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, State},
    routing::post,
};
use serde::Serialize;
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

    while let Some(field) = multipart.next_field().await? {
        let Some(filename) = field.file_name().map(str::to_owned) else {
            continue;
        };
        let content_type = field
            .content_type()
            .unwrap_or(FALLBACK_CONTENT_TYPE)
            .to_owned();
        let data = field.bytes().await?;
        let size = data.len();

        let key = format!(
            "uploads/{}/{}",
            Uuid::new_v4(),
            sanitize_filename(&filename)
        );
        store.put(&key, &content_type, data).await?;

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
