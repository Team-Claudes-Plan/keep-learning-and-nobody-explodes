//! Who is calling. There is no authentication yet: the client names its user
//! in the `X-User-Id` header, or in the `user_id` query parameter where it
//! cannot set headers (websockets in the browser).

use std::sync::Arc;

use axum::{
    extract::{FromRequestParts, Query},
    http::request::Parts,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::{GlobalState, api::error::ApiError, db::UserSummary};

pub const USER_HEADER: &str = "x-user-id";

/// The user a request is made by; rejects the request with 401 if it names
/// no existing user.
#[derive(Debug, Clone)]
pub struct CurrentUser(pub UserSummary);

impl CurrentUser {
    #[must_use]
    pub fn id(&self) -> Uuid {
        self.0.id
    }
}

#[derive(Deserialize)]
struct UserQuery {
    user_id: Option<String>,
}

/// The raw user id of a request: the header wins over the query parameter.
fn requested_user(parts: &Parts) -> Option<String> {
    if let Some(value) = parts.headers.get(USER_HEADER) {
        return value.to_str().ok().map(str::to_owned);
    }
    Query::<UserQuery>::try_from_uri(&parts.uri)
        .ok()
        .and_then(|Query(query)| query.user_id)
}

impl FromRequestParts<Arc<GlobalState>> for CurrentUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<GlobalState>,
    ) -> Result<Self, Self::Rejection> {
        let Some(raw) = requested_user(parts) else {
            return Err(ApiError::Unauthorized(format!(
                "name the user in the `{USER_HEADER}` header"
            )));
        };
        let id: Uuid = raw
            .trim()
            .parse()
            .map_err(|_error| ApiError::Unauthorized("user id is not a UUID".to_owned()))?;
        state
            .db
            .user(id)
            .await
            .map_err(|error| ApiError::db("look up user", &error))?
            .map(Self)
            .ok_or_else(|| ApiError::Unauthorized(format!("user {id} does not exist")))
    }
}

#[cfg(test)]
mod tests {
    use axum::http::Request;

    use super::*;

    fn parts(request: Request<()>) -> Parts {
        request.into_parts().0
    }

    #[test]
    fn reads_the_header() {
        let parts = parts(
            Request::get("/api/islands")
                .header(USER_HEADER, "abc")
                .body(())
                .expect("request"),
        );
        assert_eq!(requested_user(&parts).as_deref(), Some("abc"));
    }

    #[test]
    fn falls_back_to_the_query() {
        let parts = parts(
            Request::get("/api/sessions/ws?user_id=abc")
                .body(())
                .expect("request"),
        );
        assert_eq!(requested_user(&parts).as_deref(), Some("abc"));
    }

    #[test]
    fn header_wins_over_query() {
        let parts = parts(
            Request::get("/api/sessions/ws?user_id=query")
                .header(USER_HEADER, "header")
                .body(())
                .expect("request"),
        );
        assert_eq!(requested_user(&parts).as_deref(), Some("header"));
    }

    #[test]
    fn missing_user_is_none() {
        let parts = parts(Request::get("/api/islands").body(()).expect("request"));
        assert_eq!(requested_user(&parts), None);
    }
}
