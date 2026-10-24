//! Tests for the upload endpoint.
//!
//! Most tests run offline. `uploads_file_to_object_store` needs the dev stack
//! and is ignored by default:
//!
//! ```text
//! nix run .#dev                      # in one terminal
//! cargo test -- --ignored            # in a shell with the dev env (nix develop)
//! ```

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use tower::ServiceExt;

use super::{ObjectStore, router, sanitize_filename};
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

fn multipart_request(parts: &[(&str, Option<&str>, &[u8])]) -> Request<Body> {
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

    Request::post("/upload")
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .expect("request should build")
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
    assert_eq!(store.get(key).await, content);
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
