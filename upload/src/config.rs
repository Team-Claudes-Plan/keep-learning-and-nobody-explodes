//! Runtime configuration read from environment variables.

use std::env;

use anyhow::{Context, Result};

/// Default request body limit: 256 MiB, enough for large scanned course PDFs.
const DEFAULT_MAX_UPLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Default bind address; loopback only so the dev service is not exposed.
const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:8081";

#[allow(
    clippy::doc_markdown,
    reason = "Clippy wants RustFS to be backticked, for whatever reason"
)]
/// Default S3 region. RustFS ignores it, but the SDK requires one.
const DEFAULT_S3_REGION: &str = "us-east-1";

/// Settings for the ingestion service.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the HTTP server binds to (`LISTEN_ADDR`).
    pub listen_addr: String,
    /// Maximum accepted upload size in bytes (`MAX_UPLOAD_BYTES`).
    pub max_upload_bytes: usize,
    /// S3 connection settings.
    pub s3: S3Config,
}

/// Connection settings for the S3-compatible object store.
#[derive(Clone)]
pub struct S3Config {
    /// Endpoint URL (`S3_ENDPOINT`).
    pub endpoint: String,
    /// Access key (`S3_ACCESS_KEY`).
    pub access_key: String,
    /// Secret key (`S3_SECRET_KEY`).
    pub secret_key: String,
    /// Bucket receiving uploads (`S3_BUCKET`).
    pub bucket: String,
    /// Region name (`S3_REGION`).
    pub region: String,
}

// Manual impl so the secret key never ends up in logs.
impl std::fmt::Debug for S3Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("S3Config")
            .field("endpoint", &self.endpoint)
            .field("access_key", &self.access_key)
            .field("secret_key", &"<redacted>")
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .finish()
    }
}

impl Config {
    /// Reads the configuration from the process environment.
    ///
    /// # Errors
    ///
    /// Returns an error if a required variable is missing or
    /// `MAX_UPLOAD_BYTES` is not an integer.
    pub fn from_env() -> Result<Self> {
        let max_upload_bytes = match env::var("MAX_UPLOAD_BYTES") {
            Ok(value) => value
                .parse()
                .context("MAX_UPLOAD_BYTES must be an integer")?,
            Err(_) => DEFAULT_MAX_UPLOAD_BYTES,
        };

        Ok(Self {
            listen_addr: env::var("LISTEN_ADDR").unwrap_or_else(|_| DEFAULT_LISTEN_ADDR.into()),
            max_upload_bytes,
            s3: S3Config {
                endpoint: required("S3_ENDPOINT")?,
                access_key: required("S3_ACCESS_KEY")?,
                secret_key: required("S3_SECRET_KEY")?,
                bucket: required("S3_BUCKET")?,
                region: env::var("S3_REGION").unwrap_or_else(|_| DEFAULT_S3_REGION.into()),
            },
        })
    }
}

fn required(var: &str) -> Result<String> {
    env::var(var).with_context(|| format!("{var} is not set (run via `nix run .#dev`)"))
}
