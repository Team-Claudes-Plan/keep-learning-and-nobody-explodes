//! Persistence for generated questions and the topics they are filed under.
//!
//! `tasks.content` carries the player-facing question data, `tasks.solution`
//! wraps the answer under `correct_answer`, and `instructions.instruction`
//! carries the manual page. For `text_input`, `number_input` and `coords` the
//! prompt lives in the instruction because only the expert should read it.

use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, postgres::PgPoolOptions, types::Json};
use uuid::Uuid;

use crate::pipeline::{Question, TopicQuestions};

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

    /// Names of the topics (houses) of an island, oldest first.
    pub async fn topic_names(&self, island_id: Uuid) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar("SELECT name FROM topics WHERE island_id = $1 ORDER BY created_at, id")
            .bind(island_id)
            .fetch_all(&self.pool)
            .await
    }

    /// Inserts one task and one instruction per question in a single
    /// transaction, so a failed chronicle never leaves partial task rows.
    /// Topics are created on `island_id` as needed; a topic whose name only
    /// differs in case from an existing one is reused.
    pub async fn store_questions(
        &self,
        document_id: Uuid,
        island_id: Uuid,
        topics: &[TopicQuestions],
    ) -> Result<(), sqlx::Error> {
        let mut transaction = self.pool.begin().await?;

        for topic in topics.iter().filter(|topic| !topic.questions.is_empty()) {
            // `DO UPDATE` instead of `DO NOTHING`, so the existing row is returned
            let topic_id: Uuid = sqlx::query_scalar(
                "INSERT INTO topics (island_id, name) VALUES ($1, $2)
                 ON CONFLICT (island_id, lower(name)) DO UPDATE SET name = topics.name
                 RETURNING id",
            )
            .bind(island_id)
            .bind(topic.topic.trim())
            .fetch_one(&mut *transaction)
            .await?;

            for question in &topic.questions {
                store_question(&mut transaction, document_id, topic_id, question).await?;
            }
        }

        transaction.commit().await?;

        Ok(())
    }
}

async fn store_question(
    connection: &mut PgConnection,
    document_id: Uuid,
    topic_id: Uuid,
    question: &Question,
) -> Result<(), sqlx::Error> {
    let fields = task_fields(question).map_err(encode_error)?;

    let task_id: Uuid = sqlx::query_scalar(
        "INSERT INTO tasks (document_id, topic_id, question_type, content, solution)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id",
    )
    .bind(document_id)
    .bind(topic_id)
    .bind(fields.question_type)
    .bind(Json(fields.content))
    .bind(Json(fields.solution))
    .fetch_one(&mut *connection)
    .await?;

    sqlx::query("INSERT INTO instructions (instruction, task_id) VALUES ($1, $2)")
        .bind(Json(fields.instruction))
        .bind(task_id)
        .execute(&mut *connection)
        .await?;

    Ok(())
}

fn encode_error(error: impl std::error::Error + Send + Sync + 'static) -> sqlx::Error {
    sqlx::Error::Encode(Box::new(error))
}

#[derive(Debug)]
struct TaskFields {
    question_type: &'static str,
    content: Value,
    solution: Value,
    instruction: Value,
}

fn task_fields(question: &Question) -> Result<TaskFields, serde_json::Error> {
    let value = serde_json::to_value(question)?;
    let Value::Object(mut fields) = value else {
        return Err(serde_json::Error::io(std::io::Error::other(
            "question did not serialize to a JSON object",
        )));
    };

    let correct_answer = fields.remove("correct_answer").unwrap_or(Value::Null);
    fields.remove("type");

    let content = match question {
        Question::TextInput(question) => json!({ "caseSensitive": question.case_sensitive }),
        Question::NumberInput(question) => json!({ "unit": &question.unit }),
        Question::Coords(question) => json!({ "image": &question.image }),
        _ => Value::Object(fields),
    };

    let instruction = match question {
        Question::SingleChoice(question) => json!({ "options": &question.options }),
        Question::MultipleChoice(question) => json!({ "options": &question.options }),
        Question::TrueFalse(question) => json!({ "statements": &question.statements }),
        Question::TextInput(question) => json!({ "prompt": &question.prompt }),
        Question::NumberInput(question) => json!({ "prompt": &question.prompt }),
        Question::Matching(question) => {
            json!({ "left": &question.left, "right": &question.right })
        }
        Question::Grouping(question) => {
            json!({ "categories": &question.categories, "items": &question.items })
        }
        Question::Coords(question) => json!({ "prompt": &question.prompt }),
        Question::Order(question) => json!({ "items": &question.items }),
    };

    Ok(TaskFields {
        question_type: question.type_name(),
        content,
        solution: json!({ "correct_answer": correct_answer }),
        instruction,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    type StoredRow = (String, Json<Value>, Json<Value>, Json<Value>, Uuid);

    fn question(value: Value) -> Question {
        serde_json::from_value(value).expect("valid question")
    }

    fn fields(value: Value) -> TaskFields {
        task_fields(&question(value)).expect("question maps to task fields")
    }

    #[test]
    fn text_input_puts_prompt_in_instruction() {
        let fields = fields(json!({
            "type": "text_input",
            "prompt": "Wie heißt die Hauptstadt?",
            "caseSensitive": true,
            "correct_answer": "Berlin"
        }));

        assert_eq!(fields.question_type, "text_input");
        assert_eq!(fields.content, json!({ "caseSensitive": true }));
        assert_eq!(fields.solution, json!({ "correct_answer": "Berlin" }));
        assert_eq!(
            fields.instruction,
            json!({ "prompt": "Wie heißt die Hauptstadt?" })
        );
    }

    #[test]
    fn number_input_puts_prompt_in_instruction() {
        let fields = fields(json!({
            "type": "number_input",
            "prompt": "Wie viel wiegt es?",
            "unit": "kg",
            "correct_answer": 42
        }));

        assert_eq!(fields.question_type, "number_input");
        assert_eq!(fields.content, json!({ "unit": "kg" }));
        assert_eq!(fields.solution, json!({ "correct_answer": 42.0 }));
        assert_eq!(
            fields.instruction,
            json!({ "prompt": "Wie viel wiegt es?" })
        );
    }

    #[test]
    fn coords_puts_prompt_in_instruction() {
        let fields = fields(json!({
            "type": "coords",
            "prompt": "Wo liegt Berlin?",
            "image": "https://example.com/map.png",
            "correct_answer": { "x": 50.0, "y": 25.0 }
        }));

        assert_eq!(fields.question_type, "coords");
        assert_eq!(
            fields.content,
            json!({ "image": "https://example.com/map.png" })
        );
        assert_eq!(
            fields.solution,
            json!({ "correct_answer": { "x": 50.0, "y": 25.0 } })
        );
        assert_eq!(fields.instruction, json!({ "prompt": "Wo liegt Berlin?" }));
    }

    #[test]
    fn choice_question_keeps_question_data_in_content() {
        let fields = fields(json!({
            "type": "single_choice",
            "prompt": "Welche Zahl ist gerade?",
            "options": ["2", "3"],
            "correct_answer": 0
        }));

        assert_eq!(fields.question_type, "single_choice");
        assert_eq!(
            fields.content,
            json!({
                "prompt": "Welche Zahl ist gerade?",
                "options": ["2", "3"]
            })
        );
        assert_eq!(fields.solution, json!({ "correct_answer": 0 }));
        assert_eq!(fields.instruction, json!({ "options": ["2", "3"] }));
    }

    #[test]
    fn matching_question_keeps_question_data_in_content() {
        let fields = fields(json!({
            "type": "matching",
            "left": ["a", "b"],
            "right": ["b", "a"],
            "correct_answer": [1, 0]
        }));

        assert_eq!(
            fields.content,
            json!({
                "left": ["a", "b"],
                "right": ["b", "a"]
            })
        );
        assert_eq!(fields.solution, json!({ "correct_answer": [1, 0] }));
        assert_eq!(
            fields.instruction,
            json!({
                "left": ["a", "b"],
                "right": ["b", "a"]
            })
        );
    }

    #[test]
    fn true_false_question_has_no_prompt_in_content() {
        let fields = fields(json!({
            "type": "true_false",
            "statements": ["A", "B"],
            "correct_answer": [true, false]
        }));

        assert_eq!(fields.content, json!({ "statements": ["A", "B"] }));
        assert_eq!(fields.solution, json!({ "correct_answer": [true, false] }));
        assert_eq!(fields.instruction, json!({ "statements": ["A", "B"] }));
    }

    #[tokio::test]
    #[ignore = "requires a database (`DATABASE_URL`)"]
    #[expect(clippy::too_many_lines, reason = "one scenario, read top to bottom")]
    async fn stores_questions_in_database() {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL");
        let database = Database::connect(&url, 2).await.expect("database");
        let pool = &database.pool;

        let user: Uuid =
            sqlx::query_scalar("INSERT INTO users (name) VALUES ('akasha') RETURNING id")
                .fetch_one(pool)
                .await
                .expect("user");
        let island: Uuid = sqlx::query_scalar(
            "INSERT INTO islands (name, created_by) VALUES ($1, $2) RETURNING id",
        )
        .bind(format!("akasha-db-test-{}", Uuid::new_v4()))
        .bind(user)
        .fetch_one(pool)
        .await
        .expect("island");
        let existing: Uuid = sqlx::query_scalar(
            "INSERT INTO topics (island_id, name) VALUES ($1, 'Geografie') RETURNING id",
        )
        .bind(island)
        .fetch_one(pool)
        .await
        .expect("topic");
        let document_id: Uuid = sqlx::query_scalar(
            "INSERT INTO documents (bucket, object_key, island_id) VALUES ('test', $1, $2) RETURNING id",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(island)
        .fetch_one(pool)
        .await
        .expect("document");

        let topics = vec![
            TopicQuestions {
                topic: "Zahlen".to_owned(),
                questions: vec![question(json!({
                    "type": "single_choice",
                    "prompt": "Welche Zahl ist gerade?",
                    "options": ["2", "3"],
                    "correct_answer": 0
                }))],
            },
            TopicQuestions {
                // reuses the existing topic
                topic: "geografie".to_owned(),
                questions: vec![question(json!({
                    "type": "text_input",
                    "prompt": "Wie heißt die Hauptstadt?",
                    "caseSensitive": true,
                    "correct_answer": "Berlin"
                }))],
            },
            TopicQuestions {
                topic: "Leer".to_owned(),
                questions: Vec::new(),
            },
        ];

        database
            .store_questions(document_id, island, &topics)
            .await
            .expect("store questions");

        assert_eq!(
            database.topic_names(island).await.expect("topic names"),
            ["Geografie", "Zahlen"],
            "no duplicate for another casing, no topic without questions"
        );

        let rows: Vec<StoredRow> = sqlx::query_as(
            "SELECT t.question_type, t.content, t.solution, i.instruction, t.topic_id
             FROM tasks t
             JOIN instructions i ON i.task_id = t.id
             WHERE t.document_id = $1
             ORDER BY t.question_type",
        )
        .bind(document_id)
        .fetch_all(pool)
        .await
        .expect("stored tasks");

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, "single_choice");
        assert_eq!(
            rows[0].1.0,
            json!({ "prompt": "Welche Zahl ist gerade?", "options": ["2", "3"] })
        );
        assert_eq!(rows[0].2.0, json!({ "correct_answer": 0 }));
        assert_eq!(rows[0].3.0, json!({ "options": ["2", "3"] }));
        assert_ne!(rows[0].4, existing);
        assert_eq!(rows[1].0, "text_input");
        assert_eq!(rows[1].1.0, json!({ "caseSensitive": true }));
        assert_eq!(rows[1].2.0, json!({ "correct_answer": "Berlin" }));
        assert_eq!(
            rows[1].3.0,
            json!({ "prompt": "Wie heißt die Hauptstadt?" })
        );
        assert_eq!(rows[1].4, existing);

        sqlx::query("DELETE FROM tasks WHERE document_id = $1")
            .bind(document_id)
            .execute(pool)
            .await
            .expect("cleanup tasks");
        sqlx::query("DELETE FROM islands WHERE id = $1")
            .bind(island)
            .execute(pool)
            .await
            .expect("cleanup island");
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user)
            .execute(pool)
            .await
            .expect("cleanup user");
    }

    #[test]
    fn grouping_and_order_keep_items_in_content() {
        let grouping = fields(json!({
            "type": "grouping",
            "categories": ["X", "Y"],
            "items": ["a", "b"],
            "correct_answer": [0, 1]
        }));
        let order = fields(json!({
            "type": "order",
            "prompt": "Sortiere",
            "items": ["a", "b", "c"],
            "correct_answer": [2, 0, 1]
        }));

        assert_eq!(
            grouping.content,
            json!({
                "categories": ["X", "Y"],
                "items": ["a", "b"]
            })
        );
        assert_eq!(
            grouping.instruction,
            json!({
                "categories": ["X", "Y"],
                "items": ["a", "b"]
            })
        );
        assert_eq!(
            order.content,
            json!({
                "prompt": "Sortiere",
                "items": ["a", "b", "c"]
            })
        );
        assert_eq!(order.instruction, json!({ "items": ["a", "b", "c"] }));
    }
}
