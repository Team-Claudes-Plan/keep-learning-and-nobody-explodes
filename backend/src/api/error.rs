use axum::{Json, http::StatusCode, response::IntoResponse};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ApiError {
    #[error("{0}")]
    InternalServerError(String),
    #[error("{0}")]
    BadRequest(String),
    /// The request names no user, or one that does not exist.
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
}

impl ApiError {
    /// Logs a database error and hides its details from the client.
    pub fn db(context: &str, error: &sqlx::Error) -> Self {
        tracing::error!(error = %error, "failed to {context}");
        Self::InternalServerError(format!("failed to {context}"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            ApiError::InternalServerError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
        };

        let reason = self.to_string();

        (status, Json(json! ({"message": reason}))).into_response()
    }
}
