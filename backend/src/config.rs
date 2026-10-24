//! Runtime configuration read from environment variables.

use std::env;

use anyhow::{Context, Result, bail};
use grpc::akasha::Language;

/// Default request body limit: 256 MiB, enough for large scanned course PDFs.
const DEFAULT_MAX_UPLOAD_BYTES: usize = 256 * 1024 * 1024;

/// Default bind address; loopback only so the dev service is not exposed.
const DEFAULT_LISTEN_ADDR: &str = "127.0.0.1:8081";

/// Default address of the Akasha gRPC service.
const DEFAULT_AKASHA_GRPC_URL: &str = "http://127.0.0.1:50051";

/// Default language sent to Akasha.
const DEFAULT_AKASHA_LANGUAGE: &str = "german";

#[expect(clippy::doc_markdown, reason = "RustFS is not an item")]
/// Default S3 region. RustFS ignores it, but the SDK requires one.
const DEFAULT_S3_REGION: &str = "us-east-1";

/// Settings for the ingestion service.
#[derive(Debug, Clone)]
pub struct Config {
    /// Address the HTTP server binds to (`LISTEN_ADDR`).
    pub listen_addr: String,
    /// Maximum accepted upload size in bytes (`MAX_UPLOAD_BYTES`).
    pub max_upload_bytes: usize,
    /// PostgreSQL connection URL (`DATABASE_URL`).
    pub database_url: String,
    /// Bearer token required for `RustFS` webhook requests (`WEBHOOK_TOKEN`).
    pub webhook_token: String,
    /// Address of the Akasha gRPC service (`AKASHA_GRPC_URL`).
    pub akasha_grpc_url: String,
    /// Language sent to Akasha (`AKASHA_LANGUAGE`).
    pub akasha_language: Language,
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

        let akasha_language = match env::var("AKASHA_LANGUAGE")
            .unwrap_or_else(|_| DEFAULT_AKASHA_LANGUAGE.to_owned())
            .to_ascii_lowercase()
            .as_str()
        {
            "english" | "en" => Language::English,
            "german" | "de" => Language::German,
            other => bail!("AKASHA_LANGUAGE must be `english` or `german`, got `{other}`"),
        };

        Ok(Self {
            listen_addr: env::var("LISTEN_ADDR").unwrap_or_else(|_| DEFAULT_LISTEN_ADDR.into()),
            max_upload_bytes,
            database_url: required("DATABASE_URL")?,
            webhook_token: required("WEBHOOK_TOKEN")?,
            akasha_grpc_url: env::var("AKASHA_GRPC_URL")
                .unwrap_or_else(|_| DEFAULT_AKASHA_GRPC_URL.into()),
            akasha_language,
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
