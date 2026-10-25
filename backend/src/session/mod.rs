//! Two-player game sessions.
//!
//! Each running game is owned by one actor task ([`actor`]) that serializes
//! all commands, persists the resulting events and broadcasts them to the
//! connected players. [`Sessions`] finds or restores the actor of a game.

mod actor;
mod glyphs;
mod judge;
pub mod protocol;
mod state;

use std::{collections::HashMap, sync::Arc};

use chrono::Utc;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use uuid::Uuid;

use crate::db::{Database, Lobby, NewGame, NewPlayer};
use actor::{Actor, Request};
use protocol::{Answer, ErrorCode, GameEvent, PartInfo, Role, ServerMessage};
use state::GameState;

/// Matches the slots on the bomb in the frontend (`BOMB_SLOTS`).
const MAX_PARTS: u16 = 11;
const DEFAULT_TIME_LIMIT_SECS: u32 = 300;
const TIME_LIMIT_RANGE: std::ops::RangeInclusive<u32> = 30..=3600;

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct SessionError {
    pub code: ErrorCode,
    pub message: String,
}

impl SessionError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Internal, message)
    }

    fn db(error: &sqlx::Error) -> Self {
        tracing::error!(%error, "session database error");
        Self::internal("database error")
    }

    #[must_use]
    pub fn to_message(&self) -> ServerMessage {
        ServerMessage::Error {
            code: self.code,
            message: self.message.clone(),
        }
    }
}

/// The credentials a player receives on create/join.
#[derive(Debug, Clone, Copy)]
pub struct Seat {
    pub game_id: Uuid,
    pub player_id: Uuid,
    pub token: Uuid,
    pub index: u8,
}

impl Seat {
    #[must_use]
    pub fn welcome(&self) -> ServerMessage {
        ServerMessage::Welcome {
            game_id: self.game_id,
            player_id: self.player_id,
            token: self.token,
            seat: self.index,
        }
    }
}

/// A broadcast message; `to` restricts it to one player.
#[derive(Debug, Clone)]
pub struct Outgoing {
    pub to: Option<Uuid>,
    pub message: Arc<ServerMessage>,
}

impl Outgoing {
    #[must_use]
    pub fn is_for(&self, player: Uuid) -> bool {
        self.to.is_none_or(|to| to == player)
    }
}

/// A player's live subscription to a game.
#[derive(Debug)]
pub struct Connection {
    /// Snapshot or missed events, then the current briefing.
    pub initial: Vec<ServerMessage>,
    pub updates: broadcast::Receiver<Outgoing>,
}

#[derive(Debug)]
pub struct CreateGame {
    pub topics: Vec<Uuid>,
    pub question_count: u16,
    pub role: Option<Role>,
    pub time_limit_secs: Option<u32>,
}

type Games = Arc<Mutex<HashMap<Uuid, mpsc::Sender<Request>>>>;

#[derive(Debug)]
pub struct Sessions {
    db: Database,
    games: Games,
}

impl Sessions {
    #[must_use]
    pub fn new(db: Database) -> Self {
        Self {
            db,
            games: Arc::default(),
        }
    }

    pub async fn lobbies(&self) -> Result<Vec<Lobby>, SessionError> {
        self.db
            .list_lobbies()
            .await
            .map_err(|e| SessionError::db(&e))
    }

    pub async fn create(&self, request: CreateGame) -> Result<Seat, SessionError> {
        let time_limit_secs = request.time_limit_secs.unwrap_or(DEFAULT_TIME_LIMIT_SECS);
        if request.topics.is_empty() {
            return Err(SessionError::new(
                ErrorCode::BadMessage,
                "pick at least one topic",
            ));
        }
        if !(1..=MAX_PARTS).contains(&request.question_count) {
            return Err(SessionError::new(
                ErrorCode::BadMessage,
                format!("question_count must be between 1 and {MAX_PARTS}"),
            ));
        }
        if !TIME_LIMIT_RANGE.contains(&time_limit_secs) {
            return Err(SessionError::new(
                ErrorCode::BadMessage,
                format!(
                    "time_limit_secs must be between {} and {}",
                    TIME_LIMIT_RANGE.start(),
                    TIME_LIMIT_RANGE.end()
                ),
            ));
        }

        let tasks = self
            .db
            .pick_tasks(&request.topics, request.question_count)
            .await
            .map_err(|e| SessionError::db(&e))?;
        if tasks.len() < usize::from(request.question_count) {
            return Err(SessionError::new(
                ErrorCode::NoTasks,
                format!("the topics only have {} playable tasks", tasks.len()),
            ));
        }

        // every symbol is used at most once per game
        let demands: Vec<usize> = tasks
            .iter()
            .map(|task| glyphs::symbol_texts(&task.question_type, &task.content).len())
            .collect();
        let part_glyphs = glyphs::assign(&demands, glyphs::random_below);

        let seat = Seat {
            game_id: Uuid::new_v4(),
            player_id: Uuid::new_v4(),
            token: Uuid::new_v4(),
            index: 0,
        };
        let events = vec![
            GameEvent::GameCreated {
                topics: request.topics.clone(),
                question_count: request.question_count,
                time_limit_secs,
                created_by: seat.player_id,
                parts: (0..)
                    .zip(&tasks)
                    .zip(part_glyphs)
                    .map(|((position, task), glyphs)| PartInfo {
                        position,
                        task_id: task.task_id,
                        question_type: task.question_type.clone(),
                        glyphs,
                    })
                    .collect(),
            },
            GameEvent::PlayerJoined {
                player_id: seat.player_id,
                seat: 0,
                role: request.role,
            },
        ];
        let game = NewGame {
            id: seat.game_id,
            topics: &request.topics,
            question_count: request.question_count,
            time_limit_secs,
            tasks: &tasks,
        };
        let creator = NewPlayer {
            id: seat.player_id,
            seat: 0,
            token: seat.token,
            role: request.role,
        };
        self.db
            .create_game(&game, &creator, events, Utc::now())
            .await
            .map_err(|e| SessionError::db(&e))?;

        let mut games = self.games.lock().await;
        let handle = self.spawn(seat.game_id).await?;
        games.insert(seat.game_id, handle);
        Ok(seat)
    }

    pub async fn join(&self, game_id: Uuid, role: Option<Role>) -> Result<Seat, SessionError> {
        self.request(game_id, |reply| Request::Join { role, reply })
            .await?
    }

    pub async fn authenticate(&self, game_id: Uuid, token: Uuid) -> Result<Uuid, SessionError> {
        self.db
            .find_player(game_id, token)
            .await
            .map_err(|e| SessionError::db(&e))?
            .ok_or_else(|| SessionError::new(ErrorCode::InvalidToken, "unknown game or token"))
    }

    pub async fn connect(
        &self,
        game_id: Uuid,
        player: Uuid,
        last_sequence: Option<u32>,
    ) -> Result<Connection, SessionError> {
        self.request(game_id, |reply| Request::Connect {
            player,
            last_sequence,
            reply,
        })
        .await
    }

    pub async fn disconnect(&self, game_id: Uuid, player: Uuid) {
        if let Some(handle) = self.games.lock().await.get(&game_id) {
            // a closed actor has nobody left to tell
            let _ = handle.send(Request::Disconnect { player }).await;
        }
    }

    /// Snapshot and briefing, used to resync after missed broadcasts.
    pub async fn resync(
        &self,
        game_id: Uuid,
        player: Uuid,
    ) -> Result<Vec<ServerMessage>, SessionError> {
        self.request(game_id, |reply| Request::Resync { player, reply })
            .await
    }

    pub async fn submit(
        &self,
        game_id: Uuid,
        player: Uuid,
        turn: u32,
        answer: Answer,
    ) -> Result<(), SessionError> {
        self.request(game_id, |reply| Request::Submit {
            player,
            turn,
            answer: answer.clone(),
            reply,
        })
        .await?
    }

    pub async fn forfeit(&self, game_id: Uuid, player: Uuid) -> Result<(), SessionError> {
        self.request(game_id, |reply| Request::Forfeit { player, reply })
            .await?
    }

    /// Sends a request to the game's actor, restoring the actor from the
    /// event log if it is not running (e.g. after a restart).
    async fn request<T>(
        &self,
        game_id: Uuid,
        make: impl Fn(oneshot::Sender<T>) -> Request,
    ) -> Result<T, SessionError> {
        // An actor that just shut down drops requests unanswered; one retry
        // with a fresh actor covers that race.
        for _ in 0..2 {
            let handle = self.handle(game_id).await?;
            let (reply, response) = oneshot::channel();
            if handle.send(make(reply)).await.is_ok()
                && let Ok(value) = response.await
            {
                return Ok(value);
            }
            let mut games = self.games.lock().await;
            if games.get(&game_id).is_some_and(mpsc::Sender::is_closed) {
                games.remove(&game_id);
            }
        }
        Err(SessionError::internal("game is not available"))
    }

    async fn handle(&self, game_id: Uuid) -> Result<mpsc::Sender<Request>, SessionError> {
        let mut games = self.games.lock().await;
        if let Some(handle) = games.get(&game_id).filter(|h| !h.is_closed()) {
            return Ok(handle.clone());
        }
        let handle = self.spawn(game_id).await?;
        games.insert(game_id, handle.clone());
        Ok(handle)
    }

    /// Starts an actor from the persisted log. Callers hold the `games` lock.
    async fn spawn(&self, game_id: Uuid) -> Result<mpsc::Sender<Request>, SessionError> {
        let log = self
            .db
            .load_game_events(game_id)
            .await
            .map_err(|e| SessionError::db(&e))?;
        if log.is_empty() {
            return Err(SessionError::new(ErrorCode::UnknownGame, "unknown game"));
        }
        let details = self
            .db
            .load_part_details(game_id)
            .await
            .map_err(|e| SessionError::db(&e))?;
        let state = GameState::replay(game_id, log.iter().map(|e| (e.sequence, &e.event)));

        let (handle, requests) = mpsc::channel(32);
        let actor = Actor::new(
            self.db.clone(),
            Arc::clone(&self.games),
            state,
            details,
            log,
        );
        tokio::spawn(actor.run(requests));
        Ok(handle)
    }
}

#[cfg(test)]
mod tests;
