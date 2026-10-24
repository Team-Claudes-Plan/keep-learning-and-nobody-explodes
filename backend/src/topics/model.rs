//! Wire types of the learning content API.
//!
//! [`Question`] mirrors `questions.schema.json`; questions never contain solutions.

use serde::Serialize;

/// A subject area, e.g. mathematics.
#[derive(Debug, Clone, Serialize)]
pub struct Topic {
    pub id: String,
    pub name: String,
}

/// A skill level within a topic. Id `0` is the absolute beginner.
#[derive(Debug, Clone, Serialize)]
pub struct Level {
    pub id: u32,
    pub name: String,
}

/// A question as delivered to the client, tagged by its `type`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Question {
    SingleChoice {
        id: String,
        prompt: String,
        options: Vec<String>,
    },
    MultipleChoice {
        id: String,
        prompt: String,
        options: Vec<String>,
    },
    TrueFalse {
        id: String,
        statements: Vec<String>,
    },
    TextInput {
        id: String,
        prompt: String,
    },
    NumberInput {
        id: String,
        prompt: String,
        unit: Option<String>,
    },
    Matching {
        id: String,
        left: Vec<String>,
        right: Vec<String>,
    },
    Grouping {
        id: String,
        categories: Vec<String>,
        items: Vec<String>,
    },
    Coords {
        id: String,
        prompt: String,
        image: String,
    },
    Order {
        id: String,
        prompt: String,
        items: Vec<String>,
    },
}

impl Question {
    /// Returns the question id.
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::SingleChoice { id, .. }
            | Self::MultipleChoice { id, .. }
            | Self::TrueFalse { id, .. }
            | Self::TextInput { id, .. }
            | Self::NumberInput { id, .. }
            | Self::Matching { id, .. }
            | Self::Grouping { id, .. }
            | Self::Coords { id, .. }
            | Self::Order { id, .. } => id,
        }
    }
}
