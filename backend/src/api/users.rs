use std::sync::Arc;

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{GlobalState, api::error::ApiError};

#[derive(Deserialize)]
pub struct CreateUserRequest {
    name: String,
}

#[derive(Serialize)]
pub struct CreateUserResponse {
    id: Uuid,
}

pub async fn users_create(
    State(state): State<Arc<GlobalState>>,
    Json(payload): Json<CreateUserRequest>,
) -> Result<Json<CreateUserResponse>, ApiError> {
    let name = payload.name.trim();
    if name.is_empty() {
        return Err(ApiError::BadRequest(
            "user name must not be empty".to_owned(),
        ));
    }

    let id = state
        .db
        .create_user(name)
        .await
        .map_err(|error| ApiError::db("create user", &error))?;

    Ok(Json(CreateUserResponse { id }))
}

#[cfg(test)]
mod tests {
    use axum::http::{Method, StatusCode};
    use serde_json::json;

    use crate::api::testing::{app, call};

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn creates_users_with_trimmed_names() {
        let (app, db) = app().await;

        let (status, body) = call(
            &app,
            Method::PUT,
            "/api/users/create",
            None,
            Some(json!({ "name": "  Alex  " })),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let id = serde_json::from_value(body["id"].clone()).expect("id");
        let user = db.user(id).await.expect("lookup").expect("user exists");
        assert_eq!(user.name, "Alex");
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn rejects_blank_user_names() {
        let (app, _) = app().await;

        let (status, body) = call(
            &app,
            Method::PUT,
            "/api/users/create",
            None,
            Some(json!({ "name": "   " })),
        )
        .await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body["message"], "user name must not be empty");
    }
}
