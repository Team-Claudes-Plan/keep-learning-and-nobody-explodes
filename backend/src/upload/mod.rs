//! HTTP endpoint that stores uploaded course material in the object store.
//!
//! [`router`] exposes `POST /upload?topic_id=<uuid>`, which accepts
//! `multipart/form-data`. Every upload belongs to an existing topic (create one
//! with `PUT /api/topics/create`). Every part carrying a filename is written to
//! `uploads/<topic_id>/<uuid>/<sanitized-filename>`; other form fields are
//! ignored. The topic is part of the key because that is all the object-created
//! webhook reports back; see [`topic_of_key`].
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
    extract::{DefaultBodyLimit, Multipart, Query, State, multipart::Field},
    routing::post,
};
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::db::Database;

pub use error::UploadError;
pub use store::ObjectStore;

/// Content type assumed when a part does not declare one.
const FALLBACK_CONTENT_TYPE: &str = "application/octet-stream";

/// Prefix of every uploaded object; the webhook and the dev stack's bucket
/// notification only react to keys below it.
pub const KEY_PREFIX: &str = "uploads/";

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

/// Query parameters of `POST /upload`.
#[derive(Debug, Deserialize)]
struct UploadQuery {
    /// Topic the uploaded files belong to.
    topic_id: Uuid,
}

/// Response body of `POST /upload`.
#[derive(Debug, Serialize)]
pub struct UploadResponse {
    /// Topic the files were uploaded to.
    pub topic_id: Uuid,
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
pub fn router<S>(store: S, max_body_bytes: usize) -> Router
where
    S: UploadStore + Clone + 'static,
{
    Router::new()
        .route("/upload", post(upload::<S>))
        .layer(DefaultBodyLimit::max(max_body_bytes))
        .with_state(store)
}

/// Builds the object key of an uploaded file.
fn object_key(topic_id: Uuid, filename: &str) -> String {
    format!(
        "{KEY_PREFIX}{topic_id}/{}/{}",
        Uuid::new_v4(),
        sanitize_filename(filename)
    )
}

/// Returns the topic an object key was uploaded to.
///
/// Only keys of the form `uploads/<topic_id>/<uuid>/<filename>` qualify. Keys
/// from before topics existed (`uploads/<uuid>/<filename>`) and keys written
/// outside the upload endpoint do not, so they cannot be attached to a topic.
#[must_use]
pub fn topic_of_key(key: &str) -> Option<Uuid> {
    let mut segments = key.strip_prefix(KEY_PREFIX)?.split('/');
    let topic_id = segments.next()?.parse().ok()?;
    let document = segments.next()?;
    let filename = segments.next()?;
    (segments.next().is_none() && document.parse::<Uuid>().is_ok() && !filename.is_empty())
        .then_some(topic_id)
}

/// What an upload needs: the object store and the topics to attach files to.
pub trait UploadStore: Send + Sync {
    /// Whether `topic_id` names an existing topic.
    fn topic_exists(
        &self,
        topic_id: Uuid,
    ) -> impl Future<Output = Result<bool, UploadError>> + Send;

    /// Streams the file at `path` to `key`.
    fn put(
        &self,
        key: &str,
        content_type: &str,
        path: &Path,
        len: usize,
    ) -> impl Future<Output = Result<(), UploadError>> + Send;
}

/// The production [`UploadStore`]: files go to S3, topics live in Postgres.
#[derive(Debug, Clone)]
pub struct Uploader {
    objects: ObjectStore,
    db: Database,
}

impl Uploader {
    #[must_use]
    pub fn new(objects: ObjectStore, db: Database) -> Self {
        Self { objects, db }
    }
}

impl UploadStore for Uploader {
    fn topic_exists(
        &self,
        topic_id: Uuid,
    ) -> impl Future<Output = Result<bool, UploadError>> + Send {
        let db = self.db.clone();
        async move {
            db.topic_exists(topic_id)
                .await
                .map_err(UploadError::internal)
        }
    }

    fn put(
        &self,
        key: &str,
        content_type: &str,
        path: &Path,
        len: usize,
    ) -> impl Future<Output = Result<(), UploadError>> + Send {
        self.objects.put(key, content_type, path, len)
    }
}

async fn upload<S: UploadStore>(
    State(store): State<S>,
    Query(query): Query<UploadQuery>,
    multipart: Multipart,
) -> Result<Json<UploadResponse>, UploadError> {
    accept_upload(&store, query.topic_id, multipart)
        .await
        .map(Json)
}

async fn accept_upload(
    store: &impl UploadStore,
    topic_id: Uuid,
    multipart: Multipart,
) -> Result<UploadResponse, UploadError> {
    if !store.topic_exists(topic_id).await? {
        return Err(UploadError::topic_not_found(format!(
            "topic {topic_id} does not exist"
        )));
    }
    store_parts(store, topic_id, multipart).await
}

async fn store_parts(
    store: &impl UploadStore,
    topic_id: Uuid,
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
                return Ok(UploadResponse {
                    topic_id,
                    objects,
                    failures,
                });
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
                return Ok(UploadResponse {
                    topic_id,
                    objects,
                    failures,
                });
            }
        };
        let size = spooled.len;
        let key = object_key(topic_id, &filename);
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
    Ok(UploadResponse {
        topic_id,
        objects,
        failures,
    })
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
