use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use sqlx::{
    PgConnection,
    postgres::{PgPool, PgPoolOptions},
    types::Json,
};
use uuid::Uuid;

use crate::session::protocol::{GameEvent, Role};

#[derive(Debug, Serialize)]
pub struct Topic {
    pub id: Uuid,
    pub name: String,
}

/// A task drawn for a new game, with one of its instructions.
#[derive(Debug)]
pub struct PickedTask {
    pub task_id: Uuid,
    pub instruction_id: Uuid,
    pub question_type: String,
}

/// Everything about a game part the server needs during play; never sent as a whole.
#[derive(Debug, Clone)]
pub struct PartDetails {
    pub question_type: String,
    pub content: Value,
    pub instruction: Value,
    pub solution: Value,
}

#[derive(Debug, Clone)]
pub struct StoredEvent {
    pub sequence: u32,
    pub at: DateTime<Utc>,
    pub event: GameEvent,
}

#[derive(Debug)]
pub struct NewGame<'a> {
    pub id: Uuid,
    pub topics: &'a [Uuid],
    pub question_count: u16,
    pub time_limit_secs: u32,
    pub tasks: &'a [PickedTask],
}

#[derive(Debug)]
pub struct NewPlayer {
    pub id: Uuid,
    pub seat: u8,
    pub token: Uuid,
    pub role: Option<Role>,
}

#[derive(Debug, Serialize)]
pub struct Lobby {
    pub id: Uuid,
    pub topics: Vec<Uuid>,
    pub question_count: i16,
    /// The role left for whoever joins, if the creator picked one.
    pub open_role: Option<Role>,
}

/// `(question_type, content, instruction, solution)`
type PartRow = (String, Json<Value>, Json<Value>, Json<Value>);

fn encode_error(error: impl std::error::Error + Send + Sync + 'static) -> sqlx::Error {
    sqlx::Error::Encode(Box::new(error))
}

fn decode_error(error: impl std::error::Error + Send + Sync + 'static) -> sqlx::Error {
    sqlx::Error::Decode(Box::new(error))
}

/// Splits an event into `event_type` and the payload without its tag.
fn event_row(event: &GameEvent) -> Result<Value, sqlx::Error> {
    let mut payload = serde_json::to_value(event).map_err(encode_error)?;
    if let Value::Object(fields) = &mut payload {
        fields.remove("type");
    }
    Ok(payload)
}

fn event_from_row(event_type: String, mut payload: Value) -> Result<GameEvent, sqlx::Error> {
    if let Value::Object(fields) = &mut payload {
        fields.insert("type".to_owned(), Value::String(event_type));
    }
    serde_json::from_value(payload).map_err(decode_error)
}

/// Appends events with consecutive sequence numbers and updates the
/// projections in `games` and `game_parts`. Run inside a transaction.
async fn append_events(
    conn: &mut PgConnection,
    game_id: Uuid,
    events: Vec<GameEvent>,
    at: DateTime<Utc>,
) -> Result<Vec<StoredEvent>, sqlx::Error> {
    let count = i32::try_from(events.len()).map_err(encode_error)?;
    let first: i32 = sqlx::query_scalar(
        "UPDATE games SET next_event_sequence = next_event_sequence + $2
         WHERE id = $1
         RETURNING next_event_sequence - $2",
    )
    .bind(game_id)
    .bind(count)
    .fetch_one(&mut *conn)
    .await?;

    let mut stored = Vec::with_capacity(events.len());
    for (sequence, event) in (first..).zip(events) {
        sqlx::query(
            "INSERT INTO game_events (game_id, sequence, actor_id, event_type, payload, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(game_id)
        .bind(sequence)
        .bind(event.actor())
        .bind(event.kind())
        .bind(Json(event_row(&event)?))
        .bind(at)
        .execute(&mut *conn)
        .await?;

        project(conn, game_id, &event, at).await?;
        stored.push(StoredEvent {
            sequence: u32::try_from(sequence).map_err(decode_error)?,
            at,
            event,
        });
    }
    Ok(stored)
}

async fn project(
    conn: &mut PgConnection,
    game_id: Uuid,
    event: &GameEvent,
    at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    match event {
        GameEvent::GameStarted { deadline, .. } => {
            sqlx::query("UPDATE games SET status = 'active', deadline = $2 WHERE id = $1")
                .bind(game_id)
                .bind(deadline)
                .execute(&mut *conn)
                .await?;
        }
        GameEvent::AnswerSubmitted {
            turn,
            correct,
            strikes,
            ..
        } => {
            sqlx::query("UPDATE games SET failure_count = $2 WHERE id = $1")
                .bind(game_id)
                .bind(i16::from(*strikes))
                .execute(&mut *conn)
                .await?;
            sqlx::query(
                "UPDATE game_parts
                 SET solved_at = CASE WHEN $3 THEN $4 END,
                     failed_at = CASE WHEN $3 THEN NULL ELSE $4 END
                 WHERE game_id = $1 AND position = $2",
            )
            .bind(game_id)
            .bind(i32::try_from(*turn).map_err(encode_error)?)
            .bind(correct)
            .bind(at)
            .execute(&mut *conn)
            .await?;
        }
        GameEvent::GameEnded { outcome, .. } => {
            sqlx::query("UPDATE games SET status = $2, ended_at = $3 WHERE id = $1")
                .bind(game_id)
                .bind(outcome.as_str())
                .bind(at)
                .execute(&mut *conn)
                .await?;
        }
        GameEvent::GameCreated { .. }
        | GameEvent::PlayerJoined { .. }
        | GameEvent::TurnStarted { .. } => {}
    }
    Ok(())
}

async fn insert_player(
    conn: &mut PgConnection,
    game_id: Uuid,
    player: &NewPlayer,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO game_players (game_id, player_id, seat, rejoin_token, preferred_role)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(game_id)
    .bind(player.id)
    .bind(i16::from(player.seat))
    .bind(player.token)
    .bind(player.role.map(Role::as_str))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Returns `true` if `error` is a foreign key violation, i.e. a document
/// referenced a topic that does not exist (any longer).
#[must_use]
pub fn is_unknown_topic(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_foreign_key_violation)
}

#[derive(Clone, Debug)]
pub struct Database {
    pool: PgPool,
}

impl Database {
    pub async fn connect(database_url: &str, max_connections: u32) -> Result<Self, sqlx::Error> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .connect(database_url)
            .await?;

        sqlx::query("SELECT 1").execute(&pool).await?;

        Ok(Self { pool })
    }

    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn migrate(&self) -> Result<(), sqlx::migrate::MigrateError> {
        sqlx::migrate!("./migrations").run(&self.pool).await
    }

    pub async fn create_topic(&self, name: &str) -> Result<Uuid, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO topics (name) VALUES ($1) RETURNING id")
            .bind(name)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn list_topics(&self) -> Result<Vec<Topic>, sqlx::Error> {
        let rows: Vec<(Uuid, String)> =
            sqlx::query_as("SELECT id, name FROM topics ORDER BY created_at, id")
                .fetch_all(&self.pool)
                .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name)| Topic { id, name })
            .collect())
    }

    pub async fn topic_exists(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM topics WHERE id = $1)")
            .bind(id)
            .fetch_one(&self.pool)
            .await
    }

    /// Draws `count` random tasks (each with an instruction) from the topics.
    pub async fn pick_tasks(
        &self,
        topics: &[Uuid],
        count: u16,
    ) -> Result<Vec<PickedTask>, sqlx::Error> {
        let rows: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
            "SELECT task_id, instruction_id, question_type FROM (
                 SELECT DISTINCT ON (t.id) t.id AS task_id, i.id AS instruction_id, t.question_type
                 FROM tasks t
                 JOIN documents d ON d.id = t.document_id
                 JOIN instructions i ON i.task_id = t.id
                 WHERE d.topic_id = ANY($1)
                 ORDER BY t.id, random()
             ) picked
             ORDER BY random()
             LIMIT $2",
        )
        .bind(topics)
        .bind(i64::from(count))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(task_id, instruction_id, question_type)| PickedTask {
                task_id,
                instruction_id,
                question_type,
            })
            .collect())
    }

    /// Creates the game with its parts and creator, and logs the first events.
    pub async fn create_game(
        &self,
        game: &NewGame<'_>,
        creator: &NewPlayer,
        events: Vec<GameEvent>,
        at: DateTime<Utc>,
    ) -> Result<Vec<StoredEvent>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO games (id, question_count, time_limit_secs, created_at)
             VALUES ($1, $2, $3, $4)",
        )
        .bind(game.id)
        .bind(i16::try_from(game.question_count).map_err(encode_error)?)
        .bind(i32::try_from(game.time_limit_secs).map_err(encode_error)?)
        .bind(at)
        .execute(&mut *tx)
        .await?;

        sqlx::query("INSERT INTO game_topics (game_id, topic_id) SELECT $1, unnest($2::uuid[])")
            .bind(game.id)
            .bind(game.topics)
            .execute(&mut *tx)
            .await?;

        for (position, task) in (0_i32..).zip(game.tasks) {
            sqlx::query(
                "INSERT INTO game_parts (game_id, task_id, instruction_id, position)
                 VALUES ($1, $2, $3, $4)",
            )
            .bind(game.id)
            .bind(task.task_id)
            .bind(task.instruction_id)
            .bind(position)
            .execute(&mut *tx)
            .await?;
        }

        insert_player(&mut tx, game.id, creator).await?;
        let stored = append_events(&mut tx, game.id, events, at).await?;
        tx.commit().await?;
        Ok(stored)
    }

    /// Seats the second player and logs the events of the join.
    pub async fn join_game(
        &self,
        game_id: Uuid,
        player: &NewPlayer,
        events: Vec<GameEvent>,
        at: DateTime<Utc>,
    ) -> Result<Vec<StoredEvent>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        insert_player(&mut tx, game_id, player).await?;
        let stored = append_events(&mut tx, game_id, events, at).await?;
        tx.commit().await?;
        Ok(stored)
    }

    pub async fn append_game_events(
        &self,
        game_id: Uuid,
        events: Vec<GameEvent>,
        at: DateTime<Utc>,
    ) -> Result<Vec<StoredEvent>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let stored = append_events(&mut tx, game_id, events, at).await?;
        tx.commit().await?;
        Ok(stored)
    }

    pub async fn load_game_events(&self, game_id: Uuid) -> Result<Vec<StoredEvent>, sqlx::Error> {
        let rows: Vec<(i32, DateTime<Utc>, String, Json<Value>)> = sqlx::query_as(
            "SELECT sequence, created_at, event_type, payload FROM game_events
             WHERE game_id = $1 ORDER BY sequence",
        )
        .bind(game_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(sequence, at, event_type, Json(payload))| {
                Ok(StoredEvent {
                    sequence: u32::try_from(sequence).map_err(decode_error)?,
                    at,
                    event: event_from_row(event_type, payload)?,
                })
            })
            .collect()
    }

    pub async fn load_part_details(&self, game_id: Uuid) -> Result<Vec<PartDetails>, sqlx::Error> {
        let rows: Vec<PartRow> = sqlx::query_as(
            "SELECT t.question_type, t.content, i.instruction, t.solution
             FROM game_parts gp
             JOIN tasks t ON t.id = gp.task_id
             JOIN instructions i ON i.id = gp.instruction_id
             WHERE gp.game_id = $1
             ORDER BY gp.position",
        )
        .bind(game_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(question_type, Json(content), Json(instruction), Json(solution))| PartDetails {
                    question_type,
                    content,
                    instruction,
                    solution,
                },
            )
            .collect())
    }

    /// The player a rejoin token belongs to.
    pub async fn find_player(
        &self,
        game_id: Uuid,
        token: Uuid,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT player_id FROM game_players WHERE game_id = $1 AND rejoin_token = $2",
        )
        .bind(game_id)
        .bind(token)
        .fetch_optional(&self.pool)
        .await
    }

    /// Games from the last hour that are still waiting for a second player.
    pub async fn list_lobbies(&self) -> Result<Vec<Lobby>, sqlx::Error> {
        let rows: Vec<(Uuid, i16, Vec<Uuid>, Option<String>)> = sqlx::query_as(
            "SELECT g.id, g.question_count,
                    array_remove(array_agg(gt.topic_id), NULL),
                    p.preferred_role
             FROM games g
             JOIN game_players p ON p.game_id = g.id AND p.seat = 0
             LEFT JOIN game_topics gt ON gt.game_id = g.id
             WHERE g.status = 'waiting' AND g.created_at > now() - interval '1 hour'
             GROUP BY g.id, p.preferred_role
             ORDER BY g.created_at DESC
             LIMIT 50",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, question_count, topics, creator_role)| Lobby {
                id,
                topics,
                question_count,
                open_role: creator_role.as_deref().map(|role| match role {
                    "defuser" => Role::Expert,
                    _ => Role::Defuser,
                }),
            })
            .collect())
    }

    /// Registers an uploaded object as a document of `topic_id`.
    ///
    /// Fails with a foreign key violation (see [`is_unknown_topic`]) if the
    /// topic does not exist.
    pub async fn mark_queued(
        &self,
        topic_id: Uuid,
        bucket: &str,
        key: &str,
        etag: Option<&str>,
        filename: &str,
    ) -> Result<Uuid, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO documents (topic_id, bucket, object_key, etag, filename)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (bucket, object_key) DO UPDATE SET
                 updated_at = now()
             RETURNING id",
        )
        .bind(topic_id)
        .bind(bucket)
        .bind(key)
        .bind(etag)
        .bind(filename)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn mark_processing(
        &self,
        topic_id: Uuid,
        bucket: &str,
        key: &str,
        etag: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO documents (topic_id, bucket, object_key, etag, ocr_status)
             VALUES ($1, $2, $3, $4, 'processing')
             ON CONFLICT (bucket, object_key) DO UPDATE SET
                 ocr_status = 'processing',
                 ocr_error = NULL,
                 updated_at = now()",
        )
        .bind(topic_id)
        .bind(bucket)
        .bind(key)
        .bind(etag)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Returns the document registered for `bucket`/`key`.
    pub async fn document_id(&self, bucket: &str, key: &str) -> Result<Option<Uuid>, sqlx::Error> {
        sqlx::query_scalar("SELECT id FROM documents WHERE bucket = $1 AND object_key = $2")
            .bind(bucket)
            .bind(key)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn topic_name(&self, topic_id: Uuid) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar("SELECT name FROM topics WHERE id = $1")
            .bind(topic_id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn mark_completed(
        &self,
        bucket: &str,
        key: &str,
        filename: &str,
        content_type: &str,
        text: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE documents
             SET filename = $3,
                 content_type = $4,
                 ocr_text = $5,
                 ocr_status = 'completed',
                 ocr_error = NULL,
                 updated_at = now()
             WHERE bucket = $1 AND object_key = $2",
        )
        .bind(bucket)
        .bind(key)
        .bind(filename)
        .bind(content_type)
        .bind(text)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_failed(
        &self,
        bucket: &str,
        key: &str,
        error: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE documents
             SET ocr_status = 'failed', ocr_error = $3, updated_at = now()
             WHERE bucket = $1 AND object_key = $2",
        )
        .bind(bucket)
        .bind(key)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
