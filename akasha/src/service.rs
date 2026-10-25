use apalis::prelude::TaskSink;
use apalis_core::backend::dequeue::VecDequeBackend;

use grpc::akasha::{
    Language, ManifestTrialsRequest, ManifestTrialsResponse, akasha_service_server::AkashaService,
};
use tonic::{Request, Response, Status};
use tracing::error;
use uuid::Uuid;

use crate::worker::ChronicleJob;

pub struct Akasha {
    storage: VecDequeBackend<ChronicleJob>,
}

impl Akasha {
    pub fn new(storage: VecDequeBackend<ChronicleJob>) -> Self {
        Self { storage }
    }
}

#[tonic::async_trait]
impl AkashaService for Akasha {
    async fn manifest_trials(
        &self,
        request: Request<ManifestTrialsRequest>,
    ) -> Result<Response<ManifestTrialsResponse>, Status> {
        let request = request.into_inner();

        let Some(chronicle) = request.chronicle else {
            return Err(Status::invalid_argument("Request is missing chronicle"));
        };

        let language = match Language::try_from(chronicle.language) {
            Ok(Language::English) => "English",
            Ok(Language::German) => "German",
            Ok(Language::Unspecified) => {
                return Err(Status::invalid_argument("Language must be specified"));
            }
            Err(_) => return Err(Status::invalid_argument("Unknown language")),
        };

        let Ok(island_id) = Uuid::parse_str(&chronicle.island_id) else {
            return Err(Status::invalid_argument("island_id must be a UUID"));
        };

        let job = ChronicleJob {
            id: chronicle.id,
            language: language.to_owned(),
            island_id,
            island_name: chronicle.island_name,
            text: chronicle.text,
        };

        let mut storage = self.storage.clone();

        if let Err(e) = storage.push(job).await {
            error!("Failed to send job to worker: {e}");
            return Err(Status::internal("Failed to process request"));
        }

        Ok(Response::new(ManifestTrialsResponse {}))
    }
}
