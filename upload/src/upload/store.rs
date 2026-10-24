//! Object store access for uploads.

use std::sync::Arc;

use anyhow::Context;
use aws_credential_types::Credentials;
use aws_sdk_s3::{Client, config::Region, primitives::ByteStream};
use axum::body::Bytes;

use super::error::UploadError;
use crate::config::S3Config;

/// Handle to the S3 bucket that receives uploaded files.
///
/// Cloning is cheap; all clones share the same connection pool.
#[derive(Debug, Clone)]
pub struct ObjectStore {
    client: Client,
    bucket: Arc<str>,
}

/// Object data downloaded from the store.
#[derive(Debug)]
pub struct DownloadedObject {
    /// Object contents.
    pub bytes: Bytes,
    /// Content type recorded when the object was uploaded.
    pub content_type: Option<String>,
}

impl ObjectStore {
    /// Connects to the object store described by `config`.
    pub async fn connect(config: &S3Config) -> Self {
        let credentials =
            Credentials::new(&config.access_key, &config.secret_key, None, None, "env");
        let sdk_config = aws_config::defaults(aws_config::BehaviorVersion::latest())
            .region(Region::new(config.region.clone()))
            .credentials_provider(credentials)
            .endpoint_url(&config.endpoint)
            .load()
            .await;
        // RustFS and MinIO address buckets by path, not by virtual-host subdomain.
        let s3_config = aws_sdk_s3::config::Builder::from(&sdk_config)
            .force_path_style(true)
            .build();

        Self {
            client: Client::from_conf(s3_config),
            bucket: Arc::from(config.bucket.as_str()),
        }
    }

    /// Writes `data` to `key` with the given content type.
    ///
    /// # Errors
    ///
    /// Returns a storage error if the object store rejects the request.
    pub async fn put(&self, key: &str, content_type: &str, data: Bytes) -> Result<(), UploadError> {
        self.client
            .put_object()
            .bucket(&*self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(data))
            .send()
            .await
            .map_err(UploadError::storage)?;
        Ok(())
    }

    /// Downloads an object and its content type.
    pub async fn get(&self, key: &str) -> anyhow::Result<DownloadedObject> {
        let output = self
            .client
            .get_object()
            .bucket(&*self.bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("failed to download object {key}"))?;
        let content_type = output.content_type().map(str::to_owned);
        let bytes = output
            .body
            .collect()
            .await
            .with_context(|| format!("failed to read object body for {key}"))?
            .into_bytes();

        Ok(DownloadedObject {
            bytes,
            content_type,
        })
    }
}
