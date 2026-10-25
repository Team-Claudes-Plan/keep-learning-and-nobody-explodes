use std::fmt;
use std::time::Instant;

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
use serde::Deserialize;
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

/// Minimal chat-completion response.
///
/// `async-openai`'s typed response rejects provider-specific values such as
/// `service_tier: "asap"` from OpenAI-compatible gateways. The `byot` response
/// ignores unknown fields and only extracts what the pipeline needs.
#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    model: String,
    #[serde(default)]
    choices: Vec<ChatChoice>,
    #[serde(default)]
    usage: Option<ChatUsage>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatUsage {
    #[serde(default, rename = "prompt_tokens")]
    prompt: u32,
    #[serde(default, rename = "completion_tokens")]
    completion: u32,
    #[serde(default, rename = "total_tokens")]
    total: u32,
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
        let started = Instant::now();

        tracing::debug!(
            model = %self.model,
            temperature,
            format = ?format,
            system_chars = system.len(),
            user_chars = user.len(),
            "LLM request started"
        );
        tracing::trace!(
            model = %self.model,
            system = %system,
            user = %user,
            "LLM prompt content"
        );

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

        let response: ChatCompletionResponse = match self.inner.chat().create_byot(&request).await {
            Ok(response) => response,
            Err(error) => {
                tracing::warn!(
                    model = %self.model,
                    elapsed_ms = started.elapsed().as_millis(),
                    error = %error,
                    "LLM request failed"
                );
                return Err(error.into());
            }
        };

        let response_model = response.model.clone();
        let (prompt_tokens, completion_tokens, total_tokens) =
            response.usage.as_ref().map_or((0, 0, 0), |usage| {
                (usage.prompt, usage.completion, usage.total)
            });
        let Some(choice) = response.choices.into_iter().next() else {
            tracing::warn!(
                model = %self.model,
                elapsed_ms = started.elapsed().as_millis(),
                "LLM response contains no choices"
            );
            return Err(ProviderError::NoChoices);
        };

        let Some(content) = choice
            .message
            .content
            .filter(|content| !content.trim().is_empty())
        else {
            tracing::warn!(
                model = %self.model,
                elapsed_ms = started.elapsed().as_millis(),
                "LLM response choice contains no content"
            );
            return Err(ProviderError::NoContent);
        };

        tracing::info!(
            model = %self.model,
            response_model = %response_model,
            elapsed_ms = started.elapsed().as_millis(),
            response_chars = content.len(),
            prompt_tokens,
            completion_tokens,
            total_tokens,
            "LLM request completed"
        );
        tracing::trace!(
            model = %self.model,
            response = %content,
            "LLM response content"
        );

        Ok(content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_provider_specific_response_fields() {
        let response: ChatCompletionResponse = serde_json::from_str(
            r#"{
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "created": 1,
                "model": "test-model",
                "service_tier": "asap",
                "choices": [
                    {
                        "index": 0,
                        "message": { "role": "assistant", "content": "hello" },
                        "finish_reason": "stop"
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 2,
                    "total_tokens": 12
                }
            }"#,
        )
        .expect("provider-specific fields should be ignored");

        assert_eq!(response.model, "test-model");
        assert_eq!(
            response.choices[0].message.content.as_deref(),
            Some("hello")
        );
        assert_eq!(response.usage.expect("usage should be parsed").total, 12);
    }
}
