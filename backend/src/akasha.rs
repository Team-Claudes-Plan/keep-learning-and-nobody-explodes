//! Lazy client for the Akasha gRPC service.

use grpc::akasha::{
    Chronicle, Language, ManifestTrialsRequest, akasha_service_client::AkashaServiceClient,
};
use tonic::transport::{Channel, Endpoint};

/// Cloneable gRPC client whose channel connects on first use and reconnects
/// automatically.
#[derive(Clone, Debug)]
pub struct AkashaClient {
    client: AkashaServiceClient<Channel>,
    language: Language,
}

impl AkashaClient {
    /// Builds a client without connecting. The channel connects on the first
    /// request and reconnects if the connection is lost.
    pub fn lazy(endpoint: &str, language: Language) -> anyhow::Result<Self> {
        let channel = Endpoint::from_shared(endpoint.to_owned())?.connect_lazy();
        Ok(Self {
            client: AkashaServiceClient::new(channel),
            language,
        })
    }

    /// Sends one chronicle to Akasha for question extraction.
    pub async fn manifest_trials(
        &self,
        document_id: &str,
        topic: &str,
        text: &str,
    ) -> Result<(), tonic::Status> {
        let mut client = self.client.clone();
        client
            .manifest_trials(ManifestTrialsRequest {
                chronicle: Some(Chronicle {
                    id: document_id.to_owned(),
                    language: self.language as i32,
                    text: text.to_owned(),
                    topic: topic.to_owned(),
                }),
            })
            .await?;
        Ok(())
    }
}
