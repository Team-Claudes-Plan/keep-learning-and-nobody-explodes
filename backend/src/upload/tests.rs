//! Tests for the upload endpoint.
//!
//! Most tests run offline against a recording store.
//! `uploads_file_to_object_store` needs the dev stack and is ignored by default:
//!
//! ```text
//! nix run .#dev                      # in one terminal
//! cargo test -- --ignored            # in a shell with the dev env (nix develop)
//! ```

use std::{
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{FromRequest, Multipart},
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;
use uuid::Uuid;

use super::{
    ObjectStore, UploadError, UploadStore, Uploader, router, sanitize_filename, topic_of_key,
};
use crate::{config::Config, db::Database};

const BOUNDARY: &str = "test-boundary";
const MAX_BODY: usize = 1024 * 1024;

/// Topic every [`RecordingStore`] knows; `Uuid::nil()` is the one it does not.
const TOPIC: Uuid = Uuid::from_u128(1);
const UNKNOWN_TOPIC: Uuid = Uuid::nil();

fn multipart_bytes(parts: &[(&str, Option<&str>, &[u8])]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, filename, data) in parts {
        body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
        match filename {
            Some(filename) => body.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n\
                     Content-Type: text/plain\r\n\r\n"
                )
                .as_bytes(),
            ),
            None => body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            ),
        }
        body.extend_from_slice(data);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
    body
}

fn multipart_request(parts: &[(&str, Option<&str>, &[u8])]) -> Request<Body> {
    multipart_request_to(&format!("/upload?topic_id={TOPIC}"), parts)
}

fn multipart_request_to(uri: &str, parts: &[(&str, Option<&str>, &[u8])]) -> Request<Body> {
    Request::post(uri)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(multipart_bytes(parts)))
        .expect("request should build")
}

/// Store that records successful writes without talking to S3.
///
/// `fail_attempt` is the zero-based `put` call that returns a storage error.
#[derive(Clone)]
struct RecordingStore {
    fail_attempt: Option<usize>,
    attempts: Arc<AtomicUsize>,
    puts: Arc<Mutex<Vec<String>>>,
}

impl RecordingStore {
    fn ok() -> Self {
        Self::fail_on_attempt(None)
    }

    fn fail_on_attempt(fail_attempt: Option<usize>) -> Self {
        Self {
            fail_attempt,
            attempts: Arc::default(),
            puts: Arc::default(),
        }
    }

    fn puts(&self) -> Vec<String> {
        self.puts.lock().expect("puts lock").clone()
    }
}

impl UploadStore for RecordingStore {
    fn topic_exists(
        &self,
        topic_id: Uuid,
    ) -> impl Future<Output = Result<bool, UploadError>> + Send {
        std::future::ready(Ok(topic_id != UNKNOWN_TOPIC))
    }

    fn put(
        &self,
        key: &str,
        _content_type: &str,
        _path: &Path,
        _len: usize,
    ) -> impl Future<Output = Result<(), UploadError>> + Send {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
        if self.fail_attempt == Some(attempt) {
            return std::future::ready(Err(UploadError::storage(std::io::Error::other(
                "injected storage failure",
            ))));
        }
        self.puts.lock().expect("puts lock").push(key.to_owned());
        std::future::ready(Ok(()))
    }
}

async fn send(app: Router, request: Request<Body>) -> (StatusCode, Vec<u8>) {
    let response = app.oneshot(request).await.expect("router is infallible");
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body should be readable");
    (status, body.to_vec())
}

#[tokio::test]
async fn rejects_request_without_file_part() {
    let app = router(RecordingStore::ok(), MAX_BODY);

    let (status, _) = send(app, multipart_request(&[("comment", None, b"hello")])).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rejects_non_multipart_body() {
    let app = router(RecordingStore::ok(), MAX_BODY);
    let request = Request::post(format!("/upload?topic_id={TOPIC}"))
        .body(Body::from("plain"))
        .expect("request should build");

    let (status, _) = send(app, request).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn spools_file_bytes_to_a_temp_file() {
    let content = b"hello from the spool test";
    let request = multipart_request(&[("file", Some("notes.txt"), content)]);
    let mut multipart = Multipart::from_request(request, &())
        .await
        .expect("multipart should parse");
    let mut field = multipart
        .next_field()
        .await
        .expect("field should read")
        .expect("one field");

    let spooled = super::spool_field(&mut field)
        .await
        .expect("field should spool");
    let path = spooled.path.clone();

    assert_eq!(spooled.len, content.len());
    assert_eq!(
        std::fs::read(&path).expect("temp file should be readable"),
        content
    );
    drop(spooled);
    assert!(
        !path.exists(),
        "temp file should be removed after the spool is dropped"
    );
}

#[tokio::test]
async fn keeps_objects_when_every_part_is_stored() {
    let store = RecordingStore::ok();
    let request = multipart_request(&[
        ("file", Some("a.txt"), b"one"),
        ("file", Some("b.txt"), b"two"),
    ]);
    let multipart = Multipart::from_request(request, &())
        .await
        .expect("multipart should parse");

    let response = super::accept_upload(&store, TOPIC, multipart)
        .await
        .expect("both parts should be stored");

    assert_eq!(response.objects.len(), 2);
    assert!(response.failures.is_empty());
    assert_eq!(store.puts().len(), 2);
}

#[tokio::test]
async fn keeps_successful_files_when_a_middle_part_fails() {
    let store = RecordingStore::fail_on_attempt(Some(1));
    let request = multipart_request(&[
        ("file", Some("a.txt"), b"one"),
        ("file", Some("b.txt"), b"two"),
        ("file", Some("c.txt"), b"three"),
    ]);
    let multipart = Multipart::from_request(request, &())
        .await
        .expect("multipart should parse");

    let response = super::accept_upload(&store, TOPIC, multipart)
        .await
        .expect("stored parts should be reported");

    let stored: Vec<_> = response
        .objects
        .iter()
        .map(|object| object.filename.as_str())
        .collect();
    assert_eq!(stored, ["a.txt", "c.txt"]);
    assert_eq!(response.failures.len(), 1);
    assert_eq!(response.failures[0].filename.as_deref(), Some("b.txt"));
    assert_eq!(response.failures[0].message, "failed to store file");
    assert_eq!(store.puts().len(), 2);
}

#[tokio::test]
async fn reports_a_truncated_part_without_removing_earlier_files() {
    let store = RecordingStore::ok();
    let mut body = multipart_bytes(&[
        ("file", Some("a.txt"), b"one"),
        ("file", Some("b.txt"), b"two"),
    ]);
    let closing = format!("\r\n--{BOUNDARY}--\r\n");
    let end = body
        .windows(closing.len())
        .rposition(|window| window == closing.as_bytes())
        .expect("closing boundary");
    body.truncate(end);
    let request = Request::post(format!("/upload?topic_id={TOPIC}"))
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .expect("request should build");
    let multipart = Multipart::from_request(request, &())
        .await
        .expect("multipart should parse");

    let response = super::accept_upload(&store, TOPIC, multipart)
        .await
        .expect("the stored part should be reported");

    assert_eq!(response.objects.len(), 1);
    assert_eq!(response.objects[0].filename, "a.txt");
    assert_eq!(response.failures.len(), 1);
    assert_eq!(response.failures[0].filename.as_deref(), Some("b.txt"));
    assert_eq!(store.puts().len(), 1);
}

#[tokio::test]
async fn rejects_upload_exceeding_body_limit() {
    let app = router(RecordingStore::ok(), 64);
    let request = multipart_request(&[("file", Some("notes.txt"), b"hello")]);

    let (status, body) = send(app, request).await;

    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body, b"Request payload is too large");
}

#[tokio::test]
async fn stores_files_below_the_topic() {
    let store = RecordingStore::ok();
    let app = router(store.clone(), MAX_BODY);

    let (status, body) = send(app, multipart_request(&[("file", Some("a.txt"), b"one")])).await;

    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let json: serde_json::Value = serde_json::from_slice(&body).expect("response should be JSON");
    assert_eq!(json["topic_id"], TOPIC.to_string());
    let puts = store.puts();
    assert_eq!(puts.len(), 1);
    assert_eq!(json["objects"][0]["key"], puts[0]);
    assert_eq!(topic_of_key(&puts[0]), Some(TOPIC));
    assert!(puts[0].ends_with("/a.txt"), "unexpected key {}", puts[0]);
}

#[tokio::test]
async fn rejects_upload_without_topic() {
    let store = RecordingStore::ok();
    let app = router(store.clone(), MAX_BODY);
    let request = multipart_request_to("/upload", &[("file", Some("a.txt"), b"one")]);

    let (status, _) = send(app, request).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(store.puts().len(), 0);
}

#[tokio::test]
async fn rejects_upload_with_malformed_topic() {
    let store = RecordingStore::ok();
    let app = router(store.clone(), MAX_BODY);
    let request = multipart_request_to(
        "/upload?topic_id=not-a-uuid",
        &[("file", Some("a.txt"), b"one")],
    );

    let (status, _) = send(app, request).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(store.puts().len(), 0);
}

#[tokio::test]
async fn rejects_upload_to_unknown_topic() {
    let store = RecordingStore::ok();
    let app = router(store.clone(), MAX_BODY);
    let request = multipart_request_to(
        &format!("/upload?topic_id={UNKNOWN_TOPIC}"),
        &[("file", Some("a.txt"), b"one")],
    );

    let (status, _) = send(app, request).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(store.puts().len(), 0);
}

#[test]
fn reads_the_topic_from_an_upload_key() {
    let document = Uuid::new_v4();
    assert_eq!(
        topic_of_key(&format!("uploads/{TOPIC}/{document}/slides.pdf")),
        Some(TOPIC)
    );
}

#[test]
fn ignores_keys_without_a_topic() {
    let id = Uuid::new_v4();
    // keys from before topics existed
    assert_eq!(topic_of_key(&format!("uploads/{id}/slides.pdf")), None);
    // not below the prefix, wrong shape, or not uuids
    assert_eq!(
        topic_of_key(&format!("other/{TOPIC}/{id}/slides.pdf")),
        None
    );
    assert_eq!(topic_of_key(&format!("uploads/{TOPIC}/{id}/a/b.pdf")), None);
    assert_eq!(topic_of_key(&format!("uploads/{TOPIC}/{id}/")), None);
    assert_eq!(
        topic_of_key(&format!("uploads/topic/{id}/slides.pdf")),
        None
    );
    assert_eq!(
        topic_of_key(&format!("uploads/{TOPIC}/doc/slides.pdf")),
        None
    );
    assert_eq!(topic_of_key("uploads/"), None);
}

#[tokio::test]
#[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
async fn uploads_file_to_object_store() {
    let config = Config::from_env().expect("dev environment should be set");
    let db = Database::connect(&config.database_url, 2)
        .await
        .expect("database should connect");
    db.migrate().await.expect("migrations should apply");
    let topic = db.create_topic("upload test").await.expect("topic");
    let store = ObjectStore::connect(&config.s3).await;
    let app = router(Uploader::new(store.clone(), db), MAX_BODY);
    let content = b"hello from the upload test";

    let (status, body) = send(
        app,
        multipart_request_to(
            &format!("/upload?topic_id={topic}"),
            &[("file", Some("../my notes.txt"), content)],
        ),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let json: serde_json::Value = serde_json::from_slice(&body).expect("response should be JSON");
    assert_eq!(json["topic_id"], topic.to_string());
    let object = &json["objects"][0];
    assert_eq!(object["filename"], "../my notes.txt");
    assert_eq!(object["size"], content.len());
    let key = object["key"].as_str().expect("key should be a string");
    assert!(
        key.starts_with(&format!("uploads/{topic}/")) && key.ends_with("/my_notes.txt"),
        "unexpected key {key}"
    );
    assert_eq!(topic_of_key(key), Some(topic));
    let downloaded = store.get(key).await.expect("object should download");
    assert_eq!(downloaded.bytes.as_ref(), content);
}

#[tokio::test]
#[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
async fn rejects_upload_to_missing_topic_in_database() {
    let config = Config::from_env().expect("dev environment should be set");
    let db = Database::connect(&config.database_url, 2)
        .await
        .expect("database should connect");
    let store = ObjectStore::connect(&config.s3).await;
    let app = router(Uploader::new(store, db), MAX_BODY);

    let (status, _) = send(
        app,
        multipart_request_to(
            &format!("/upload?topic_id={}", Uuid::new_v4()),
            &[("file", Some("a.txt"), b"one")],
        ),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[test]
fn strips_directories_from_filename() {
    assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
    assert_eq!(sanitize_filename(r"C:\docs\slides.pdf"), "slides.pdf");
}

#[test]
fn replaces_unsafe_characters_in_filename() {
    assert_eq!(sanitize_filename("my notes (1).pdf"), "my_notes__1_.pdf");
}

#[test]
fn falls_back_when_filename_is_empty() {
    assert_eq!(sanitize_filename(".."), "file");
    assert_eq!(sanitize_filename(""), "file");
}
