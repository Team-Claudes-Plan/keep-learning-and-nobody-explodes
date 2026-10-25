//! Websocket transport of the session protocol (`schema/session-protocol.md`).
//! The game logic lives in [`crate::session`]; this only moves messages.

use std::{sync::Arc, time::Duration};

use axum::{
    Json,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use tokio::{
    sync::broadcast::error::RecvError,
    time::{interval, timeout},
};
use tracing::{error, info};
use uuid::Uuid;

use crate::{
    GlobalState,
    api::{error::ApiError, user::CurrentUser},
    db::Lobby,
    session::{
        Connection, CreateGame, Seat, SessionError, Storey,
        protocol::{ClientMessage, ErrorCode, ServerMessage},
    },
};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const PING_INTERVAL: Duration = Duration::from_secs(15);

type Sink = SplitSink<WebSocket, Message>;
type Stream = SplitStream<WebSocket>;

pub async fn session_list(
    State(state): State<Arc<GlobalState>>,
) -> Result<Json<Vec<Lobby>>, ApiError> {
    state
        .sessions
        .lobbies()
        .await
        .map(Json)
        .map_err(|error| ApiError::InternalServerError(error.message))
}

/// Plays as the user named by `?user_id=` (browsers cannot set headers on
/// websockets) or the `X-User-Id` header.
pub async fn session_socket(
    State(state): State<Arc<GlobalState>>,
    user: CurrentUser,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let user = user.id();
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = run(&state, user, socket).await {
            error!(%error, "session connection failed");
        }
    })
}

enum Incoming {
    Message(ClientMessage),
    Invalid(String),
    Closed,
}

async fn recv(stream: &mut Stream) -> anyhow::Result<Incoming> {
    loop {
        let Some(message) = stream.next().await else {
            return Ok(Incoming::Closed);
        };
        return Ok(match message? {
            Message::Text(text) => match serde_json::from_str(&text) {
                Ok(message) => Incoming::Message(message),
                Err(e) => Incoming::Invalid(format!("failed to deserialize message: {e}")),
            },
            Message::Binary(_) => {
                Incoming::Invalid("unsupported websocket message type".to_owned())
            }
            Message::Close(_) => Incoming::Closed,
            // pings are answered by axum
            Message::Ping(_) | Message::Pong(_) => continue,
        });
    }
}

async fn send(sink: &mut Sink, message: &ServerMessage) -> anyhow::Result<()> {
    let text = serde_json::to_string(message)?;
    sink.send(Message::Text(text.into())).await?;
    Ok(())
}

async fn send_error(sink: &mut Sink, error: &SessionError) -> anyhow::Result<()> {
    send(sink, &error.to_message()).await
}

async fn run(state: &GlobalState, user: Uuid, socket: WebSocket) -> anyhow::Result<()> {
    let (mut sink, mut stream) = socket.split();

    let Ok(handshake) = timeout(
        HANDSHAKE_TIMEOUT,
        handshake(state, user, &mut sink, &mut stream),
    )
    .await
    else {
        let error = SessionError::new(ErrorCode::BadMessage, "no create, join or resume received");
        return send_error(&mut sink, &error).await;
    };
    let Some((game_id, player, connection)) = handshake? else {
        return Ok(());
    };

    info!(game = %game_id, player = %player, "player connected");
    let result = play(state, &mut sink, &mut stream, game_id, player, connection).await;
    state.sessions.disconnect(game_id, player).await;
    info!(game = %game_id, player = %player, "player disconnected");
    result
}

/// Waits for create, join or resume and subscribes the player to the game.
async fn handshake(
    state: &GlobalState,
    user: Uuid,
    sink: &mut Sink,
    stream: &mut Stream,
) -> anyhow::Result<Option<(Uuid, Uuid, Connection)>> {
    let sessions = &state.sessions;
    loop {
        let message = match recv(stream).await? {
            Incoming::Message(message) => message,
            Incoming::Invalid(reason) => {
                send_error(sink, &SessionError::new(ErrorCode::BadMessage, reason)).await?;
                continue;
            }
            Incoming::Closed => return Ok(None),
        };

        let entered = match enter(state, user, message).await {
            Ok(entered) => entered,
            Err(error) => {
                send_error(sink, &error).await?;
                continue;
            }
        };
        if let Some(seat) = entered.seat {
            send(sink, &seat.welcome()).await?;
        }
        match sessions
            .connect(entered.game_id, entered.player, entered.last_sequence)
            .await
        {
            Ok(connection) => return Ok(Some((entered.game_id, entered.player, connection))),
            Err(error) => send_error(sink, &error).await?,
        }
    }
}

struct Entered {
    game_id: Uuid,
    player: Uuid,
    /// New credentials, if a seat was taken rather than resumed.
    seat: Option<Seat>,
    last_sequence: Option<u32>,
}

async fn enter(
    state: &GlobalState,
    user: Uuid,
    message: ClientMessage,
) -> Result<Entered, SessionError> {
    let sessions = &state.sessions;
    let seat = match message {
        ClientMessage::Create {
            topics,
            question_count,
            role,
            time_limit_secs,
            skill_id,
            island_id,
            invited,
        } => {
            let storey = match (skill_id, island_id) {
                (Some(skill_id), Some(island_id)) => Some(Storey {
                    skill_id,
                    island_id,
                }),
                (None, None) => None,
                _ => {
                    return Err(SessionError::new(
                        ErrorCode::BadMessage,
                        "skill_id and island_id go together",
                    ));
                }
            };
            sessions
                .create(CreateGame {
                    player: user,
                    topics,
                    storey,
                    invited,
                    question_count,
                    role,
                    time_limit_secs,
                })
                .await?
        }
        ClientMessage::Join { game_id, role } => sessions.join(game_id, user, role).await?,
        ClientMessage::Resume {
            game_id,
            token,
            last_sequence,
        } => {
            let player = sessions.authenticate(game_id, token).await?;
            if player != user {
                return Err(SessionError::new(
                    ErrorCode::InvalidToken,
                    "the token belongs to another user",
                ));
            }
            return Ok(Entered {
                game_id,
                player,
                seat: None,
                last_sequence,
            });
        }
        ClientMessage::Ready | ClientMessage::SubmitAnswer { .. } | ClientMessage::Forfeit => {
            return Err(SessionError::new(
                ErrorCode::InvalidState,
                "send create, join or resume first",
            ));
        }
    };
    Ok(Entered {
        game_id: seat.game_id,
        player: seat.player_id,
        seat: Some(seat),
        last_sequence: None,
    })
}

async fn play(
    state: &GlobalState,
    sink: &mut Sink,
    stream: &mut Stream,
    game_id: Uuid,
    player: Uuid,
    connection: Connection,
) -> anyhow::Result<()> {
    let sessions = &state.sessions;
    let Connection {
        initial,
        mut updates,
    } = connection;
    for message in &initial {
        send(sink, message).await?;
    }

    let mut ping = interval(PING_INTERVAL);
    ping.reset();

    loop {
        tokio::select! {
            incoming = recv(stream) => {
                let result = match incoming? {
                    Incoming::Closed => return Ok(()),
                    Incoming::Invalid(reason) => Err(SessionError::new(ErrorCode::BadMessage, reason)),
                    Incoming::Message(ClientMessage::SubmitAnswer { turn, answer }) => {
                        sessions.submit(game_id, player, turn, answer).await
                    }
                    Incoming::Message(ClientMessage::Ready) => sessions.ready(game_id, player).await,
                    Incoming::Message(ClientMessage::Forfeit) => sessions.forfeit(game_id, player).await,
                    Incoming::Message(
                        ClientMessage::Create { .. } | ClientMessage::Join { .. } | ClientMessage::Resume { .. },
                    ) => Err(SessionError::new(ErrorCode::InvalidState, "already in a game")),
                };
                if let Err(error) = result {
                    send_error(sink, &error).await?;
                }
            }
            update = updates.recv() => match update {
                Ok(update) => {
                    if update.is_for(player) {
                        send(sink, &update.message).await?;
                    }
                }
                Err(RecvError::Lagged(_)) => {
                    match sessions.resync(game_id, player).await {
                        Ok(messages) => {
                            for message in &messages {
                                send(sink, message).await?;
                            }
                        }
                        Err(error) => send_error(sink, &error).await?,
                    }
                }
                Err(RecvError::Closed) => return Ok(()),
            },
            _ = ping.tick() => sink.send(Message::Ping(Vec::new().into())).await?,
        }
    }
}
