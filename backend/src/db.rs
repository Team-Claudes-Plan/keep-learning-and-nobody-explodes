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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UserSummary {
    pub id: Uuid,
    pub name: String,
}

/// An island a user belongs to, with its members in the order they joined.
#[derive(Debug)]
pub struct IslandSummary {
    pub id: Uuid,
    pub name: String,
    /// The island this one was forked from; `None` for an original.
    pub origin_id: Option<Uuid>,
    pub members: Vec<UserSummary>,
}

/// How much of a skill one member of an island has learned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemberProgress {
    pub user_id: Uuid,
    /// Distinct tasks of the skill the member solved in any game.
    pub solved: u32,
}

/// A skill (storey) of a topic and what its members know of it.
#[derive(Debug)]
pub struct SkillProgress {
    pub id: Uuid,
    pub name: String,
    /// Tasks the skill has in total.
    pub tasks: u32,
    pub members: Vec<MemberProgress>,
}

/// A topic (house) of an island with its skills (storeys).
#[derive(Debug)]
pub struct TopicProgress {
    pub id: Uuid,
    pub name: String,
    pub skills: Vec<SkillProgress>,
}

/// Result of [`Database::add_island_member`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddMember {
    Added,
    AlreadyMember,
    /// The island already has two members.
    Full,
    UnknownIsland,
}

/// An island has at most this many members.
pub const MAX_ISLAND_MEMBERS: usize = 2;

/// A task drawn for a new game, with one of its instructions.
#[derive(Debug)]
pub struct PickedTask {
    pub task_id: Uuid,
    pub instruction_id: Uuid,
    pub question_type: String,
    pub content: Value,
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

/// `(id, name, origin_id, member ids, member names)`
type IslandRow = (Uuid, String, Option<Uuid>, Vec<Uuid>, Vec<String>);

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
/// referenced an island that does not exist (any longer).
#[must_use]
pub fn is_unknown_island(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .is_some_and(sqlx::error::DatabaseError::is_foreign_key_violation)
}

async fn insert_island(
    conn: &mut PgConnection,
    name: &str,
    creator: Uuid,
    origin: Option<Uuid>,
) -> Result<Uuid, sqlx::Error> {
    sqlx::query_scalar(
        "INSERT INTO islands (name, created_by, origin_id) VALUES ($1, $2, $3) RETURNING id",
    )
    .bind(name)
    .bind(creator)
    .bind(origin)
    .fetch_one(&mut *conn)
    .await
}

async fn insert_member(
    conn: &mut PgConnection,
    island_id: Uuid,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO island_members (island_id, user_id) VALUES ($1, $2)")
        .bind(island_id)
        .bind(user_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn add_members(
    conn: &mut PgConnection,
    island_id: Uuid,
    creator: Uuid,
    partner: Option<Uuid>,
) -> Result<(), sqlx::Error> {
    insert_member(conn, island_id, creator).await?;
    if let Some(partner) = partner {
        insert_member(conn, island_id, partner).await?;
    }
    Ok(())
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

    pub async fn create_user(&self, name: &str) -> Result<Uuid, sqlx::Error> {
        sqlx::query_scalar("INSERT INTO users (name) VALUES ($1) RETURNING id")
            .bind(name)
            .fetch_one(&self.pool)
            .await
    }

    pub async fn user(&self, id: Uuid) -> Result<Option<UserSummary>, sqlx::Error> {
        let row: Option<String> = sqlx::query_scalar("SELECT name FROM users WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|name| UserSummary { id, name }))
    }

    /// Creates an island with its creator and, optionally, the second member.
    pub async fn create_island(
        &self,
        name: &str,
        creator: Uuid,
        partner: Option<Uuid>,
    ) -> Result<Uuid, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let id = insert_island(&mut tx, name, creator, None).await?;
        add_members(&mut tx, id, creator, partner).await?;
        tx.commit().await?;
        Ok(id)
    }

    /// Creates a fork of `island_id` for `creator` and `partner`. The fork
    /// shares the content of the root island and keeps its name unless `name`
    /// is given. Returns `None` if the island does not exist.
    pub async fn fork_island(
        &self,
        island_id: Uuid,
        name: Option<&str>,
        creator: Uuid,
        partner: Uuid,
    ) -> Result<Option<Uuid>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let origin: Option<(Uuid, String)> =
            sqlx::query_as("SELECT COALESCE(origin_id, id), name FROM islands WHERE id = $1")
                .bind(island_id)
                .fetch_optional(&mut *tx)
                .await?;
        let Some((root, origin_name)) = origin else {
            return Ok(None);
        };
        let id = insert_island(&mut tx, name.unwrap_or(&origin_name), creator, Some(root)).await?;
        add_members(&mut tx, id, creator, Some(partner)).await?;
        tx.commit().await?;
        Ok(Some(id))
    }

    /// Adds `user_id` as the second member of an island.
    pub async fn add_island_member(
        &self,
        island_id: Uuid,
        user_id: Uuid,
    ) -> Result<AddMember, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        // the row lock serializes concurrent joins, so the count below holds
        let locked: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM islands WHERE id = $1 FOR UPDATE")
                .bind(island_id)
                .fetch_optional(&mut *tx)
                .await?;
        if locked.is_none() {
            return Ok(AddMember::UnknownIsland);
        }
        let members: Vec<Uuid> =
            sqlx::query_scalar("SELECT user_id FROM island_members WHERE island_id = $1")
                .bind(island_id)
                .fetch_all(&mut *tx)
                .await?;
        if members.contains(&user_id) {
            return Ok(AddMember::AlreadyMember);
        }
        if members.len() >= MAX_ISLAND_MEMBERS {
            return Ok(AddMember::Full);
        }
        insert_member(&mut tx, island_id, user_id).await?;
        tx.commit().await?;
        Ok(AddMember::Added)
    }

    pub async fn is_island_member(
        &self,
        island_id: Uuid,
        user_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM island_members WHERE island_id = $1 AND user_id = $2)",
        )
        .bind(island_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
    }

    /// The island that owns the documents and topics of `island_id`: the
    /// island itself, or the origin of a fork. `None` if it does not exist.
    pub async fn content_island(&self, island_id: Uuid) -> Result<Option<Uuid>, sqlx::Error> {
        sqlx::query_scalar("SELECT COALESCE(origin_id, id) FROM islands WHERE id = $1")
            .bind(island_id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn island_name(&self, island_id: Uuid) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar("SELECT name FROM islands WHERE id = $1")
            .bind(island_id)
            .fetch_optional(&self.pool)
            .await
    }

    /// The islands `user_id` is a member of, oldest first. Members are listed
    /// creator first, then in the order they joined.
    pub async fn islands_of_user(&self, user_id: Uuid) -> Result<Vec<IslandSummary>, sqlx::Error> {
        let rows: Vec<IslandRow> = sqlx::query_as(
            "SELECT i.id, i.name, i.origin_id,
                    array_agg(u.id ORDER BY u.id = i.created_by DESC, m.joined_at, u.id),
                    array_agg(u.name ORDER BY u.id = i.created_by DESC, m.joined_at, u.id)
             FROM island_members own
             JOIN islands i ON i.id = own.island_id
             JOIN island_members m ON m.island_id = i.id
             JOIN users u ON u.id = m.user_id
             WHERE own.user_id = $1
             GROUP BY i.id
             ORDER BY i.created_at, i.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, origin_id, ids, names)| IslandSummary {
                id,
                name,
                origin_id,
                members: ids
                    .into_iter()
                    .zip(names)
                    .map(|(id, name)| UserSummary { id, name })
                    .collect(),
            })
            .collect())
    }

    /// The topics of an island (shared with its origin, if it is a fork) with
    /// their skills and how many tasks of each skill every member has solved.
    /// Topics without skills are returned with an empty skill list.
    pub async fn island_topics(&self, island_id: Uuid) -> Result<Vec<TopicProgress>, sqlx::Error> {
        type Row = (Uuid, String, Option<Uuid>, Option<String>, i64, Uuid, i64);

        let rows: Vec<Row> = sqlx::query_as(
            "SELECT t.id, t.name, s.id, s.name,
                    COALESCE((SELECT count(*) FROM tasks k WHERE k.skill_id = s.id), 0),
                    m.user_id,
                    COALESCE((SELECT count(DISTINCT gp.task_id)
                     FROM game_parts gp
                     JOIN game_players p ON p.game_id = gp.game_id
                     JOIN tasks k ON k.id = gp.task_id
                     WHERE p.player_id = m.user_id
                       AND k.skill_id = s.id
                       AND gp.solved_at IS NOT NULL), 0)
             FROM islands i
             JOIN topics t ON t.island_id = COALESCE(i.origin_id, i.id)
             LEFT JOIN skills s ON s.topic_id = t.id
             JOIN island_members m ON m.island_id = i.id
             WHERE i.id = $1
             ORDER BY t.created_at, t.id, s.created_at, s.id, m.user_id",
        )
        .bind(island_id)
        .fetch_all(&self.pool)
        .await?;

        let mut topics: Vec<TopicProgress> = Vec::new();
        for (topic_id, topic_name, skill_id, skill_name, tasks, user_id, solved) in rows {
            let topic = match topics.last_mut() {
                Some(topic) if topic.id == topic_id => topic,
                _ => {
                    topics.push(TopicProgress {
                        id: topic_id,
                        name: topic_name,
                        skills: Vec::new(),
                    });
                    topics.last_mut().expect("topic was just pushed")
                }
            };

            let (Some(skill_id), Some(skill_name)) = (skill_id, skill_name) else {
                continue;
            };

            let member = MemberProgress {
                user_id,
                solved: u32::try_from(solved).map_err(decode_error)?,
            };
            match topic.skills.last_mut() {
                Some(skill) if skill.id == skill_id => skill.members.push(member),
                _ => topic.skills.push(SkillProgress {
                    id: skill_id,
                    name: skill_name,
                    tasks: u32::try_from(tasks).map_err(decode_error)?,
                    members: vec![member],
                }),
            }
        }
        Ok(topics)
    }

    /// Draws `count` random tasks (each with an instruction) from the topics
    /// (houses). Each round takes one task per skill, so a game spreads over the
    /// skills of the chosen topics instead of filling up from one skill.
    pub async fn pick_tasks(
        &self,
        topics: &[Uuid],
        count: u16,
    ) -> Result<Vec<PickedTask>, sqlx::Error> {
        let rows: Vec<(Uuid, Uuid, String, Json<Value>)> = sqlx::query_as(
            "WITH candidates AS (
                 SELECT DISTINCT ON (t.id) t.id AS task_id, i.id AS instruction_id,
                        s.id AS skill_id, t.question_type, t.content,
                        random() AS task_random
                 FROM tasks t
                 JOIN skills s ON s.id = t.skill_id
                 JOIN instructions i ON i.task_id = t.id
                 WHERE s.topic_id = ANY($1)
                 ORDER BY t.id, random()
             ), ranked AS (
                 SELECT task_id, instruction_id, question_type, content, task_random,
                        row_number() OVER (PARTITION BY skill_id ORDER BY task_random)
                            AS skill_rank
                 FROM candidates
             )
             SELECT task_id, instruction_id, question_type, content
             FROM ranked
             ORDER BY skill_rank, task_random
             LIMIT $2",
        )
        .bind(topics)
        .bind(i64::from(count))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(task_id, instruction_id, question_type, Json(content))| PickedTask {
                    task_id,
                    instruction_id,
                    question_type,
                    content,
                },
            )
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

    /// Registers an uploaded object as a document of `island_id`.
    ///
    /// Fails with a foreign key violation (see [`is_unknown_island`]) if the
    /// island does not exist.
    pub async fn mark_queued(
        &self,
        island_id: Uuid,
        bucket: &str,
        key: &str,
        etag: Option<&str>,
        filename: &str,
    ) -> Result<Uuid, sqlx::Error> {
        sqlx::query_scalar(
            "INSERT INTO documents (island_id, bucket, object_key, etag, filename)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (bucket, object_key) DO UPDATE SET
                 updated_at = now()
             RETURNING id",
        )
        .bind(island_id)
        .bind(bucket)
        .bind(key)
        .bind(etag)
        .bind(filename)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn mark_processing(
        &self,
        island_id: Uuid,
        bucket: &str,
        key: &str,
        etag: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO documents (island_id, bucket, object_key, etag, ocr_status)
             VALUES ($1, $2, $3, $4, 'processing')
             ON CONFLICT (bucket, object_key) DO UPDATE SET
                 ocr_status = 'processing',
                 ocr_error = NULL,
                 updated_at = now()",
        )
        .bind(island_id)
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

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::*;

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn pick_tasks_spreads_over_the_skills_of_a_topic() {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let db = Database::connect(&url, 2).await.expect("database");
        db.migrate().await.expect("migrations");
        let pool = db.pool();

        let user = db.create_user("pick tasks test").await.expect("user");
        let island = db
            .create_island("pick tasks test", user, None)
            .await
            .expect("island");
        let topic: Uuid = sqlx::query_scalar(
            "INSERT INTO topics (island_id, name) VALUES ($1, 'Mathe') RETURNING id",
        )
        .bind(island)
        .fetch_one(pool)
        .await
        .expect("topic");
        let document: Uuid = sqlx::query_scalar(
            "INSERT INTO documents (bucket, object_key, island_id)
             VALUES ('test', $1, $2) RETURNING id",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(island)
        .fetch_one(pool)
        .await
        .expect("document");

        for (index, tasks) in [3_usize, 1, 1].into_iter().enumerate() {
            let skill: Uuid = sqlx::query_scalar(
                "INSERT INTO skills (topic_id, name) VALUES ($1, $2) RETURNING id",
            )
            .bind(topic)
            .bind(format!("skill {index}"))
            .fetch_one(pool)
            .await
            .expect("skill");
            for _ in 0..tasks {
                let task: Uuid = sqlx::query_scalar(
                    "INSERT INTO tasks (document_id, skill_id, question_type, solution)
                     VALUES ($1, $2, 'text_input', $3) RETURNING id",
                )
                .bind(document)
                .bind(skill)
                .bind(Json(json!({ "correct_answer": "x" })))
                .fetch_one(pool)
                .await
                .expect("task");
                sqlx::query("INSERT INTO instructions (task_id) VALUES ($1)")
                    .bind(task)
                    .execute(pool)
                    .await
                    .expect("instruction");
            }
        }

        let picked = db.pick_tasks(&[topic], 3).await.expect("picked tasks");
        assert_eq!(picked.len(), 3);

        let task_ids = picked.iter().map(|task| task.task_id).collect::<Vec<_>>();
        let skills: Vec<Uuid> = sqlx::query_scalar("SELECT skill_id FROM tasks WHERE id = ANY($1)")
            .bind(task_ids)
            .fetch_all(pool)
            .await
            .expect("task skills");
        assert_eq!(
            skills.into_iter().collect::<HashSet<_>>().len(),
            3,
            "one task from each skill is picked before a skill repeats"
        );
    }
}
