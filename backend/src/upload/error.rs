//! Error type for the upload endpoint.

use std::{backtrace::Backtrace, error::Error, fmt};

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ErrorKind {
    InvalidRequest,
    PayloadTooLarge,
    Storage,
}

/// Error returned while handling an upload.
///
/// Inspect it with [`is_invalid_request`](Self::is_invalid_request),
/// [`is_payload_too_large`](Self::is_payload_too_large), and
/// [`is_storage`](Self::is_storage); the kind itself is not exposed.
#[derive(Debug)]
pub struct UploadError {
    kind: ErrorKind,
    message: String,
    source: Option<Box<dyn Error + Send + Sync>>,
    backtrace: Backtrace,
}

impl UploadError {
    /// Creates an error for a malformed or unusable client request.
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidRequest, message.into(), None)
    }

    /// Creates an error for a body that exceeds the configured upload limit.
    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::PayloadTooLarge, message.into(), None)
    }

    /// Creates an error for a failed write to the object store.
    pub fn storage(source: impl Error + Send + Sync + 'static) -> Self {
        Self::new(
            ErrorKind::Storage,
            "object store write failed".into(),
            Some(Box::new(source)),
        )
    }

    fn new(kind: ErrorKind, message: String, source: Option<Box<dyn Error + Send + Sync>>) -> Self {
        Self {
            kind,
            message,
            source,
            backtrace: Backtrace::capture(),
        }
    }

    /// Returns `true` if the client sent a bad request.
    #[must_use]
    pub fn is_invalid_request(&self) -> bool {
        self.kind == ErrorKind::InvalidRequest
    }

    /// Returns `true` if the body exceeded the configured upload limit.
    #[must_use]
    pub fn is_payload_too_large(&self) -> bool {
        self.kind == ErrorKind::PayloadTooLarge
    }

    /// Returns `true` if the object store rejected or failed the write.
    #[must_use]
    pub fn is_storage(&self) -> bool {
        self.kind == ErrorKind::Storage
    }

    /// Returns the backtrace captured when the error was created.
    #[must_use]
    pub fn backtrace(&self) -> &Backtrace {
        &self.backtrace
    }
}

impl fmt::Display for UploadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for UploadError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        self.source.as_deref().map(|e| e as &(dyn Error + 'static))
    }
}

impl From<axum::extract::multipart::MultipartError> for UploadError {
    fn from(err: axum::extract::multipart::MultipartError) -> Self {
        let message = err.body_text();
        // The body limit is reported as 413; other multipart failures are malformed requests.
        if err.status() == StatusCode::PAYLOAD_TOO_LARGE {
            Self::payload_too_large(message)
        } else {
            Self::invalid_request(message)
        }
    }
}

impl IntoResponse for UploadError {
    fn into_response(self) -> Response {
        if self.is_storage() {
            // Details stay in the log; clients only learn that storage failed.
            tracing::error!(
                name: "upload.storage_failed",
                error = ?self.source,
                backtrace = %self.backtrace(),
                "failed to write upload to object store"
            );
            (StatusCode::BAD_GATEWAY, "failed to store file").into_response()
        } else if self.is_payload_too_large() {
            (StatusCode::PAYLOAD_TOO_LARGE, self.message).into_response()
        } else if self.is_invalid_request() {
            (StatusCode::BAD_REQUEST, self.message).into_response()
        } else {
            unreachable!("every upload error kind has a response")
        }
    }
}
