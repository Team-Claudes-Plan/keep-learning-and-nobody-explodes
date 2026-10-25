//! Websocket transport of the user channel (`schema/user-channel.md`). The
//! state lives in [`crate::presence::Hub`]; this checks memberships and games
//! and moves messages.

use std::{sync::Arc, time::Duration};

use axum::{
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use tokio::time::interval;
use tracing::{error, info};

use crate::{
    GlobalState,
    api::user::CurrentUser,
    db::UserSummary,
    presence::{
        NewInvite, PresenceError,
        protocol::{ClientMessage, ErrorCode, ServerMessage},
    },
};

const PING_INTERVAL: Duration = Duration::from_secs(15);

type Sink = SplitSink<WebSocket, Message>;

/// The channel of the user named by `?user_id=` or the `X-User-Id` header.
pub async fn user_socket(
    State(state): State<Arc<GlobalState>>,
    user: CurrentUser,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let user = user.0;
    ws.on_upgrade(move |socket| async move {
        if let Err(error) = run(&state, user, socket).await {
            error!(%error, "user channel failed");
        }
    })
}

async fn send(sink: &mut Sink, message: &ServerMessage) -> anyhow::Result<()> {
    let text = serde_json::to_string(message)?;
    sink.send(Message::Text(text.into())).await?;
    Ok(())
}

fn db_error(error: &sqlx::Error) -> PresenceError {
    tracing::error!(%error, "user channel database error");
    PresenceError::new(ErrorCode::Internal, "database error")
}

async fn run(state: &GlobalState, user: UserSummary, socket: WebSocket) -> anyhow::Result<()> {
    let partners = state.db.island_partners(user.id).await?;
    let mut channel = state.presence.connect(user.id, partners);
    info!(user = %user.id, "user channel opened");

    let (mut sink, mut stream) = socket.split();
    let mut ping = interval(PING_INTERVAL);
    ping.reset();
    let result = async {
        loop {
            tokio::select! {
                incoming = stream.next() => {
                    let text = match incoming {
                        None | Some(Ok(Message::Close(_))) => return Ok(()),
                        Some(Err(error)) => return Err(error.into()),
                        Some(Ok(Message::Text(text))) => text,
                        // pings are answered by axum
                        Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                        Some(Ok(Message::Binary(_))) => {
                            let error = PresenceError::new(ErrorCode::BadMessage, "unsupported websocket message type");
                            send(&mut sink, &error.to_message(None)).await?;
                            continue;
                        }
                    };
                    let reply = match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(message) => handle(state, &user, message).await,
                        Err(e) => Some(
                            PresenceError::new(ErrorCode::BadMessage, format!("failed to deserialize message: {e}"))
                                .to_message(None),
                        ),
                    };
                    if let Some(reply) = reply {
                        send(&mut sink, &reply).await?;
                    }
                }
                pushed = channel.outbox.recv() => match pushed {
                    Some(message) => send(&mut sink, &message).await?,
                    None => return Ok(()),
                },
                _ = ping.tick() => sink.send(Message::Ping(Vec::new().into())).await?,
            }
        }
    }
    .await;

    state.presence.disconnect(user.id, channel.id);
    info!(user = %user.id, "user channel closed");
    result
}

/// Handles one message; returns the reply to the sending channel, if any.
async fn handle(
    state: &GlobalState,
    user: &UserSummary,
    message: ClientMessage,
) -> Option<ServerMessage> {
    match message {
        ClientMessage::Invite {
            request_id,
            to,
            island_id,
            topic_id,
            storey_id,
            game_id,
        } => {
            let invite = NewInvite {
                from: user.clone(),
                to,
                island_id,
                topic_id,
                storey_id,
                game_id,
            };
            Some(match invite_checked(state, invite).await {
                Ok(invite_id) => ServerMessage::InviteSent {
                    request_id,
                    invite_id,
                },
                Err(error) => error.to_message(Some(request_id)),
            })
        }
        ClientMessage::AnswerInvite { invite_id, accept } => {
            answer_checked(state, user, invite_id, accept)
                .await
                .err()
                .map(|error| error.to_message(None))
        }
        ClientMessage::CancelInvite { invite_id } => state
            .presence
            .cancel(user.id, invite_id)
            .err()
            .map(|error| error.to_message(None)),
    }
}

async fn invite_checked(
    state: &GlobalState,
    invite: NewInvite,
) -> Result<uuid::Uuid, PresenceError> {
    let db = &state.db;
    if invite.to == invite.from.id {
        return Err(PresenceError::new(
            ErrorCode::BadMessage,
            "invite someone else",
        ));
    }
    for member in [invite.from.id, invite.to] {
        if !db
            .is_island_member(invite.island_id, member)
            .await
            .map_err(|e| db_error(&e))?
        {
            return Err(PresenceError::new(
                ErrorCode::NotIslandMember,
                "both players must be members of the island",
            ));
        }
    }
    if !db
        .is_open_game_of(invite.game_id, invite.from.id, invite.to)
        .await
        .map_err(|e| db_error(&e))?
    {
        return Err(PresenceError::new(
            ErrorCode::UnknownGame,
            "no waiting game of yours with that id",
        ));
    }
    state.presence.invite(invite)
}

/// An accepted invite whose game is gone is withdrawn instead, so the
/// invitee does not walk into a game they cannot join.
async fn answer_checked(
    state: &GlobalState,
    user: &UserSummary,
    invite_id: uuid::Uuid,
    accept: bool,
) -> Result<(), PresenceError> {
    if accept {
        let invite = state.presence.invite_to(user.id, invite_id)?;
        let open = state
            .db
            .is_open_game_of(invite.game_id, invite.from.id, user.id)
            .await
            .map_err(|e| db_error(&e))?;
        if !open {
            state.presence.withdraw(invite_id);
            return Err(PresenceError::new(
                ErrorCode::UnknownGame,
                "the game is not waiting any more",
            ));
        }
    }
    state.presence.answer(user.id, invite_id, accept)
}

#[cfg(test)]
mod tests {
    //! Needs a database (`DATABASE_URL`), so it is ignored by default.

    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use tokio::{net::TcpStream, time::timeout};
    use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};
    use uuid::Uuid;

    use crate::{GlobalState, api, db::Database, presence::Hub, session::Sessions};

    type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

    async fn send(socket: &mut Socket, message: Value) {
        socket
            .send(Message::Text(message.to_string().into()))
            .await
            .expect("send");
    }

    /// Next JSON message of the given type, skipping others.
    async fn expect(socket: &mut Socket, kind: &str) -> Value {
        loop {
            let message = timeout(Duration::from_secs(2), socket.next())
                .await
                .unwrap_or_else(|_| panic!("timed out waiting for {kind}"))
                .expect("open")
                .expect("message");
            if let Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).expect("json");
                if value["type"] == kind {
                    return value;
                }
            }
        }
    }

    /// Serves the api on a free port; returns it and the user channel url of a user.
    async fn serve(db: Database) -> (axum::Router, impl Fn(Uuid) -> String) {
        let state = std::sync::Arc::new(GlobalState {
            sessions: Sessions::new(db.clone()),
            presence: Hub::new(),
            db,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        let app = api::routes().with_state(state);
        let served = app.clone();
        tokio::spawn(async move { axum::serve(listener, served).await });
        (app, move |user: Uuid| {
            format!("ws://{addr}/api/users/ws?user_id={user}")
        })
    }

    #[tokio::test]
    #[ignore = "requires a database (`DATABASE_URL`)"]
    async fn a_new_member_hears_about_the_island() {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(&url, 5).await.expect("database");
        db.migrate().await.expect("migrations");
        let alex = db.create_user("channel test a").await.expect("user");
        let leo = db.create_user("channel test c").await.expect("user");
        let solo = db
            .create_island("channel test solo", alex, None)
            .await
            .expect("island");
        let (app, channel) = serve(db).await;
        let (_a, _) = connect_async(channel(alex)).await.expect("connect a");

        // alex adds leo; leo hears it and sees alex online
        let (mut c, _) = connect_async(channel(leo)).await.expect("connect c");
        let (status, _) = api::testing::call(
            &app,
            axum::http::Method::PUT,
            &format!("/api/islands/{solo}/members"),
            Some(alex),
            Some(json!({ "user_id": leo })),
        )
        .await;
        assert_eq!(status, axum::http::StatusCode::NO_CONTENT);
        let added = expect(&mut c, "added_to_island").await;
        assert_eq!(added["island_id"], solo.to_string());
        assert_eq!(added["by"]["name"], "channel test a");
        let presence = expect(&mut c, "presence").await;
        assert_eq!(
            (&presence["user_id"], &presence["online"]),
            (&json!(alex), &json!(true))
        );
    }

    #[tokio::test]
    #[ignore = "requires a database (`DATABASE_URL`)"]
    async fn invites_a_partner_into_a_game() {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(&url, 5).await.expect("database");
        db.migrate().await.expect("migrations");
        let alex = db.create_user("channel test a").await.expect("user");
        let mia = db.create_user("channel test b").await.expect("user");
        let leo = db.create_user("channel test c").await.expect("user");
        let island = db
            .create_island("channel test", alex, Some(mia))
            .await
            .expect("island");

        let pool = db.pool().clone();
        let (_, channel) = serve(db).await;

        connect_async(channel(Uuid::new_v4()))
            .await
            .expect_err("unknown user is rejected");

        let (mut a, _) = connect_async(channel(alex)).await.expect("connect a");
        let presence = expect(&mut a, "presence").await;
        assert_eq!(presence["user_id"], mia.to_string());
        assert_eq!(presence["online"], false);

        let invite = json!({
            "type": "invite", "request_id": "r1", "to": mia, "island_id": island,
            "topic_id": Uuid::nil(), "storey_id": "ground", "game_id": Uuid::nil(),
        });
        send(&mut a, invite.clone()).await;
        let error = expect(&mut a, "error").await;
        assert_eq!(
            (&error["request_id"], &error["code"]),
            (&json!("r1"), &json!("unknown_game"))
        );

        let (mut b, _) = connect_async(channel(mia)).await.expect("connect b");
        assert_eq!(expect(&mut b, "presence").await["online"], true);
        let presence = expect(&mut a, "presence").await;
        assert_eq!(
            (&presence["user_id"], &presence["online"]),
            (&json!(mia), &json!(true))
        );

        // a waiting game of alex, private to mia
        let topic: Uuid = sqlx::query_scalar(
            "INSERT INTO topics (island_id, name) VALUES ($1, 'Kanal') RETURNING id",
        )
        .bind(island)
        .fetch_one(&pool)
        .await
        .expect("topic");
        let game = Uuid::new_v4();
        sqlx::query("INSERT INTO games (id, invited_id) VALUES ($1, $2)")
            .bind(game)
            .bind(mia)
            .execute(&pool)
            .await
            .expect("game");
        sqlx::query(
            "INSERT INTO game_players (game_id, player_id, seat, rejoin_token) VALUES ($1, $2, 0, $3)",
        )
        .bind(game)
        .bind(alex)
        .bind(Uuid::new_v4())
        .execute(&pool)
        .await
        .expect("creator");

        let mut stranger = invite.clone();
        stranger["to"] = json!(leo);
        stranger["game_id"] = json!(game);
        send(&mut a, stranger).await;
        assert_eq!(expect(&mut a, "error").await["code"], "not_island_member");

        let mut real = invite;
        real["game_id"] = json!(game);
        real["topic_id"] = json!(topic);
        real["request_id"] = json!("r2");
        send(&mut a, real).await;
        let sent = expect(&mut a, "invite_sent").await;
        assert_eq!(sent["request_id"], "r2");
        let received = expect(&mut b, "invite").await;
        assert_eq!(received["invite_id"], sent["invite_id"]);
        assert_eq!(received["from"]["name"], "channel test a");
        assert_eq!(received["storey_id"], "ground");

        send(
            &mut b,
            json!({ "type": "answer_invite", "invite_id": received["invite_id"], "accept": true }),
        )
        .await;
        let answered = expect(&mut a, "invite_answered").await;
        assert_eq!(answered["accepted"], true);

        drop(b);
        let presence = expect(&mut a, "presence").await;
        assert_eq!(
            (&presence["user_id"], &presence["online"]),
            (&json!(mia), &json!(false))
        );
    }
}
