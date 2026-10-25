//! Lazy client for the Akasha gRPC service.

use grpc::akasha::{
    Chronicle, Language, ManifestTrialsRequest, akasha_service_client::AkashaServiceClient,
};
use tonic::transport::{Channel, Endpoint};
use uuid::Uuid;

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

    /// Sends one chronicle to Akasha for question extraction. Akasha files the
    /// questions under topics of `island_id`, which must own the document.
    pub async fn manifest_trials(
        &self,
        document_id: Uuid,
        island_id: Uuid,
        island_name: &str,
        text: &str,
    ) -> Result<(), tonic::Status> {
        let mut client = self.client.clone();
        client
            .manifest_trials(ManifestTrialsRequest {
                chronicle: Some(Chronicle {
                    id: document_id.to_string(),
                    island_id: island_id.to_string(),
                    island_name: island_name.to_owned(),
                    language: self.language as i32,
                    text: text.to_owned(),
                }),
            })
            .await?;
        Ok(())
    }
}
