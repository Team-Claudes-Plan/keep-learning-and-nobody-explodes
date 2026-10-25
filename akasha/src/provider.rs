use std::fmt;

use async_openai::{
    Client as OpenAiClient,
    config::OpenAIConfig,
    error::OpenAIError,
    types::chat::{
        ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
        ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs,
        ResponseFormat as OpenAiResponseFormat,
    },
};
use thiserror::Error;

/// A chat completion request failed.
#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("request failed: {0}")]
    Request(#[from] OpenAIError),
    #[error("response contains no choices")]
    NoChoices,
    #[error("response choice contains no content")]
    NoContent,
}

/// Requested response format.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutputFormat {
    /// Provider default (plain text); the prompt still asks for JSON.
    Text,
    /// The provider must return a single JSON object.
    JsonObject,
}

/// The LLM surface used by pipeline steps.
///
/// This is a native async trait with an explicit `Send` future. The pipeline is
/// generic over the implementation, so no `dyn` dispatch or `async-trait` crate
/// is needed.
pub trait Llm: Clone + fmt::Debug + Send + Sync + 'static {
    fn complete<'a>(
        &'a self,
        system: &'a str,
        user: &'a str,
        temperature: f32,
        format: OutputFormat,
    ) -> impl Future<Output = Result<String, ProviderError>> + Send + 'a;
}

/// async-openai client configured from [`crate::AkashaConfig`].
#[derive(Clone, Debug)]
pub struct Client {
    inner: OpenAiClient<OpenAIConfig>,
    model: String,
}

impl Client {
    #[must_use]
    pub fn new(base_url: &str, api_key: &str, model: &str) -> Self {
        let config = OpenAIConfig::new()
            .with_api_base(base_url)
            .with_api_key(api_key);

        Self {
            inner: OpenAiClient::with_config(config),
            model: model.to_owned(),
        }
    }
}

impl Llm for Client {
    async fn complete<'a>(
        &'a self,
        system: &'a str,
        user: &'a str,
        temperature: f32,
        format: OutputFormat,
    ) -> Result<String, ProviderError> {
        let system = ChatCompletionRequestSystemMessageArgs::default()
            .content(system)
            .build()?;
        let user = ChatCompletionRequestUserMessageArgs::default()
            .content(user)
            .build()?;

        let mut request = CreateChatCompletionRequestArgs::default();
        request
            .model(&self.model)
            .messages(vec![
                ChatCompletionRequestMessage::System(system),
                ChatCompletionRequestMessage::User(user),
            ])
            .temperature(temperature);

        if format == OutputFormat::JsonObject {
            request.response_format(OpenAiResponseFormat::JsonObject);
        }

        let request = request.build()?;

        let response = self.inner.chat().create(request).await?;
        let choice = response
            .choices
            .into_iter()
            .next()
            .ok_or(ProviderError::NoChoices)?;

        choice
            .message
            .content
            .filter(|content| !content.trim().is_empty())
            .ok_or(ProviderError::NoContent)
    }
}
