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
//!
//! Each file is stored on its own. A part that fails does not remove files
//! already stored and does not stop later parts when the multipart stream is
//! still readable. The response lists the stored objects and the parts that
//! failed. A request that stores nothing still returns an error.

mod error;
mod store;

use std::path::{Path, PathBuf};

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
    /// Files stored by the request, in request order.
    pub objects: Vec<StoredObject>,
    /// File parts that were not stored, in request order.
    pub failures: Vec<FailedUpload>,
}

/// A file part that was not stored.
#[derive(Debug, Serialize)]
pub struct FailedUpload {
    /// Filename as sent by the client.
    ///
    /// Absent when the multipart stream failed before the next part's headers
    /// were available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    /// Why this part was not stored.
    pub message: String,
}

/// Builds the upload routes, rejecting bodies larger than `max_body_bytes`.
pub fn router(store: ObjectStore, max_body_bytes: usize) -> Router {
    Router::new()
        .route("/upload", post(upload))
        .layer(DefaultBodyLimit::max(max_body_bytes))
        .with_state(store)
}

/// Stores the objects produced by one upload request.
trait UploadStore: Send + Sync {
    /// Streams the file at `path` to `key`.
    fn put(
        &self,
        key: &str,
        content_type: &str,
        path: &Path,
        len: usize,
    ) -> impl Future<Output = Result<(), UploadError>> + Send;
}

async fn upload(
    State(store): State<ObjectStore>,
    multipart: Multipart,
) -> Result<Json<UploadResponse>, UploadError> {
    accept_upload(&store, multipart).await.map(Json)
}

async fn accept_upload(
    store: &impl UploadStore,
    multipart: Multipart,
) -> Result<UploadResponse, UploadError> {
    store_parts(store, multipart).await
}

async fn store_parts(
    store: &impl UploadStore,
    mut multipart: Multipart,
) -> Result<UploadResponse, UploadError> {
    let mut objects = Vec::new();
    let mut failures = Vec::new();

    loop {
        let mut field = match multipart.next_field().await {
            Ok(Some(field)) => field,
            Ok(None) => break,
            Err(err) => {
                let upload_err = UploadError::from(err);
                if objects.is_empty() {
                    return Err(upload_err);
                }
                failures.push(failed_part(None, &upload_err));
                return Ok(UploadResponse { objects, failures });
            }
        };
        let Some(filename) = field.file_name().map(str::to_owned) else {
            continue;
        };
        let content_type = field
            .content_type()
            .unwrap_or(FALLBACK_CONTENT_TYPE)
            .to_owned();

        // Hold at most one chunk in memory; the rest of the part lives on disk.
        // A read error leaves the multipart stream unusable, so later parts stop.
        let spooled = match spool_field(&mut field).await {
            Ok(spooled) => spooled,
            Err(err) => {
                if objects.is_empty() {
                    return Err(err);
                }
                failures.push(failed_part(Some(filename), &err));
                return Ok(UploadResponse { objects, failures });
            }
        };
        let size = spooled.len;
        let key = format!(
            "uploads/{}/{}",
            Uuid::new_v4(),
            sanitize_filename(&filename)
        );
        // The temporary file is removed when `spooled` drops, including when
        // the object store rejects this part. Earlier objects stay.
        if let Err(err) = store.put(&key, &content_type, &spooled.path, size).await {
            tracing::error!(
                name: "upload.part_failed",
                filename = %filename,
                error = ?err,
                "failed to store file part"
            );
            failures.push(failed_part(Some(filename), &err));
            continue;
        }

        tracing::info!(name: "upload.stored", key = %key, size, "stored uploaded file");
        objects.push(StoredObject {
            key,
            filename,
            content_type,
            size,
        });
    }

    if objects.is_empty() {
        if failures.is_empty() {
            return Err(UploadError::invalid_request(
                "no file part found in request",
            ));
        }
        return Err(UploadError::storage(std::io::Error::other(
            "failed to store file",
        )));
    }
    Ok(UploadResponse { objects, failures })
}

fn failed_part(filename: Option<String>, err: &UploadError) -> FailedUpload {
    let message = if err.is_storage() {
        "failed to store file".to_owned()
    } else {
        err.to_string()
    };
    FailedUpload { filename, message }
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
