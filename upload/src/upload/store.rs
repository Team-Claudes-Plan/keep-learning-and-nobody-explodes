//! Object store access for uploads.

use std::sync::Arc;

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

    /// Reads the object at `key`; used by tests to verify uploads.
    #[cfg(test)]
    pub async fn get(&self, key: &str) -> Vec<u8> {
        let output = self
            .client
            .get_object()
            .bucket(&*self.bucket)
            .key(key)
            .send()
            .await
            .expect("object should exist");
        output
            .body
            .collect()
            .await
            .expect("body should be readable")
            .to_vec()
    }
}
