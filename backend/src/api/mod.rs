use std::sync::Arc;

use axum::{
    Router,
    routing::{get, put},
};

use crate::GlobalState;

pub mod error;
pub mod session;
pub mod topics;

pub fn routes() -> Router<Arc<GlobalState>> {
    Router::new()
        .route("/api/sessions", get(session::session_list))
        .route("/api/sessions/ws", get(session::session_socket))
        .route("/api/topics/create", put(topics::topics_create))
        .route("/api/topics/list", get(topics::topics_list))
}
