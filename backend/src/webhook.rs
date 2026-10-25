use apalis::prelude::{TaskBuilder, TaskSink, TaskSinkError};
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;

use crate::{
    db::{self, Database},
    upload::KEY_PREFIX,
    worker::{OcrBackend, OcrJob},
};

#[derive(Clone)]
pub struct WebhookState {
    pub db: Database,
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
        if !key.starts_with(KEY_PREFIX) {
            continue;
        }
        let job = OcrJob {
            bucket: record.s3.bucket.name,
            key,
            etag: record.s3.object.etag,
        };
        let Some(topic_id) = job.topic_id() else {
            tracing::warn!(name: "ocr.skipped", key = %job.key, "object key does not name a topic, ignoring");
            continue;
        };
        // Register the document first: a job must never exist without its row.
        // Both steps are idempotent, so a redelivered event is safe.
        let document_id = match state
            .db
            .mark_queued(
                topic_id,
                &job.bucket,
                &job.key,
                job.etag.as_deref(),
                job.filename(),
            )
            .await
        {
            Ok(document_id) => document_id,
            Err(error) if db::is_unknown_topic(&error) => {
                // Retrying cannot help, and a failing hook would make RustFS redeliver it.
                tracing::warn!(name: "ocr.skipped", key = %job.key, topic_id = %topic_id, "topic does not exist, ignoring");
                continue;
            }
            Err(error) => return Err(WebhookError::internal(error)),
        };
        let task = TaskBuilder::new(job.clone())
            .idempotency_key(job.idempotency_key())
            .build();
        match state.backend.clone().push_task(task).await {
            Ok(()) => {}
            Err(error) if already_enqueued(&error) => {
                tracing::info!(name: "ocr.duplicate", key = %job.key, "OCR job already enqueued");
                continue;
            }
            Err(error) => return Err(WebhookError::internal(error)),
        }

        tracing::info!(name: "ocr.enqueued", key = %job.key, document_id = %document_id, "enqueued OCR job");
        enqueued += 1;
    }

    if enqueued == 0 {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Ok(StatusCode::OK)
    }
}

/// The queue rejects a job whose idempotency key it has seen. That means the
/// event was delivered before; answering with an error would only make `RustFS`
/// retry it forever.
fn already_enqueued(error: &TaskSinkError<apalis_postgres::Error>) -> bool {
    matches!(
        error,
        TaskSinkError::PushError(apalis_postgres::Error::Database(error))
            if error.as_database_error().is_some_and(sqlx::error::DatabaseError::is_unique_violation)
    )
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

    /// Needs the dev database (`nix run .#dev`, then `cargo test -- --ignored`
    /// inside `nix develop`).
    mod database {
        use axum::{
            Router,
            body::Body,
            http::{Request, StatusCode, header},
        };
        use tower::ServiceExt;
        use uuid::Uuid;

        use super::super::{WebhookState, router};
        use crate::{db::Database, worker};

        const BUCKET: &str = "webhook-test";
        const TOKEN: &str = "secret";

        async fn app() -> (Router, Database) {
            let url = std::env::var("DATABASE_URL").expect("dev environment should be set");
            let db = Database::connect(&url, 2)
                .await
                .expect("database should connect");
            db.migrate().await.expect("migrations should apply");
            worker::setup(&db)
                .await
                .expect("job queue should be set up");
            let state = WebhookState {
                db: db.clone(),
                backend: worker::OcrBackend::new(db.pool())
                    .with_config(apalis_postgres::Config::default().queue("webhook-test")),
                bucket: BUCKET.to_owned(),
                token: TOKEN.to_owned(),
            };
            (router(state), db)
        }

        async fn deliver(app: &Router, token: &str, key: &str) -> StatusCode {
            let payload = serde_json::json!({
                "Records": [{
                    "eventName": "s3:ObjectCreated:Put",
                    "s3": {
                        "bucket": { "name": BUCKET },
                        "object": { "key": key, "eTag": "etag" }
                    }
                }]
            });
            let request = Request::post("/events/rustfs")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(payload.to_string()))
                .expect("request should build");
            app.clone()
                .oneshot(request)
                .await
                .expect("router is infallible")
                .status()
        }

        async fn document(db: &Database, key: &str) -> Option<(Uuid, String)> {
            sqlx::query_as("SELECT topic_id, ocr_status FROM documents WHERE object_key = $1")
                .bind(key)
                .fetch_optional(db.pool())
                .await
                .expect("query")
        }

        #[tokio::test]
        #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
        async fn registers_the_document_in_the_topic() {
            let (app, db) = app().await;
            let topic = db.create_topic("webhook test").await.expect("topic");
            let key = format!("uploads/{topic}/{}/notes.txt", Uuid::new_v4());

            assert_eq!(deliver(&app, TOKEN, &key).await, StatusCode::OK);
            // a redelivered event is acknowledged without enqueueing again
            assert_eq!(deliver(&app, TOKEN, &key).await, StatusCode::NO_CONTENT);

            assert_eq!(
                document(&db, &key).await,
                Some((topic, "queued".to_owned()))
            );
        }

        #[tokio::test]
        #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
        async fn ignores_keys_without_a_topic() {
            let (app, db) = app().await;
            let key = format!("uploads/{}/notes.txt", Uuid::new_v4());

            assert_eq!(deliver(&app, TOKEN, &key).await, StatusCode::NO_CONTENT);

            assert_eq!(document(&db, &key).await, None);
        }

        #[tokio::test]
        #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
        async fn ignores_unknown_topics() {
            let (app, db) = app().await;
            let key = format!("uploads/{}/{}/notes.txt", Uuid::new_v4(), Uuid::new_v4());

            assert_eq!(deliver(&app, TOKEN, &key).await, StatusCode::NO_CONTENT);

            assert_eq!(document(&db, &key).await, None);
        }

        #[tokio::test]
        #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
        async fn rejects_a_wrong_token() {
            let (app, _) = app().await;
            let key = format!("uploads/{}/{}/notes.txt", Uuid::new_v4(), Uuid::new_v4());

            assert_eq!(deliver(&app, "wrong", &key).await, StatusCode::UNAUTHORIZED);
        }
    }
}
