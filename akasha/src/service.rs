use apalis::prelude::TaskSink;
use apalis_core::backend::dequeue::VecDequeBackend;

use grpc::akasha::{
    Language, ManifestTrialsRequest, ManifestTrialsResponse, akasha_service_server::AkashaService,
};
use tonic::{Request, Response, Status};
use tracing::{error, info, warn};
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
            warn!("rejected ManifestTrials request: missing chronicle");
            return Err(Status::invalid_argument("Request is missing chronicle"));
        };

        info!(
            id = %chronicle.id,
            island_id = %chronicle.island_id,
            language = chronicle.language,
            text_chars = chronicle.text.len(),
            "received ManifestTrials request"
        );

        let language = match Language::try_from(chronicle.language) {
            Ok(Language::English) => "English",
            Ok(Language::German) => "German",
            Ok(Language::Unspecified) => {
                warn!(
                    id = %chronicle.id,
                    language = chronicle.language,
                    "rejected ManifestTrials request: language is unspecified"
                );
                return Err(Status::invalid_argument("Language must be specified"));
            }
            Err(_) => {
                warn!(
                    id = %chronicle.id,
                    language = chronicle.language,
                    "rejected ManifestTrials request: unknown language"
                );
                return Err(Status::invalid_argument("Unknown language"));
            }
        };

        let Ok(island_id) = Uuid::parse_str(&chronicle.island_id) else {
            warn!(
                id = %chronicle.id,
                island_id = %chronicle.island_id,
                "rejected ManifestTrials request: island_id is not a UUID"
            );
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
        let job_id = job.id.clone();

        if let Err(e) = storage.push(job).await {
            error!(
                id = %job_id,
                island_id = %island_id,
                error = %e,
                "failed to enqueue chronicle"
            );
            return Err(Status::internal("Failed to process request"));
        }

        info!(
            id = %job_id,
            island_id = %island_id,
            language = %language,
            "chronicle enqueued"
        );

        Ok(Response::new(ManifestTrialsResponse {}))
    }
}
