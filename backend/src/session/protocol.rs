//! Wire format of the session websocket, see `schema/session-protocol.md`.
//!
//! Every message is a JSON object tagged by `type`. Gameplay events
//! ([`GameEvent`]) are persisted in `game_events` and broadcast wrapped in a
//! [`ServerMessage::Event`] carrying their sequence number.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Strikes that blow up the bomb.
pub const MAX_STRIKES: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Defuser,
    Expert,
}

impl Role {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Defuser => "defuser",
            Self::Expert => "expert",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Won,
    Lost,
    Aborted,
}

impl Outcome {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Won => "won",
            Self::Lost => "lost",
            Self::Aborted => "aborted",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EndReason {
    AllResolved,
    Strikes,
    Timeout,
    Forfeit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PartResult {
    Solved,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The answer value per question type, see `schema/answer-submission.schema.json`.
/// A `questionId` sent along is ignored, the turn identifies the question.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "answer", rename_all = "snake_case")]
pub enum Answer {
    SingleChoice(u32),
    MultipleChoice(Vec<u32>),
    TrueFalse(Vec<bool>),
    TextInput(String),
    NumberInput(f64),
    Matching(Vec<u32>),
    Grouping(Vec<u32>),
    Coords(Point),
    Order(Vec<u32>),
}

impl Answer {
    #[must_use]
    pub fn question_type(&self) -> &'static str {
        match self {
            Self::SingleChoice(_) => "single_choice",
            Self::MultipleChoice(_) => "multiple_choice",
            Self::TrueFalse(_) => "true_false",
            Self::TextInput(_) => "text_input",
            Self::NumberInput(_) => "number_input",
            Self::Matching(_) => "matching",
            Self::Grouping(_) => "grouping",
            Self::Coords(_) => "coords",
            Self::Order(_) => "order",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Opens a lobby; the sender takes seat 0.
    Create {
        topics: Vec<Uuid>,
        question_count: u16,
        role: Option<Role>,
        time_limit_secs: Option<u32>,
    },
    /// Takes seat 1 of a waiting game, which starts it.
    Join {
        game_id: Uuid,
        role: Option<Role>,
    },
    /// Reconnects with the token from `welcome`. With `last_sequence`, missed
    /// events are replayed instead of sending a snapshot.
    Resume {
        game_id: Uuid,
        token: Uuid,
        last_sequence: Option<u32>,
    },
    /// Only the defuser of `turn` may answer, once.
    SubmitAnswer {
        turn: u32,
        answer: Answer,
    },
    Forfeit,
}

/// Persisted gameplay events. The game state is the fold of these.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    GameCreated {
        topics: Vec<Uuid>,
        question_count: u16,
        time_limit_secs: u32,
        created_by: Uuid,
        parts: Vec<PartInfo>,
    },
    PlayerJoined {
        player_id: Uuid,
        seat: u8,
        role: Option<Role>,
    },
    GameStarted {
        deadline: DateTime<Utc>,
        starting_defuser: Uuid,
    },
    TurnStarted {
        turn: u32,
        defuser: Uuid,
        expert: Uuid,
    },
    AnswerSubmitted {
        turn: u32,
        actor: Uuid,
        answer: Answer,
        correct: bool,
        solution: Value,
        strikes: u8,
    },
    GameEnded {
        outcome: Outcome,
        reason: EndReason,
    },
}

impl GameEvent {
    /// The `game_events.event_type` value, equal to the serialized tag.
    #[must_use]
    pub fn kind(&self) -> &'static str {
        match self {
            Self::GameCreated { .. } => "game_created",
            Self::PlayerJoined { .. } => "player_joined",
            Self::GameStarted { .. } => "game_started",
            Self::TurnStarted { .. } => "turn_started",
            Self::AnswerSubmitted { .. } => "answer_submitted",
            Self::GameEnded { .. } => "game_ended",
        }
    }

    /// The player who caused the event, stored as `game_events.actor_id`.
    #[must_use]
    pub fn actor(&self) -> Option<Uuid> {
        match self {
            Self::GameCreated { created_by, .. } => Some(*created_by),
            Self::PlayerJoined { player_id, .. } => Some(*player_id),
            Self::AnswerSubmitted { actor, .. } => Some(*actor),
            Self::GameStarted { .. } | Self::TurnStarted { .. } | Self::GameEnded { .. } => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartInfo {
    pub position: u32,
    pub task_id: Uuid,
    pub question_type: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    Welcome {
        game_id: Uuid,
        player_id: Uuid,
        token: Uuid,
        seat: u8,
    },
    Snapshot {
        state: GameView,
    },
    Event {
        sequence: u32,
        at: DateTime<Utc>,
        event: GameEvent,
    },
    /// Private to one player: what their role gets to see this turn.
    Briefing {
        turn: u32,
        #[serde(flatten)]
        brief: Brief,
    },
    Presence {
        player_id: Uuid,
        online: bool,
    },
    Error {
        code: ErrorCode,
        message: String,
    },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum Brief {
    /// The question as in `questions.schema.json`, without its prompt.
    Defuser { task: Value },
    /// The prompt and the manual page for the defuser's module.
    Expert {
        question_type: String,
        prompt: Option<Value>,
        instruction: Value,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct GameView {
    pub game_id: Uuid,
    pub status: Status,
    pub topics: Vec<Uuid>,
    pub players: Vec<PlayerView>,
    pub deadline: Option<DateTime<Utc>>,
    pub turn: Option<u32>,
    pub defuser: Option<Uuid>,
    pub expert: Option<Uuid>,
    pub strikes: u8,
    pub max_strikes: u8,
    pub parts: Vec<PartView>,
    pub reason: Option<EndReason>,
    pub last_sequence: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Waiting,
    Active,
    Won,
    Lost,
    Aborted,
}

impl From<Outcome> for Status {
    fn from(outcome: Outcome) -> Self {
        match outcome {
            Outcome::Won => Self::Won,
            Outcome::Lost => Self::Lost,
            Outcome::Aborted => Self::Aborted,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PlayerView {
    pub player_id: Uuid,
    pub seat: u8,
    pub online: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PartView {
    pub position: u32,
    pub question_type: String,
    pub result: Option<PartResult>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    BadMessage,
    UnknownGame,
    GameFull,
    InvalidToken,
    NotYourTurn,
    StaleTurn,
    InvalidState,
    NoTasks,
    Internal,
}
