//! End-to-end test of a session against Postgres, without the websocket.
//! Ignored by default because it needs a database:
//!
//! ```text
//! nix run .#dev                      # in one terminal
//! cargo test -- --ignored            # in a shell with the dev env (nix develop)
//! ```

use std::time::Duration;

use serde_json::json;
use tokio::{sync::broadcast, time::timeout};
use uuid::Uuid;

use super::{
    Connection, CreateGame, Outgoing, Sessions,
    protocol::{Answer, Brief, EndReason, ErrorCode, GameEvent, Role, ServerMessage, Status},
};
use crate::db::Database;

async fn seed_topic(db: &Database, tasks: usize) -> Uuid {
    let topic = db.create_topic("session test").await.expect("topic");
    let document: Uuid = sqlx::query_scalar(
        "INSERT INTO documents (bucket, object_key, topic_id) VALUES ('test', $1, $2) RETURNING id",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(topic)
    .fetch_one(db.pool())
    .await
    .expect("document");
    for _ in 0..tasks {
        let task: Uuid = sqlx::query_scalar(
            "INSERT INTO tasks (document_id, question_type, content, solution)
             VALUES ($1, 'single_choice', $2, '1') RETURNING id",
        )
        .bind(document)
        .bind(json!({ "prompt": "Wie viele Bits hat ein Byte?", "options": ["4", "8"] }))
        .fetch_one(db.pool())
        .await
        .expect("task");
        sqlx::query("INSERT INTO instructions (task_id, instruction) VALUES ($1, $2)")
            .bind(task)
            .bind(json!({ "text": "Die zweite Option ist richtig." }))
            .execute(db.pool())
            .await
            .expect("instruction");
    }
    topic
}

/// Everything broadcast to `player` until nothing arrives for a moment.
async fn drain(updates: &mut broadcast::Receiver<Outgoing>, player: Uuid) -> Vec<ServerMessage> {
    let mut messages = Vec::new();
    while let Ok(Ok(update)) = timeout(Duration::from_millis(200), updates.recv()).await {
        if update.is_for(player) {
            messages.push((*update.message).clone());
        }
    }
    messages
}

fn events(messages: &[ServerMessage]) -> Vec<(u32, &'static str)> {
    messages
        .iter()
        .filter_map(|m| match m {
            ServerMessage::Event {
                sequence, event, ..
            } => Some((*sequence, event.kind())),
            _ => None,
        })
        .collect()
}

fn answer(choice: u32) -> Answer {
    Answer::SingleChoice(choice)
}

#[tokio::test]
#[ignore = "requires a database (`DATABASE_URL`)"]
#[expect(clippy::too_many_lines, reason = "one scenario, read top to bottom")]
async fn plays_a_game_and_restores_it() {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
    let db = Database::connect(&url, 5).await.expect("database");
    db.migrate().await.expect("migrations");
    let topic = seed_topic(&db, 3).await;
    let sessions = Sessions::new(db.clone());

    let too_many = sessions
        .create(CreateGame {
            topics: vec![topic],
            question_count: 4,
            role: None,
            time_limit_secs: None,
        })
        .await;
    assert_eq!(too_many.expect_err("only 3 tasks").code, ErrorCode::NoTasks);

    let a = sessions
        .create(CreateGame {
            topics: vec![topic],
            question_count: 3,
            role: Some(Role::Defuser),
            time_limit_secs: None,
        })
        .await
        .expect("create");
    let lobbies = sessions.lobbies().await.expect("lobbies");
    let lobby = lobbies.iter().find(|l| l.id == a.game_id).expect("listed");
    assert_eq!(lobby.open_role, Some(Role::Expert));

    let Connection {
        initial,
        updates: mut a_updates,
    } = sessions
        .connect(a.game_id, a.player_id, None)
        .await
        .expect("connect a");
    assert!(matches!(
        initial.as_slice(),
        [ServerMessage::Snapshot { state }] if state.status == Status::Waiting
    ));

    let b = sessions
        .join(a.game_id, Some(Role::Defuser))
        .await
        .expect("join");
    let Connection {
        updates: mut b_updates,
        ..
    } = sessions
        .connect(a.game_id, b.player_id, None)
        .await
        .expect("connect b");

    let seen = drain(&mut a_updates, a.player_id).await;
    assert_eq!(
        events(&seen),
        [
            (2, "player_joined"),
            (3, "game_started"),
            (4, "turn_started")
        ]
    );
    // the creator picked defuser, so the joiner's wish loses
    assert!(seen.iter().any(|m| matches!(
        m,
        ServerMessage::Briefing {
            turn: 0,
            brief: Brief::Defuser { .. }
        }
    )));

    let not_yours = sessions.submit(a.game_id, b.player_id, 0, answer(1)).await;
    assert_eq!(
        not_yours.expect_err("a defuses").code,
        ErrorCode::NotYourTurn
    );

    sessions
        .submit(a.game_id, a.player_id, 0, answer(0))
        .await
        .expect("wrong answer");
    let stale = sessions.submit(a.game_id, a.player_id, 0, answer(0)).await;
    assert_eq!(stale.expect_err("resent").code, ErrorCode::StaleTurn);
    sessions
        .submit(a.game_id, b.player_id, 1, answer(1))
        .await
        .expect("b answers");

    let b_seen = drain(&mut b_updates, b.player_id).await;
    assert!(b_seen.iter().any(|m| matches!(
        m,
        ServerMessage::Briefing {
            turn: 1,
            brief: Brief::Defuser { .. }
        }
    )));
    assert!(b_seen.iter().any(|m| matches!(
        m,
        ServerMessage::Briefing { turn: 2, brief: Brief::Expert { instruction, .. } }
            if instruction["text"] == "Die zweite Option ist richtig."
    )));

    // a fresh registry stands in for a server restart
    let restarted = Sessions::new(db.clone());
    let player = restarted
        .authenticate(a.game_id, b.token)
        .await
        .expect("token");
    assert_eq!(player, b.player_id);
    let resumed = restarted
        .connect(a.game_id, b.player_id, Some(6))
        .await
        .expect("resume");
    assert_eq!(
        events(&resumed.initial),
        [(7, "answer_submitted"), (8, "turn_started")]
    );

    restarted
        .submit(a.game_id, a.player_id, 2, answer(1))
        .await
        .expect("last answer");
    let Connection { initial, .. } = restarted
        .connect(a.game_id, a.player_id, None)
        .await
        .expect("snapshot");
    let [ServerMessage::Snapshot { state }] = initial.as_slice() else {
        panic!("expected a snapshot, got {initial:?}");
    };
    assert_eq!(state.status, Status::Won);
    assert_eq!(state.strikes, 1);
    assert_eq!(state.reason, Some(EndReason::AllResolved));

    let (status, failures, next): (String, i16, i32) = sqlx::query_as(
        "SELECT status, failure_count, next_event_sequence FROM games WHERE id = $1",
    )
    .bind(a.game_id)
    .fetch_one(db.pool())
    .await
    .expect("game row");
    assert_eq!((status.as_str(), failures, next), ("won", 1, 11));

    let log = db.load_game_events(a.game_id).await.expect("log");
    assert_eq!(
        log.iter().map(|e| e.sequence).collect::<Vec<_>>(),
        (0..11).collect::<Vec<_>>()
    );
    assert!(matches!(
        log.last().map(|e| &e.event),
        Some(GameEvent::GameEnded {
            reason: EndReason::AllResolved,
            ..
        })
    ));

    let solved: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM game_parts WHERE game_id = $1 AND solved_at IS NOT NULL",
    )
    .bind(a.game_id)
    .fetch_one(db.pool())
    .await
    .expect("parts");
    assert_eq!(solved, 2);
}

mod websocket {
    use std::sync::Arc;

    use futures_util::{SinkExt, StreamExt};
    use serde_json::Value;
    use tokio::net::TcpStream;
    use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite::Message};

    use super::*;
    use crate::{GlobalState, api};

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

    #[tokio::test]
    #[ignore = "requires a database (`DATABASE_URL`)"]
    async fn speaks_the_protocol_over_websocket() {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(&url, 5).await.expect("database");
        db.migrate().await.expect("migrations");
        let topic = seed_topic(&db, 2).await;

        let state = Arc::new(GlobalState {
            sessions: Sessions::new(db.clone()),
            db,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move { axum::serve(listener, api::routes().with_state(state)).await });
        let endpoint = format!("ws://{addr}/api/sessions/ws");

        let (mut a, _) = connect_async(&endpoint).await.expect("connect a");
        send(&mut a, json!({ "type": "forfeit" })).await;
        assert_eq!(expect(&mut a, "error").await["code"], "invalid_state");
        send(&mut a, json!({ "type": "nonsense" })).await;
        assert_eq!(expect(&mut a, "error").await["code"], "bad_message");

        send(
            &mut a,
            json!({ "type": "create", "topics": [topic], "question_count": 2 }),
        )
        .await;
        let welcome = expect(&mut a, "welcome").await;
        let game_id = welcome["game_id"].clone();
        assert_eq!(
            expect(&mut a, "snapshot").await["state"]["status"],
            "waiting"
        );

        let (mut b, _) = connect_async(&endpoint).await.expect("connect b");
        send(&mut b, json!({ "type": "join", "game_id": game_id })).await;
        let b_id = expect(&mut b, "welcome").await["player_id"].clone();
        expect(&mut b, "snapshot").await;

        let turn = loop {
            let event = expect(&mut a, "event").await;
            if event["event"]["type"] == "turn_started" {
                break event["event"].clone();
            }
        };
        let (defuser, other) = if turn["defuser"] == b_id {
            (&mut b, &mut a)
        } else {
            (&mut a, &mut b)
        };
        let briefing = expect(defuser, "briefing").await;
        assert_eq!(briefing["role"], "defuser");
        assert_eq!(briefing["task"]["options"], json!(["4", "8"]));

        send(
            other,
            json!({ "type": "submit_answer", "turn": 0, "answer": { "type": "single_choice", "answer": 1 } }),
        )
        .await;
        assert_eq!(expect(other, "error").await["code"], "not_your_turn");

        send(
            defuser,
            json!({ "type": "submit_answer", "turn": 0, "answer": { "type": "single_choice", "questionId": "x", "answer": 1 } }),
        )
        .await;
        let submitted = expect(other, "event").await;
        assert_eq!(submitted["event"]["type"], "answer_submitted");
        assert_eq!(submitted["event"]["correct"], true);

        // roles swapped: the other player defuses turn 1, and gives up
        assert_eq!(expect(other, "briefing").await["role"], "defuser");
        send(other, json!({ "type": "forfeit" })).await;
        let ended = loop {
            let event = expect(defuser, "event").await;
            if event["event"]["type"] == "game_ended" {
                break event;
            }
        };
        assert_eq!(ended["event"]["outcome"], "aborted");

        // resume replays only what came after the given sequence
        let token = welcome["token"].clone();
        let (mut again, _) = connect_async(&endpoint).await.expect("reconnect");
        let last = ended["sequence"].as_u64().expect("sequence") - 1;
        send(
            &mut again,
            json!({ "type": "resume", "game_id": game_id, "token": token, "last_sequence": last }),
        )
        .await;
        assert_eq!(
            expect(&mut again, "event").await["event"]["type"],
            "game_ended"
        );
    }
}
