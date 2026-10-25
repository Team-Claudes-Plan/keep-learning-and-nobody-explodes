use apalis::prelude::{BoxDynError, Data};

use crate::provider::Client;

#[derive(Clone, Debug)]
pub struct ChronicleJob {
    pub id: String,
    pub language: String,
    pub topic: String,
    pub text: String,
}

pub async fn process_chronicle(
    job: ChronicleJob,
    Data(_client): Data<Client>,
) -> Result<(), BoxDynError> {
    tracing::info!(
        id = %job.id,
        language = %job.language,
        topic = %job.topic,
        characters = job.text.len(),
        "processing chronicle"
    );

    Ok(())
}
