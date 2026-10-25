use std::sync::Arc;

use axum::{
    Router,
    routing::{get, put},
};

use crate::GlobalState;

pub mod error;
pub mod islands;
pub mod session;
pub mod user;
pub mod users;

pub fn routes() -> Router<Arc<GlobalState>> {
    Router::new()
        .route("/api/sessions", get(session::session_list))
        .route("/api/sessions/ws", get(session::session_socket))
        .route("/api/users/create", put(users::users_create))
        .route("/api/islands", get(islands::islands_list))
        .route("/api/islands/create", put(islands::islands_create))
        .route(
            "/api/islands/{island_id}/members",
            put(islands::islands_add_member),
        )
        .route("/api/islands/{island_id}/fork", put(islands::islands_fork))
}

#[cfg(test)]
pub(crate) mod testing {
    //! Need the dev database, so the tests using this are ignored by default:
    //!
    //! ```text
    //! nix run .#dev                      # in one terminal
    //! cargo test -- --ignored            # in a shell with the dev env (nix develop)
    //! ```

    use std::sync::Arc;

    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Method, Request, StatusCode, header},
    };
    use serde_json::Value;
    use tower::ServiceExt;
    use uuid::Uuid;

    use super::user::USER_HEADER;
    use crate::{GlobalState, config::Config, db::Database, session::Sessions};

    pub async fn app() -> (Router, Database) {
        let config = Config::from_env().expect("dev environment should be set");
        let db = Database::connect(&config.database_url, 2)
            .await
            .expect("database should connect");
        db.migrate().await.expect("migrations should apply");
        let state = Arc::new(GlobalState {
            db: db.clone(),
            sessions: Sessions::new(db.clone(), config.akasha_language),
            language: config.akasha_language,
        });
        (super::routes().with_state(state), db)
    }

    /// Sends a JSON request as `user`, returning the status and JSON body
    /// (`Null` if the body is not JSON).
    pub async fn call(
        app: &Router,
        method: Method,
        uri: &str,
        user: Option<Uuid>,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(user) = user {
            request = request.header(USER_HEADER, user.to_string());
        }
        let request = request
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
}
