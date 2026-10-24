//! Tests for the upload endpoint.
//!
//! Most tests run offline. `uploads_file_to_object_store` needs the dev stack
//! and is ignored by default:
//!
//! ```text
//! nix run .#dev                      # in one terminal
//! cargo test -- --ignored            # in a shell with the dev env (nix develop)
//! ```

use std::{
    path::Path,
    sync::{
        Mutex,
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

use super::{ObjectStore, UploadError, UploadStore, router, sanitize_filename};
use crate::config::{Config, S3Config};

const BOUNDARY: &str = "test-boundary";
const MAX_BODY: usize = 1024 * 1024;

/// Store pointing at an address nothing listens on; fine for tests that never reach S3.
async fn offline_store() -> ObjectStore {
    ObjectStore::connect(&S3Config {
        endpoint: "http://127.0.0.1:1".into(),
        access_key: "test".into(),
        secret_key: "test".into(),
        bucket: "test".into(),
        region: "us-east-1".into(),
    })
    .await
}

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
    Request::post("/upload")
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
struct RecordingStore {
    fail_attempt: Option<usize>,
    attempts: AtomicUsize,
    puts: Mutex<Vec<String>>,
}

impl RecordingStore {
    fn ok() -> Self {
        Self::fail_on_attempt(None)
    }

    fn fail_on_attempt(fail_attempt: Option<usize>) -> Self {
        Self {
            fail_attempt,
            attempts: AtomicUsize::new(0),
            puts: Mutex::new(Vec::new()),
        }
    }

    fn puts(&self) -> Vec<String> {
        self.puts.lock().expect("puts lock").clone()
    }
}

impl UploadStore for RecordingStore {
    async fn put(
        &self,
        key: &str,
        _content_type: &str,
        _path: &Path,
        _len: usize,
    ) -> Result<(), UploadError> {
        let attempt = self.attempts.fetch_add(1, Ordering::SeqCst);
        if self.fail_attempt == Some(attempt) {
            return Err(UploadError::storage(std::io::Error::other(
                "injected storage failure",
            )));
        }
        self.puts.lock().expect("puts lock").push(key.to_owned());
        Ok(())
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
    let app = router(offline_store().await, MAX_BODY);

    let (status, _) = send(app, multipart_request(&[("comment", None, b"hello")])).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn rejects_non_multipart_body() {
    let app = router(offline_store().await, MAX_BODY);
    let request = Request::post("/upload")
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

    let response = super::accept_upload(&store, multipart)
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

    let response = super::accept_upload(&store, multipart)
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
    let request = Request::post("/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .expect("request should build");
    let multipart = Multipart::from_request(request, &())
        .await
        .expect("multipart should parse");

    let response = super::accept_upload(&store, multipart)
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
    let app = router(offline_store().await, 64);
    let request = multipart_request(&[("file", Some("notes.txt"), b"hello")]);

    let (status, body) = send(app, request).await;

    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body, b"Request payload is too large");
}

#[tokio::test]
#[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
async fn uploads_file_to_object_store() {
    let config = Config::from_env().expect("dev environment should be set");
    let store = ObjectStore::connect(&config.s3).await;
    let app = router(store.clone(), MAX_BODY);
    let content = b"hello from the upload test";

    let (status, body) = send(
        app,
        multipart_request(&[("file", Some("../my notes.txt"), content)]),
    )
    .await;

    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let json: serde_json::Value = serde_json::from_slice(&body).expect("response should be JSON");
    let object = &json["objects"][0];
    assert_eq!(object["filename"], "../my notes.txt");
    assert_eq!(object["size"], content.len());
    let key = object["key"].as_str().expect("key should be a string");
    assert!(
        key.starts_with("uploads/") && key.ends_with("/my_notes.txt"),
        "unexpected key {key}"
    );
    let downloaded = store.get(key).await.expect("object should download");
    assert_eq!(downloaded.bytes.as_ref(), content);
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
