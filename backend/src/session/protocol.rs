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
    ///
    /// With `skill_id` (and the `island_id` it is played on) the bomb is a
    /// storey of a house: its tasks come from that skill only, `topics` is
    /// ignored and winning passes the storey. With `invited` only that user
    /// may join and the game is not listed in the lobby.
    Create {
        #[serde(default)]
        topics: Vec<Uuid>,
        question_count: u16,
        role: Option<Role>,
        time_limit_secs: Option<u32>,
        skill_id: Option<Uuid>,
        island_id: Option<Uuid>,
        invited: Option<Uuid>,
    },
    /// Takes seat 1 of a waiting game. The roles are dealt, then both
    /// players confirm with `ready`.
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
    /// The sender is ready to play; once both are, the game starts.
    Ready,
    /// Only the defuser may answer, once per part, in any order. `turn` is
    /// the position of the part.
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
        /// The storey (skill) the bomb is played on.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        skill_id: Option<Uuid>,
        /// The only user who may join.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        invited: Option<Uuid>,
    },
    PlayerJoined {
        player_id: Uuid,
        seat: u8,
        role: Option<Role>,
    },
    /// Both seats are taken: who defuses first. The game waits for both
    /// players to be ready.
    RolesAssigned {
        defuser: Uuid,
        expert: Uuid,
    },
    PlayerReady {
        player_id: Uuid,
    },
    GameStarted {
        deadline: DateTime<Utc>,
        starting_defuser: Uuid,
    },
    /// Only in games from before all modules were open at once; new games
    /// never log it.
    TurnStarted {
        turn: u32,
        defuser: Uuid,
        expert: Uuid,
    },
    AnswerSubmitted {
        /// The position of the answered part.
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
            Self::RolesAssigned { .. } => "roles_assigned",
            Self::PlayerReady { .. } => "player_ready",
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
            Self::PlayerJoined { player_id, .. } | Self::PlayerReady { player_id } => {
                Some(*player_id)
            }
            Self::AnswerSubmitted { actor, .. } => Some(*actor),
            Self::RolesAssigned { .. }
            | Self::GameStarted { .. }
            | Self::TurnStarted { .. }
            | Self::GameEnded { .. } => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PartInfo {
    pub position: u32,
    pub task_id: Uuid,
    pub question_type: String,
    /// Symbols for the answers of this part, in list order, none shared with
    /// another part of the game. Empty if the part is shown as text.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub glyphs: Vec<u8>,
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
    /// Private to one player: what their role gets to see of the whole
    /// bomb. Sent once the game starts and again on every (re)connect.
    Briefing {
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
    /// Every module on the bomb, see `brief.rs` for what each question type
    /// shows.
    Defuser { parts: Vec<DefuserPart> },
    /// The manual: one page per module, in a random order and without saying
    /// which module a page is for.
    Expert { pages: Vec<ManualPage> },
}

/// One module as the defuser sees it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct DefuserPart {
    /// The part this module answers (`turn` of `submit_answer`).
    pub position: u32,
    /// The question as in `questions.schema.json`, reduced to the defuser's
    /// half (see `brief.rs`).
    ///
    /// With `glyphs`, the list that `glyphs::symbol_field` names is missing;
    /// entry `i` of it is shown as symbol `glyphs[i]` instead.
    pub task: Value,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub glyphs: Vec<u8>,
}

/// One page of the expert's manual: the other half of one module.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ManualPage {
    /// The question, when only the expert has it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<Value>,
    /// Free-text terminals: the user logged in on the defuser's terminal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    /// True/false: statement `i` is "Aussage i + 1" on the bomb.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub statements: Vec<Value>,
    /// What the defuser's symbols stand for, in a random order.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub symbols: Vec<Symbol>,
}

/// One symbol on the defuser's module and the answer it stands for.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Symbol {
    pub glyph: u8,
    pub text: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct GameView {
    pub game_id: Uuid,
    pub status: Status,
    pub topics: Vec<Uuid>,
    pub skill_id: Option<Uuid>,
    pub invited: Option<Uuid>,
    pub players: Vec<PlayerView>,
    pub deadline: Option<DateTime<Utc>>,
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
    /// Both players are seated; the game starts once both are ready.
    Ready,
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
    /// Confirmed `ready` (always true once the game started).
    pub ready: bool,
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
    /// The storey is not unlocked for the island yet.
    SkillLocked,
    /// The creator is not a member of the island, or the skill is not on it.
    NotIslandMember,
    /// The game is private to another user.
    NotInvited,
    Internal,
}
