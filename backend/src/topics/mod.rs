//! Read-only learning content endpoints.
//!
//! [`router`] exposes topics, their skill levels and the questions of a level.
//! The data is static test data for now (see [`data`]).
//!
//! Level ids are `u32`; `0` is the absolute beginner level.

mod data;
mod model;

use axum::{Json, Router, extract::Path, http::StatusCode, routing::get};

pub use model::{Level, Question};

use crate::topics::model::Topic;

/// Builds the `/api/topics` routes.
pub fn router() -> Router {
    Router::new()
        .route("/api/topics", get(list_topics))
        .route("/api/topics/{topic_id}/levels", get(list_levels))
        .route(
            "/api/topics/{topic_id}/levels/{level_id}/questions",
            get(list_questions),
        )
        .route(
            "/api/topics/{topic_id}/levels/{level_id}/questions/{question_id}",
            get(get_question),
        )
}

async fn list_topics() -> Json<Vec<Topic>> {
    Json(data::topics())
}

async fn list_levels(Path(topic_id): Path<String>) -> Result<Json<Vec<Level>>, StatusCode> {
    data::levels(&topic_id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn list_questions(
    Path((topic_id, level_id)): Path<(String, u32)>,
) -> Result<Json<Vec<Question>>, StatusCode> {
    data::questions(&topic_id, level_id)
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

async fn get_question(
    Path((topic_id, level_id, question_id)): Path<(String, u32, String)>,
) -> Result<Json<Question>, StatusCode> {
    data::questions(&topic_id, level_id)
        .and_then(|questions| questions.into_iter().find(|q| q.id() == question_id))
        .map(Json)
        .ok_or(StatusCode::NOT_FOUND)
}

#[cfg(test)]
mod tests;
