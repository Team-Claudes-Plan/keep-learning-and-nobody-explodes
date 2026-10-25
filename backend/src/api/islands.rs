//! Islands: what a user uploads documents into, shared with at most one
//! partner. Their houses are the topics Akasha files the questions under.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    GlobalState,
    api::{error::ApiError, user::CurrentUser},
    db::{AddMember, Database, IslandSummary, TopicProgress, UserSummary},
    knowledge,
};

#[derive(Deserialize)]
pub struct CreateIslandRequest {
    name: String,
    /// The second member, if they learn along from the start.
    partner_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct CreatedIsland {
    id: Uuid,
}

#[derive(Deserialize)]
pub struct AddMemberRequest {
    user_id: Uuid,
}

#[derive(Deserialize)]
pub struct ForkIslandRequest {
    partner_id: Uuid,
    /// Defaults to the name of the forked island.
    name: Option<String>,
}

#[derive(Serialize)]
pub struct IslandsResponse {
    me: UserSummary,
    islands: Vec<Island>,
}

#[derive(Serialize)]
pub struct Island {
    id: Uuid,
    name: String,
    origin_id: Option<Uuid>,
    group: Group,
    houses: Vec<House>,
}

/// The members of an island; the island id doubles as the group id.
#[derive(Serialize)]
pub struct Group {
    id: Uuid,
    members: Vec<UserSummary>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct House {
    topic_id: Uuid,
    name: String,
    /// Number of skills (storeys) every member of the island has learned,
    /// `0..=MAX_LEVEL`.
    level: u8,
    unlocked: bool,
}

fn trimmed_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(ApiError::BadRequest(
            "island name must not be empty".to_owned(),
        ));
    }
    Ok(name)
}

async fn require_user(db: &Database, id: Uuid) -> Result<(), ApiError> {
    match db.user(id).await {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(ApiError::BadRequest(format!("user {id} does not exist"))),
        Err(error) => Err(ApiError::db("look up user", &error)),
    }
}

/// Fails with 404 rather than 403 for islands of others, so their ids do not leak.
async fn require_member(
    db: &Database,
    island_id: Uuid,
    user: &CurrentUser,
) -> Result<(), ApiError> {
    let member = db
        .is_island_member(island_id, user.id())
        .await
        .map_err(|error| ApiError::db("look up island members", &error))?;
    if member {
        Ok(())
    } else {
        Err(ApiError::NotFound(format!("island {island_id} not found")))
    }
}

pub async fn islands_create(
    State(state): State<Arc<GlobalState>>,
    user: CurrentUser,
    Json(payload): Json<CreateIslandRequest>,
) -> Result<Json<CreatedIsland>, ApiError> {
    let name = trimmed_name(&payload.name)?;
    if let Some(partner) = payload.partner_id {
        if partner == user.id() {
            return Err(ApiError::BadRequest(
                "the partner must be someone else".to_owned(),
            ));
        }
        require_user(&state.db, partner).await?;
    }

    let id = state
        .db
        .create_island(name, user.id(), payload.partner_id)
        .await
        .map_err(|error| ApiError::db("create island", &error))?;

    Ok(Json(CreatedIsland { id }))
}

pub async fn islands_add_member(
    State(state): State<Arc<GlobalState>>,
    user: CurrentUser,
    Path(island_id): Path<Uuid>,
    Json(payload): Json<AddMemberRequest>,
) -> Result<StatusCode, ApiError> {
    require_member(&state.db, island_id, &user).await?;
    require_user(&state.db, payload.user_id).await?;

    let added = state
        .db
        .add_island_member(island_id, payload.user_id)
        .await
        .map_err(|error| ApiError::db("add island member", &error))?;
    match added {
        AddMember::Added => Ok(StatusCode::NO_CONTENT),
        AddMember::AlreadyMember => Err(ApiError::Conflict(
            "user is already a member of the island".to_owned(),
        )),
        AddMember::Full => Err(ApiError::Conflict(
            "island already has two members; fork it to learn with someone else".to_owned(),
        )),
        AddMember::UnknownIsland => {
            Err(ApiError::NotFound(format!("island {island_id} not found")))
        }
    }
}

pub async fn islands_fork(
    State(state): State<Arc<GlobalState>>,
    user: CurrentUser,
    Path(island_id): Path<Uuid>,
    Json(payload): Json<ForkIslandRequest>,
) -> Result<Json<CreatedIsland>, ApiError> {
    let name = payload.name.as_deref().map(trimmed_name).transpose()?;
    if payload.partner_id == user.id() {
        return Err(ApiError::BadRequest(
            "the partner must be someone else".to_owned(),
        ));
    }
    require_member(&state.db, island_id, &user).await?;
    require_user(&state.db, payload.partner_id).await?;

    let id = state
        .db
        .fork_island(island_id, name, user.id(), payload.partner_id)
        .await
        .map_err(|error| ApiError::db("fork island", &error))?
        .ok_or_else(|| ApiError::NotFound(format!("island {island_id} not found")))?;

    Ok(Json(CreatedIsland { id }))
}

pub async fn islands_list(
    State(state): State<Arc<GlobalState>>,
    user: CurrentUser,
) -> Result<Json<IslandsResponse>, ApiError> {
    let summaries = state
        .db
        .islands_of_user(user.id())
        .await
        .map_err(|error| ApiError::db("list islands", &error))?;

    let mut islands = Vec::with_capacity(summaries.len());
    for summary in summaries {
        let topics = state
            .db
            .island_topics(summary.id, state.language)
            .await
            .map_err(|error| ApiError::db("load island topics", &error))?;
        islands.push(island(summary, &topics));
    }

    Ok(Json(IslandsResponse {
        me: user.0,
        islands,
    }))
}

fn island(summary: IslandSummary, topics: &[TopicProgress]) -> Island {
    Island {
        id: summary.id,
        name: summary.name,
        origin_id: summary.origin_id,
        group: Group {
            id: summary.id,
            members: summary.members,
        },
        houses: topics.iter().map(house).collect(),
    }
}

fn house(topic: &TopicProgress) -> House {
    let level =
        knowledge::house_level(topic.skills.iter().map(|skill| {
            knowledge::skill_learned(skill.members.iter().map(|member| member.solved))
        }));
    House {
        topic_id: topic.id,
        name: topic.name.clone(),
        level,
        unlocked: level > 0,
    }
}

#[cfg(test)]
mod tests {
    use axum::http::Method;
    use grpc::akasha::Language;
    use serde_json::{Value, json};

    use super::*;
    use crate::{
        api::testing::{app, call},
        db::{MemberProgress, SkillProgress},
    };

    fn skill(id: u128, solved: &[u32]) -> SkillProgress {
        SkillProgress {
            id: Uuid::from_u128(id),
            name: format!("skill {id}"),
            tasks: 1,
            members: (0..)
                .zip(solved)
                .map(|(user, &solved)| MemberProgress {
                    user_id: Uuid::from_u128(user),
                    solved,
                })
                .collect(),
        }
    }

    fn topic(skills: Vec<SkillProgress>) -> TopicProgress {
        TopicProgress {
            id: Uuid::from_u128(100),
            name: "Cells".to_owned(),
            skills,
        }
    }

    #[test]
    fn house_is_built_as_far_as_both_members_know_it() {
        let house = house(&topic(vec![
            skill(1, &[1, 2]),
            skill(2, &[1, 1]),
            skill(3, &[3, 0]),
        ]));
        assert_eq!((house.level, house.unlocked), (2, true));
    }

    #[test]
    fn house_of_a_solo_island_follows_its_member() {
        let house = house(&topic(vec![skill(1, &[1])]));
        assert_eq!((house.level, house.unlocked), (1, true));
    }

    #[test]
    fn house_level_is_capped_at_the_drawable_storeys() {
        let house = house(&topic((0..6).map(|id| skill(id, &[1, 1])).collect()));
        assert_eq!(house.level, knowledge::MAX_LEVEL);
    }

    async fn user(db: &Database, name: &str) -> Uuid {
        db.create_user(name).await.expect("user")
    }

    /// A topic with `tasks` tasks on `island` in `language`, the first `solved`
    /// of which `players` solved together in one finished game.
    async fn seed_topic(
        db: &Database,
        island: Uuid,
        tasks: usize,
        solved: usize,
        players: [Uuid; 2],
        language: Language,
    ) -> Uuid {
        let pool = db.pool();
        let topic: Uuid = sqlx::query_scalar(
            "INSERT INTO topics (island_id, language, name)
             VALUES ($1, $2, $3) RETURNING id",
        )
        .bind(island)
        .bind(crate::db::language_code(language))
        .bind(format!("topic {}", Uuid::new_v4()))
        .fetch_one(pool)
        .await
        .expect("topic");
        let document: Uuid = sqlx::query_scalar(
            "INSERT INTO documents (bucket, object_key, island_id) VALUES ('test', $1, $2) RETURNING id",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(island)
        .fetch_one(pool)
        .await
        .expect("document");
        let game: Uuid = sqlx::query_scalar(
            "INSERT INTO games (status, ended_at) VALUES ('won', now()) RETURNING id",
        )
        .fetch_one(pool)
        .await
        .expect("game");
        for (seat, player) in (0_i16..).zip(players) {
            sqlx::query(
                "INSERT INTO game_players (game_id, player_id, seat, rejoin_token) VALUES ($1, $2, $3, $4)",
            )
            .bind(game)
            .bind(player)
            .bind(seat)
            .bind(Uuid::new_v4())
            .execute(pool)
            .await
            .expect("player");
        }
        for position in 0..tasks {
            // one skill per task, so `solved` tasks also means `solved` skills
            let skill: Uuid = sqlx::query_scalar(
                "INSERT INTO skills (topic_id, name) VALUES ($1, $2) RETURNING id",
            )
            .bind(topic)
            .bind(format!("skill {}", Uuid::new_v4()))
            .fetch_one(pool)
            .await
            .expect("skill");
            let task: Uuid = sqlx::query_scalar(
                "INSERT INTO tasks (document_id, skill_id, question_type, solution)
                 VALUES ($1, $2, 'text_input', '\"x\"') RETURNING id",
            )
            .bind(document)
            .bind(skill)
            .fetch_one(pool)
            .await
            .expect("task");
            let instruction: Uuid =
                sqlx::query_scalar("INSERT INTO instructions (task_id) VALUES ($1) RETURNING id")
                    .bind(task)
                    .fetch_one(pool)
                    .await
                    .expect("instruction");
            if position < solved {
                sqlx::query(
                    "INSERT INTO game_parts (game_id, task_id, instruction_id, position, solved_at)
                     VALUES ($1, $2, $3, $4, now())",
                )
                .bind(game)
                .bind(task)
                .bind(instruction)
                .bind(i32::try_from(position).expect("position"))
                .execute(pool)
                .await
                .expect("part");
            }
        }
        topic
    }

    fn houses(body: &Value, island: Uuid) -> Vec<(String, u64, bool)> {
        let island = body["islands"]
            .as_array()
            .expect("islands")
            .iter()
            .find(|candidate| candidate["id"] == island.to_string())
            .expect("island is listed");
        island["houses"]
            .as_array()
            .expect("houses")
            .iter()
            .map(|house| {
                (
                    house["topic_id"].as_str().expect("topic id").to_owned(),
                    house["level"].as_u64().expect("level"),
                    house["unlocked"].as_bool().expect("unlocked"),
                )
            })
            .collect()
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn island_takes_one_partner() {
        let (app, db) = app().await;
        let (alex, mia, leo) = (
            user(&db, "Alex").await,
            user(&db, "Mia").await,
            user(&db, "Leo").await,
        );

        let (status, body) = call(
            &app,
            Method::PUT,
            "/api/islands/create",
            Some(alex),
            Some(json!({ "name": " Semester 1 " })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let island: Uuid = serde_json::from_value(body["id"].clone()).expect("id");
        let members = format!("/api/islands/{island}/members");

        // only members may add someone
        let (status, _) = call(
            &app,
            Method::PUT,
            &members,
            Some(mia),
            Some(json!({ "user_id": mia })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, _) = call(
            &app,
            Method::PUT,
            &members,
            Some(alex),
            Some(json!({ "user_id": mia })),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);

        let (status, body) = call(
            &app,
            Method::PUT,
            &members,
            Some(mia),
            Some(json!({ "user_id": leo })),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(body["message"].as_str().expect("message").contains("fork"));

        let (status, body) = call(&app, Method::GET, "/api/islands", Some(mia), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["me"]["name"], "Mia");
        let listed = body["islands"]
            .as_array()
            .expect("islands")
            .iter()
            .find(|candidate| candidate["id"] == island.to_string())
            .expect("mia sees the island");
        assert_eq!(listed["name"], "Semester 1");
        let names: Vec<&str> = listed["group"]["members"]
            .as_array()
            .expect("members")
            .iter()
            .map(|member| member["name"].as_str().expect("name"))
            .collect();
        assert_eq!(names, ["Alex", "Mia"], "creator first");

        let (_, body) = call(&app, Method::GET, "/api/islands", Some(leo), None).await;
        assert_eq!(body["islands"], json!([]), "leo is on no island");
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn fork_unlocks_what_both_already_know() {
        let (app, db) = app().await;
        let (alex, mia, leo) = (
            user(&db, "Alex").await,
            user(&db, "Mia").await,
            user(&db, "Leo").await,
        );
        let island = db
            .create_island("Semester 1", alex, Some(mia))
            .await
            .expect("island");
        // alex and mia solved all of `known`, leo none of it
        let known = seed_topic(&db, island, 4, 4, [alex, mia], Language::German).await;
        // alex and leo solved half of `shared` in some other game
        let shared = seed_topic(&db, island, 4, 2, [alex, leo], Language::German).await;

        let (status, body) = call(
            &app,
            Method::PUT,
            &format!("/api/islands/{island}/fork"),
            Some(alex),
            Some(json!({ "partner_id": leo })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let fork: Uuid = serde_json::from_value(body["id"].clone()).expect("id");

        let (_, body) = call(&app, Method::GET, "/api/islands", Some(alex), None).await;
        assert_eq!(
            houses(&body, island),
            [(known.to_string(), 4, true), (shared.to_string(), 0, false)],
            "mia never played `shared`"
        );
        assert_eq!(
            houses(&body, fork),
            [(known.to_string(), 0, false), (shared.to_string(), 2, true)],
            "the fork shares the topics, leo never played `known`"
        );
        let fork_entry = body["islands"]
            .as_array()
            .expect("islands")
            .iter()
            .find(|candidate| candidate["id"] == fork.to_string())
            .expect("fork");
        assert_eq!(fork_entry["origin_id"], island.to_string());
        assert_eq!(fork_entry["name"], "Semester 1");
        assert_eq!(db.content_island(fork).await.expect("lookup"), Some(island));

        // a fork of the fork still points at the root
        let (_, body) = call(
            &app,
            Method::PUT,
            &format!("/api/islands/{fork}/fork"),
            Some(leo),
            Some(json!({ "partner_id": mia, "name": "Leo & Mia" })),
        )
        .await;
        let second: Uuid = serde_json::from_value(body["id"].clone()).expect("id");
        assert_eq!(
            db.content_island(second).await.expect("lookup"),
            Some(island)
        );
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn hides_topics_of_the_other_language() {
        let (app, db) = app().await;
        let (alex, mia) = (user(&db, "Alex").await, user(&db, "Mia").await);
        let island = db
            .create_island("Languages", alex, Some(mia))
            .await
            .expect("island");
        let german = seed_topic(&db, island, 1, 0, [alex, mia], Language::German).await;
        seed_topic(&db, island, 1, 0, [alex, mia], Language::English).await;

        let (status, body) = call(&app, Method::GET, "/api/islands", Some(alex), None).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            houses(&body, island),
            [(german.to_string(), 0, false)],
            "the English variant does not exist for a German reader"
        );
    }

    #[tokio::test]
    #[ignore = "requires the dev stack (`nix run .#dev`) and its environment"]
    async fn requires_a_known_user() {
        let (app, _) = app().await;

        let (status, _) = call(&app, Method::GET, "/api/islands", None, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = call(
            &app,
            Method::GET,
            "/api/islands",
            Some(Uuid::new_v4()),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
}
