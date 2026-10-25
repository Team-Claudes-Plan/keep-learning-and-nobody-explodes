//! The task owning one game. Commands are handled one at a time: decide,
//! persist, then apply and broadcast, so clients only ever see events that
//! are in the database, in sequence order.

use std::{collections::HashMap, future, sync::Arc, time::Duration};

use chrono::Utc;
use tokio::{
    sync::{broadcast, mpsc, oneshot},
    time::{Instant, sleep, sleep_until},
};
use uuid::Uuid;

use super::{
    Connection, Games, Outgoing, Seat, SessionError,
    protocol::{Answer, GameEvent, Role, ServerMessage, Status},
    state::{Command, GameState},
};
use crate::db::{Database, NewPlayer, PartDetails, StoredEvent};

/// How long a game without connected players stays in memory once it is
/// not running; it can always be restored from the log.
const LINGER: Duration = Duration::from_secs(60);
const BROADCAST_CAPACITY: usize = 64;

#[derive(Debug)]
pub enum Request {
    Join {
        player: Uuid,
        role: Option<Role>,
        reply: oneshot::Sender<Result<Seat, SessionError>>,
    },
    Connect {
        player: Uuid,
        last_sequence: Option<u32>,
        reply: oneshot::Sender<Connection>,
    },
    Resync {
        player: Uuid,
        reply: oneshot::Sender<Vec<ServerMessage>>,
    },
    Disconnect {
        player: Uuid,
    },
    Submit {
        player: Uuid,
        turn: u32,
        answer: Answer,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Ready {
        player: Uuid,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
    Forfeit {
        player: Uuid,
        reply: oneshot::Sender<Result<(), SessionError>>,
    },
}

pub struct Actor {
    db: Database,
    games: Games,
    state: GameState,
    details: Vec<PartDetails>,
    log: Vec<StoredEvent>,
    /// Open connections per player.
    online: HashMap<Uuid, usize>,
    updates: broadcast::Sender<Outgoing>,
}

impl Actor {
    pub fn new(
        db: Database,
        games: Games,
        state: GameState,
        details: Vec<PartDetails>,
        log: Vec<StoredEvent>,
    ) -> Self {
        Self {
            db,
            games,
            state,
            details,
            log,
            online: HashMap::new(),
            updates: broadcast::channel(BROADCAST_CAPACITY).0,
        }
    }

    pub async fn run(mut self, mut requests: mpsc::Receiver<Request>) {
        let id = self.state.id;
        tracing::info!(game = %id, "session actor started");

        loop {
            let deadline = self.timer();
            let idle = self.online.is_empty() && self.state.status != Status::Active;
            tokio::select! {
                request = requests.recv() => match request {
                    Some(request) => self.handle(request).await,
                    None => break,
                },
                () = async {
                    match deadline {
                        Some(at) => sleep_until(at).await,
                        None => future::pending().await,
                    }
                } => {
                    if let Err(error) = self.execute(Command::Timeout).await {
                        tracing::error!(game = %id, %error, "failed to end timed out game");
                        // retry later instead of spinning on a past deadline
                        sleep(Duration::from_secs(1)).await;
                    }
                },
                () = sleep(LINGER), if idle => break,
            }
        }

        // Unanswered requests still queued make `Sessions` restore the game.
        requests.close();
        let mut games = self.games.lock().await;
        if games.get(&id).is_some_and(mpsc::Sender::is_closed) {
            games.remove(&id);
        }
        tracing::info!(game = %id, "session actor stopped");
    }

    fn timer(&self) -> Option<Instant> {
        if self.state.status != Status::Active {
            return None;
        }
        let left = (self.state.deadline? - Utc::now())
            .to_std()
            .unwrap_or_default();
        Some(Instant::now() + left)
    }

    async fn handle(&mut self, request: Request) {
        // A failed reply means the connection went away; nothing to do then.
        match request {
            Request::Join {
                player,
                role,
                reply,
            } => {
                let _ = reply.send(self.join(player, role).await);
            }
            Request::Connect {
                player,
                last_sequence,
                reply,
            } => {
                let count = self.online.entry(player).or_default();
                *count += 1;
                if *count == 1 {
                    self.presence(player, true);
                }
                let mut initial: Vec<ServerMessage> = match last_sequence {
                    Some(last) => self
                        .log
                        .iter()
                        .filter(|e| e.sequence > last)
                        .map(event_message)
                        .collect(),
                    None => vec![self.snapshot()],
                };
                initial.extend(self.state.briefing(player, &self.details));
                let _ = reply.send(Connection {
                    initial,
                    updates: self.updates.subscribe(),
                });
            }
            Request::Resync { player, reply } => {
                let mut messages = vec![self.snapshot()];
                messages.extend(self.state.briefing(player, &self.details));
                let _ = reply.send(messages);
            }
            Request::Disconnect { player } => {
                if let Some(count) = self.online.get_mut(&player) {
                    *count -= 1;
                    if *count == 0 {
                        self.online.remove(&player);
                        self.presence(player, false);
                    }
                }
            }
            Request::Submit {
                player,
                turn,
                answer,
                reply,
            } => {
                let result = self
                    .execute(Command::Submit {
                        player,
                        turn,
                        answer,
                    })
                    .await;
                let _ = reply.send(result);
            }
            Request::Ready { player, reply } => {
                let _ = reply.send(self.execute(Command::Ready { player }).await);
            }
            Request::Forfeit { player, reply } => {
                let _ = reply.send(self.execute(Command::Forfeit { player }).await);
            }
        }
    }

    async fn join(&mut self, player: Uuid, role: Option<Role>) -> Result<Seat, SessionError> {
        let seat = Seat {
            game_id: self.state.id,
            player_id: player,
            token: Uuid::new_v4(),
            index: 1,
        };
        let coin = Uuid::new_v4().as_bytes()[0] & 1 == 1;
        let now = Utc::now();
        let events = self.state.decide(
            Command::Join {
                player: seat.player_id,
                role,
                coin,
            },
            now,
            &self.details,
        )?;
        let player = NewPlayer {
            id: seat.player_id,
            seat: seat.index,
            token: seat.token,
            role,
        };
        let stored = self
            .db
            .join_game(self.state.id, &player, events, now)
            .await
            .map_err(|e| SessionError::db(&e))?;
        self.publish(stored);
        Ok(seat)
    }

    async fn execute(&mut self, command: Command) -> Result<(), SessionError> {
        let now = Utc::now();
        let events = self.state.decide(command, now, &self.details)?;
        if events.is_empty() {
            return Ok(());
        }
        let stored = self
            .db
            .append_game_events(self.state.id, events, now)
            .await
            .map_err(|e| SessionError::db(&e))?;
        self.publish(stored);
        Ok(())
    }

    fn publish(&mut self, stored: Vec<StoredEvent>) {
        let mut turn_started = false;
        for event in stored {
            self.state.apply(event.sequence, &event.event);
            turn_started |= matches!(event.event, GameEvent::TurnStarted { .. });
            self.broadcast(None, event_message(&event));
            self.log.push(event);
        }
        if turn_started {
            for player in self.state.players() {
                if let Some(briefing) = self.state.briefing(player, &self.details) {
                    self.broadcast(Some(player), briefing);
                }
            }
        }
    }

    fn presence(&self, player: Uuid, online: bool) {
        self.broadcast(
            None,
            ServerMessage::Presence {
                player_id: player,
                online,
            },
        );
    }

    fn broadcast(&self, to: Option<Uuid>, message: ServerMessage) {
        // Sending fails only when nobody is subscribed, which is fine.
        let _ = self.updates.send(Outgoing {
            to,
            message: Arc::new(message),
        });
    }

    fn snapshot(&self) -> ServerMessage {
        ServerMessage::Snapshot {
            state: self.state.view(|player| self.online.contains_key(&player)),
        }
    }
}

fn event_message(event: &StoredEvent) -> ServerMessage {
    ServerMessage::Event {
        sequence: event.sequence,
        at: event.at,
        event: event.event.clone(),
    }
}
