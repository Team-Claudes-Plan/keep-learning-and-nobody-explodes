use apalis::prelude::{TaskBuilder, TaskSink};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use sqlx::PgPool;

use crate::{
    db,
    worker::{OcrBackend, OcrJob},
};

#[derive(Clone)]
pub struct WebhookState {
    pub pool: PgPool,
    pub backend: OcrBackend,
    pub bucket: String,
    pub token: String,
}

pub fn router(state: WebhookState) -> Router {
    Router::new()
        .route("/events/rustfs", post(receive_event))
        .with_state(state)
}

async fn receive_event(
    State(state): State<WebhookState>,
    headers: HeaderMap,
    Json(envelope): Json<EventEnvelope>,
) -> Result<StatusCode, WebhookError> {
    let expected_authorization = format!("Bearer {}", state.token);
    let authorized = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        == Some(expected_authorization.as_str());
    if !authorized {
        return Err(WebhookError::Unauthorized);
    }

    let mut enqueued = 0;
    for record in envelope.records {
        if !record.event_name.starts_with("s3:ObjectCreated:") {
            continue;
        }
        if record.s3.bucket.name != state.bucket {
            return Err(WebhookError::BadRequest(
                "event bucket does not match the configured bucket".to_owned(),
            ));
        }

        let key = decode_key(&record.s3.object.key)?;
        if !key.starts_with("uploads/") {
            continue;
        }

        let job = OcrJob {
            bucket: record.s3.bucket.name,
            key,
            etag: record.s3.object.etag,
        };
        let task = TaskBuilder::new(job.clone())
            .idempotency_key(job.idempotency_key())
            .build();
        state
            .backend
            .clone()
            .push_task(task)
            .await
            .map_err(WebhookError::internal)?;
        db::mark_queued(
            &state.pool,
            &job.bucket,
            &job.key,
            job.etag.as_deref(),
            job.filename(),
        )
        .await
        .map_err(WebhookError::internal)?;

        tracing::info!(name: "ocr.enqueued", key = %job.key, "enqueued OCR job");
        enqueued += 1;
    }

    if enqueued == 0 {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Ok(StatusCode::OK)
    }
}

fn decode_key(encoded: &str) -> Result<String, WebhookError> {
    // S3 event keys use form-style URL encoding: '+' represents a space.
    let with_spaces = encoded.replace('+', " ");
    urlencoding::decode(&with_spaces)
        .map(std::borrow::Cow::into_owned)
        .map_err(|error| WebhookError::BadRequest(format!("invalid object key encoding: {error}")))
}

#[derive(Debug, Deserialize)]
struct EventEnvelope {
    #[serde(rename = "Records", default)]
    records: Vec<EventRecord>,
}

#[derive(Debug, Deserialize)]
struct EventRecord {
    #[serde(rename = "eventName")]
    event_name: String,
    s3: S3Record,
}

#[derive(Debug, Deserialize)]
struct S3Record {
    bucket: S3Bucket,
    object: S3Object,
}

#[derive(Debug, Deserialize)]
struct S3Bucket {
    name: String,
}

#[derive(Debug, Deserialize)]
struct S3Object {
    key: String,
    #[serde(rename = "eTag", alias = "etag", default)]
    etag: Option<String>,
}

#[derive(Debug)]
enum WebhookError {
    Unauthorized,
    BadRequest(String),
    Internal(anyhow::Error),
}

impl WebhookError {
    fn internal(error: impl Into<anyhow::Error>) -> Self {
        Self::Internal(error.into())
    }
}

impl IntoResponse for WebhookError {
    fn into_response(self) -> Response {
        match self {
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message).into_response(),
            Self::Internal(error) => {
                tracing::error!(error = ?error, "failed to process RustFS webhook");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "failed to enqueue OCR job",
                )
                    .into_response()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_rustfs_event() {
        let payload = serde_json::json!({
            "EventName": "s3:ObjectCreated:Put",
            "Records": [{
                "eventName": "s3:ObjectCreated:Put",
                "s3": {
                    "bucket": { "name": "course-materials" },
                    "object": {
                        "key": "uploads%2Fabc%2Flecture+1.pdf",
                        "eTag": "abc123"
                    }
                }
            }]
        });

        let envelope: EventEnvelope = serde_json::from_value(payload).expect("event should parse");
        assert_eq!(envelope.records.len(), 1);
        let record = &envelope.records[0];
        assert_eq!(record.s3.bucket.name, "course-materials");
        assert_eq!(record.s3.object.etag.as_deref(), Some("abc123"));
        assert_eq!(
            decode_key(&record.s3.object.key).expect("key should decode"),
            "uploads/abc/lecture 1.pdf"
        );
    }

    #[test]
    fn decodes_percent_encoded_key() {
        assert_eq!(
            decode_key("uploads%2Fabc%2Fmy%20notes.pdf").expect("key should decode"),
            "uploads/abc/my notes.pdf"
        );
    }
}
