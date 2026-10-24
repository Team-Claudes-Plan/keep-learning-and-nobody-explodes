use crate::{GlobalState, api::error::ApiError, db::Topic};
use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::error;
use uuid::Uuid;

#[derive(Deserialize)]
pub struct CreateTopicRequest {
    name: String,
}

#[derive(Serialize)]
pub struct CreateTopicResponse {
    id: Uuid,
}

pub async fn topics_create(
    State(state): State<Arc<GlobalState>>,
    Json(payload): Json<CreateTopicRequest>,
) -> Result<Json<CreateTopicResponse>, ApiError> {
    let name = payload.name.trim();

    if name.is_empty() {
        return Err(ApiError::BadRequest(
            "topic name must not be empty".to_owned(),
        ));
    }

    let id = state.db.create_topic(name).await.map_err(|error| {
        error!(error = %error, "failed to create topic");
        ApiError::InternalServerError("failed to create topic".to_owned())
    })?;

    Ok(Json(CreateTopicResponse { id }))
}

#[derive(Serialize)]
pub struct ListTopicsResponse {
    topics: Vec<Topic>,
}

pub async fn topics_list(
    State(state): State<Arc<GlobalState>>,
) -> Result<Json<ListTopicsResponse>, ApiError> {
    let topics = state.db.list_topics().await.map_err(|error| {
        error!(error = %error, "failed to list topics");
        ApiError::InternalServerError("failed to list topics".to_owned())
    })?;

    Ok(Json(ListTopicsResponse { topics }))
}

#[cfg(test)]
mod tests {
    //! Need the dev database, so they are ignored by default:
    //!
    //! ```text
    //! nix run .#dev                      # in one terminal
    //! cargo test -- --ignored            # in a shell with the dev env (nix develop)
    //! ```

    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode, header},
    };
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;
    use crate::{config::Config, db::Database, session::Sessions};

    async fn app() -> (Router, Database) {
        let config = Config::from_env().expect("dev environment should be set");
        let db = Database::connect(&config.database_url, 2)
            .await
            .expect("database should connect");
        db.migrate().await.expect("migrations should apply");
        let state = Arc::new(GlobalState {
            db: db.clone(),
            sessions: Sessions::new(db.clone()),
        });
        (crate::api::routes().with_state(state), db)
    }

    async fn call(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .expect("request should build");
        let response = app
            .clone()
            .oneshot(request)
            .await
            .expect("router is infallible");
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should be readable");
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn creates_and_lists_topics() {
        let (app, db) = app().await;
        let name = format!("topic {}", Uuid::new_v4());

        let (status, body) = call(
            &app,
            Method::PUT,
            "/api/topics/create",
            Some(json!({ "name": format!("  {name}  ") })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let id: Uuid = serde_json::from_value(body["id"].clone()).expect("id");

        let (status, body) = call(&app, Method::GET, "/api/topics/list", None).await;
        assert_eq!(status, StatusCode::OK);
        let topics = body["topics"].as_array().expect("topics");
        let created = topics
            .iter()
            .find(|topic| topic["id"] == id.to_string())
            .expect("created topic should be listed");
        assert_eq!(created["name"], name, "the name is stored trimmed");
        assert!(db.topic_exists(id).await.expect("lookup"));
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn rejects_blank_topic_name() {
        let (app, _) = app().await;

        let (status, body) = call(
            &app,
            Method::PUT,
            "/api/topics/create",
            Some(json!({ "name": "   " })),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["message"], "topic name must not be empty");
    }
}
