//! Errors are defined per pipeline step and preserve the step that produced
//! them, so an aborted chronicle always says where the failure happened.

use std::fmt;

use serde::Deserialize;
use thiserror::Error;

use crate::provider::ProviderError;

use super::StepId;
use super::schema::SchemaIssues;

/// Failure of one concrete pipeline step.
#[derive(Debug, Error)]
pub enum StepError {
    #[error("extraction failed: {0}")]
    Extract(#[from] ExtractError),
    #[error("schema conversion failed: {0}")]
    Schema(#[from] SchemaError),
    #[error("content review failed: {0}")]
    Review(#[from] ReviewError),
}

/// Errors produced by the extraction step.
#[derive(Debug, Error)]
pub enum ExtractError {
    #[error("source text is empty")]
    EmptyInput,
    #[error("LLM call failed: {0}")]
    Llm(#[from] ProviderError),
    #[error("LLM returned an empty response")]
    EmptyResponse,
    #[error("LLM response is not valid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("LLM response is not a JSON array")]
    NotAnArray,
}

/// Errors produced by the static schema conversion step.
#[derive(Debug, Error)]
pub enum SchemaError {
    #[error("no candidate JSON available")]
    NoCandidate,
    #[error("question schema violations: {0}")]
    Invalid(#[from] SchemaIssues),
    #[error("failed to serialize validated questions: {0}")]
    Serialize(#[source] serde_json::Error),
}

/// One issue reported by the content-review LLM.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct ReviewIssue {
    #[serde(default)]
    pub topic: Option<usize>,
    #[serde(default)]
    pub question: Option<usize>,
    #[serde(default)]
    pub field: Option<String>,
    pub reason: String,
}

impl fmt::Display for ReviewIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(topic) = self.topic {
            let separator = if self.question.is_none() && self.field.is_none() {
                ": "
            } else {
                " "
            };
            write!(f, "topic {topic}{separator}")?;
        }
        match (self.question, &self.field) {
            (Some(question), Some(field)) => {
                write!(f, "question {question} `{field}`: {}", self.reason)
            }
            (Some(question), None) => {
                write!(f, "question {question}: {}", self.reason)
            }
            (None, Some(field)) => write!(f, "`{field}`: {}", self.reason),
            (None, None) => f.write_str(&self.reason),
        }
    }
}

/// Collection of all issues reported by one review.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReviewIssues(pub Vec<ReviewIssue>);

impl fmt::Display for ReviewIssues {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const MAX_SHOWN: usize = 20;

        for (index, issue) in self.0.iter().take(MAX_SHOWN).enumerate() {
            if index > 0 {
                f.write_str("; ")?;
            }
            write!(f, "{issue}")?;
        }

        if self.0.len() > MAX_SHOWN {
            write!(f, "; ... and {} more", self.0.len() - MAX_SHOWN)?;
        }

        Ok(())
    }
}

impl std::error::Error for ReviewIssues {}

/// Errors produced by the content-review step.
#[derive(Debug, Error)]
pub enum ReviewError {
    #[error("no validated questions available")]
    MissingQuestions,
    #[error("LLM call failed: {0}")]
    Llm(#[from] ProviderError),
    #[error("LLM returned an empty response")]
    EmptyResponse,
    #[error("LLM returned an invalid review response: {0}")]
    InvalidResponse(#[source] serde_json::Error),
    #[error("failed to serialize questions: {0}")]
    Serialize(#[source] serde_json::Error),
    #[error("content review rejected the questions: {0}")]
    Rejected(#[from] ReviewIssues),
}

/// Errors of the pipeline runner itself.
#[derive(Debug, Error)]
pub enum PipelineError {
    #[error("pipeline has no steps")]
    NoSteps,
    #[error("duplicate pipeline step `{0}`")]
    DuplicateStep(StepId),
    #[error("step `{from}` jumped to unknown step `{target}`")]
    UnknownStep { from: StepId, target: StepId },
    #[error("step `{step}` exceeded its limit of {limit} errors (last error: {last_error})")]
    StepErrorLimit {
        step: StepId,
        limit: usize,
        last_error: Box<StepError>,
    },
    #[error("pipeline exceeded the transition limit of {limit}")]
    TransitionLimitExceeded { limit: usize },
    #[error("pipeline finished without producing questions")]
    MissingOutput,
}
