//! Normalizes the JSON stored in `tasks`/`instructions`.
//!
//! Akasha stores the answer wrapped as `{"correct_answer": ...}` and, for
//! `text_input`, `number_input` and `coords`, keeps the prompt in the
//! instruction instead of the content. Older rows use raw solutions and put
//! the prompt in the content, so both forms are normalized here.

use serde_json::{Map, Value};
use tracing::warn;

/// Unwraps the stored solution, supporting raw values and one or more
/// `correct_answer` wrappers.
pub fn answer_value(mut solution: &Value) -> &Value {
    while let Some(inner) = solution.get("correct_answer") {
        solution = inner;
    }
    solution
}

/// Returns the player-facing task content as an object.
pub fn content_object(content: &Value) -> Map<String, Value> {
    match content {
        Value::Object(fields) => {
            let mut fields = fields.clone();
            for key in ["type", "id", "correct_answer", "solution"] {
                fields.remove(key);
            }
            fields
        }
        Value::String(prompt) => {
            let mut fields = Map::new();
            fields.insert("prompt".to_owned(), Value::String(prompt.clone()));
            fields
        }
        Value::Null => Map::new(),
        other => {
            warn!(content = %other, "task content is not an object; treating it as empty");
            Map::new()
        }
    }
}

/// Returns the instruction/manual page as an object.
pub fn instruction_object(instruction: &Value) -> Value {
    match instruction {
        Value::Object(_) => instruction.clone(),
        Value::Null => Value::Object(Map::new()),
        Value::String(text) => {
            let mut fields = Map::new();
            fields.insert("text".to_owned(), Value::String(text.clone()));
            Value::Object(fields)
        }
        other => {
            warn!(instruction = %other, "task instruction is not an object; wrapping it");
            let mut fields = Map::new();
            fields.insert("value".to_owned(), other.clone());
            Value::Object(fields)
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn unwraps_wrapped_and_nested_solutions() {
        assert_eq!(answer_value(&json!(1)), &json!(1));
        assert_eq!(answer_value(&json!({ "correct_answer": 1 })), &json!(1));
        assert_eq!(
            answer_value(&json!({ "correct_answer": { "correct_answer": [0, 2] } })),
            &json!([0, 2])
        );
        assert_eq!(
            answer_value(&json!({ "correct_answer": { "x": 1.0, "y": 2.0 } })),
            &json!({ "x": 1.0, "y": 2.0 })
        );
    }

    #[test]
    fn strips_solution_fields_from_content() {
        let content = json!({
            "type": "single_choice",
            "id": "task-id",
            "prompt": "Question?",
            "options": ["a", "b"],
            "correct_answer": 1,
            "solution": 1
        });

        assert_eq!(
            content_object(&content),
            json!({
                "prompt": "Question?",
                "options": ["a", "b"]
            })
            .as_object()
            .expect("object")
            .clone()
        );
    }

    #[test]
    fn accepts_plain_string_content_as_prompt() {
        assert_eq!(
            content_object(&json!("Question?")),
            json!({ "prompt": "Question?" })
                .as_object()
                .expect("object")
                .clone()
        );
    }

    #[test]
    fn normalizes_empty_and_invalid_content() {
        assert!(content_object(&Value::Null).is_empty());
        assert!(content_object(&json!([1, 2])).is_empty());
    }

    #[test]
    fn normalizes_instruction_variants() {
        assert_eq!(
            instruction_object(&json!({ "options": ["a", "b"] })),
            json!({ "options": ["a", "b"] })
        );
        assert_eq!(instruction_object(&Value::Null), json!({}));
        assert_eq!(
            instruction_object(&json!("text")),
            json!({ "text": "text" })
        );
        assert_eq!(
            instruction_object(&json!([1, 2])),
            json!({ "value": [1, 2] })
        );
    }
}
