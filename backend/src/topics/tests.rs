//! Tests for the learning content endpoints.

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::Value;
use tower::ServiceExt;

use super::router;

async fn get(uri: &str) -> (StatusCode, Value) {
    let response = router()
        .oneshot(Request::get(uri).body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn lists_topics() {
    let (status, body) = get("/api/topics").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["id"], "math");
}

#[tokio::test]
async fn lists_levels_starting_at_zero() {
    let (status, body) = get("/api/topics/math/levels").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["id"], 0);
    assert_eq!(body.as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn lists_full_questions() {
    let (status, body) = get("/api/topics/math/levels/0/questions").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body[0]["type"], "single_choice");
    assert!(body[0]["options"].is_array());
}

#[tokio::test]
async fn gets_single_question() {
    let (status, body) = get("/api/topics/math/levels/1/questions/math-1-2").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["type"], "number_input");
    assert!(body["unit"].is_null());
}

#[tokio::test]
async fn unknown_ids_are_not_found() {
    for uri in [
        "/api/topics/nope/levels",
        "/api/topics/math/levels/9/questions",
        "/api/topics/math/levels/0/questions/nope",
        // Question exists, but in another level.
        "/api/topics/math/levels/0/questions/math-1-1",
    ] {
        assert_eq!(get(uri).await.0, StatusCode::NOT_FOUND, "{uri}");
    }
}
