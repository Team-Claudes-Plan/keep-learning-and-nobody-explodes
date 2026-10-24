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
