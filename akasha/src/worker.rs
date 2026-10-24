use apalis::prelude::{BoxDynError, Data};

use crate::provider::Client;

#[derive(Clone, Debug)]
pub struct ChronicleJob {
    pub language: String,
    pub text: String,
}

pub async fn process_chronicle(
    job: ChronicleJob,
    Data(_client): Data<Client>,
) -> Result<(), BoxDynError> {
    tracing::info!(
        language = %job.language,
        characters = job.text.len(),
        "processing chronicle"
    );

    Ok(())
}
