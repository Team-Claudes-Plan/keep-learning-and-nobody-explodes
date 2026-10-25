//! Rust representation of `schema/questions.schema.json`.
//!
//! Deserialization enforces the JSON schema (required fields, unknown fields,
//! value types). [`convert`] additionally validates cross-field invariants such
//! as answer lengths, index ranges, permutations and coordinate bounds.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

/// Question types accepted by the schema, in the generated prompt.
pub const TYPES: &[&str] = &[
    "single_choice",
    "multiple_choice",
    "true_false",
    "text_input",
    "number_input",
    "matching",
    "grouping",
    "coords",
    "order",
];

/// One question as defined by `questions.schema.json`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Question {
    SingleChoice(SingleChoice),
    MultipleChoice(MultipleChoice),
    TrueFalse(TrueFalse),
    TextInput(TextInput),
    NumberInput(NumberInput),
    Matching(Matching),
    Grouping(Grouping),
    Coords(Coords),
    Order(Order),
}

impl Question {
    #[must_use]
    pub const fn type_name(&self) -> &'static str {
        match self {
            Self::SingleChoice(_) => "single_choice",
            Self::MultipleChoice(_) => "multiple_choice",
            Self::TrueFalse(_) => "true_false",
            Self::TextInput(_) => "text_input",
            Self::NumberInput(_) => "number_input",
            Self::Matching(_) => "matching",
            Self::Grouping(_) => "grouping",
            Self::Coords(_) => "coords",
            Self::Order(_) => "order",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SingleChoice {
    pub prompt: String,
    pub options: Vec<String>,
    pub correct_answer: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MultipleChoice {
    pub prompt: String,
    pub options: Vec<String>,
    pub correct_answer: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TrueFalse {
    pub statements: Vec<String>,
    pub correct_answer: Vec<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextInput {
    pub prompt: String,
    #[serde(default, rename = "caseSensitive")]
    pub case_sensitive: bool,
    pub correct_answer: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NumberInput {
    pub prompt: String,
    pub unit: Nullable<String>,
    pub correct_answer: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Matching {
    pub left: Vec<String>,
    pub right: Vec<String>,
    pub correct_answer: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grouping {
    pub categories: Vec<String>,
    pub items: Vec<String>,
    pub correct_answer: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Coords {
    pub prompt: String,
    pub image: String,
    pub correct_answer: CoordsAnswer,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoordsAnswer {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Order {
    pub prompt: String,
    pub items: Vec<String>,
    pub correct_answer: Vec<u32>,
}

/// A required field that may be `null`.
///
/// `Option<T>` cannot distinguish a missing field from an explicit `null`, but
/// `number_input.unit` must be present either way.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Nullable<T> {
    Value(T),
    Null,
}

/// A static schema or game invariant violation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchemaIssue {
    /// Zero-based index of the question in the generated array.
    pub question: Option<usize>,
    /// Field path within the question, for example `correct_answer`.
    pub field: Option<String>,
    pub message: String,
}

impl fmt::Display for SchemaIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match (self.question, &self.field) {
            (Some(question), Some(field)) => {
                write!(f, "question {question} `{field}`: {}", self.message)
            }
            (Some(question), None) => {
                write!(f, "question {question}: {}", self.message)
            }
            (None, Some(field)) => write!(f, "`{field}`: {}", self.message),
            (None, None) => f.write_str(&self.message),
        }
    }
}

/// Collection of all violations found in one candidate.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SchemaIssues(pub Vec<SchemaIssue>);

impl fmt::Display for SchemaIssues {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const MAX_SHOWN: usize = 20;

        for (index, issue) in self.0.iter().take(MAX_SHOWN).enumerate() {
            if index > 0 {
                f.write_str("; ")?;
            }
            write!(f, "{issue}")?;
        }

        if self.0.len() > MAX_SHOWN {
            write!(f, "; ... and {} more", self.0.len() - MAX_SHOWN)?;
        }

        Ok(())
    }
}

impl std::error::Error for SchemaIssues {}

/// Parses and validates a candidate JSON value.
///
/// All questions are inspected so the LLM receives every violation in one
/// feedback round instead of failing one field at a time.
pub fn convert(value: &Value) -> Result<Vec<Question>, SchemaIssues> {
    let Some(items) = value.as_array() else {
        return Err(SchemaIssues(vec![SchemaIssue {
            question: None,
            field: None,
            message: "expected a JSON array of questions".to_owned(),
        }]));
    };

    let mut questions = Vec::with_capacity(items.len());
    let mut issues = Vec::new();

    for (index, item) in items.iter().enumerate() {
        match serde_json::from_value::<Question>(item.clone()) {
            Ok(question) => {
                validate_question(index, &question, &mut issues);
                questions.push(question);
            }
            Err(error) => issues.push(SchemaIssue {
                question: Some(index),
                field: None,
                message: error.to_string(),
            }),
        }
    }

    if issues.is_empty() {
        Ok(questions)
    } else {
        Err(SchemaIssues(issues))
    }
}

#[allow(
    clippy::too_many_lines,
    reason = "one match arm per question type keeps the schema rules in one place"
)]
fn validate_question(index: usize, question: &Question, issues: &mut Vec<SchemaIssue>) {
    match question {
        Question::SingleChoice(question) => {
            check_text(index, "prompt", &question.prompt, issues);
            check_text_list(index, "options", &question.options, 2, Some(6), issues);
            check_index(
                index,
                "correct_answer",
                question.correct_answer,
                question.options.len(),
                issues,
            );
        }
        Question::MultipleChoice(question) => {
            check_text(index, "prompt", &question.prompt, issues);
            check_text_list(index, "options", &question.options, 2, Some(8), issues);
            if question.correct_answer.is_empty() {
                push_issue(
                    index,
                    "correct_answer",
                    "must contain at least one option index",
                    issues,
                );
            }
            check_indices(
                index,
                "correct_answer",
                &question.correct_answer,
                question.options.len(),
                true,
                issues,
            );
        }
        Question::TrueFalse(question) => {
            check_text_list(index, "statements", &question.statements, 1, None, issues);
            if question.correct_answer.len() != question.statements.len() {
                push_issue(
                    index,
                    "correct_answer",
                    format!(
                        "must contain one boolean per statement (expected {}, got {})",
                        question.statements.len(),
                        question.correct_answer.len()
                    ),
                    issues,
                );
            }
        }
        Question::TextInput(question) => {
            check_text(index, "prompt", &question.prompt, issues);
            check_text(index, "correct_answer", &question.correct_answer, issues);
        }
        Question::NumberInput(question) => {
            check_text(index, "prompt", &question.prompt, issues);
            if !question.correct_answer.is_finite() {
                push_issue(index, "correct_answer", "must be a finite number", issues);
            }
        }
        Question::Matching(question) => {
            check_text_list(index, "left", &question.left, 2, Some(8), issues);
            check_text_list(index, "right", &question.right, 2, Some(8), issues);
            if question.right.len() < question.left.len() {
                push_issue(
                    index,
                    "right",
                    format!(
                        "must contain at least as many entries as `left` ({} < {})",
                        question.right.len(),
                        question.left.len()
                    ),
                    issues,
                );
            }
            if question.correct_answer.len() != question.left.len() {
                push_issue(
                    index,
                    "correct_answer",
                    format!(
                        "must contain one right index per left entry (expected {}, got {})",
                        question.left.len(),
                        question.correct_answer.len()
                    ),
                    issues,
                );
            }
            check_indices(
                index,
                "correct_answer",
                &question.correct_answer,
                question.right.len(),
                true,
                issues,
            );
        }
        Question::Grouping(question) => {
            check_text_list(
                index,
                "categories",
                &question.categories,
                2,
                Some(4),
                issues,
            );
            check_text_list(index, "items", &question.items, 2, Some(12), issues);
            if question.correct_answer.len() != question.items.len() {
                push_issue(
                    index,
                    "correct_answer",
                    format!(
                        "must contain one category index per item (expected {}, got {})",
                        question.items.len(),
                        question.correct_answer.len()
                    ),
                    issues,
                );
            }
            check_indices(
                index,
                "correct_answer",
                &question.correct_answer,
                question.categories.len(),
                false,
                issues,
            );
        }
        Question::Coords(question) => {
            check_text(index, "prompt", &question.prompt, issues);
            match Url::parse(&question.image) {
                Ok(_) => {}
                Err(error) => push_issue(
                    index,
                    "image",
                    format!("must be an absolute URI: {error}"),
                    issues,
                ),
            }
            check_percent(index, "correct_answer.x", question.correct_answer.x, issues);
            check_percent(index, "correct_answer.y", question.correct_answer.y, issues);
        }
        Question::Order(question) => {
            check_text(index, "prompt", &question.prompt, issues);
            check_text_list(index, "items", &question.items, 3, Some(8), issues);
            if question.correct_answer.len() != question.items.len() {
                push_issue(
                    index,
                    "correct_answer",
                    format!(
                        "must be a permutation of all item indices (expected {}, got {})",
                        question.items.len(),
                        question.correct_answer.len()
                    ),
                    issues,
                );
            }
            check_indices(
                index,
                "correct_answer",
                &question.correct_answer,
                question.items.len(),
                true,
                issues,
            );
        }
    }
}

fn check_text(question: usize, field: &str, value: &str, issues: &mut Vec<SchemaIssue>) {
    if value.trim().is_empty() {
        push_issue(question, field, "must not be empty", issues);
    }
}

fn check_text_list(
    question: usize,
    field: &str,
    values: &[String],
    minimum: usize,
    maximum: Option<usize>,
    issues: &mut Vec<SchemaIssue>,
) {
    if values.len() < minimum {
        push_issue(
            question,
            field,
            format!("must contain at least {minimum} entries"),
            issues,
        );
    }
    if let Some(maximum) = maximum
        && values.len() > maximum
    {
        push_issue(
            question,
            field,
            format!("must contain at most {maximum} entries"),
            issues,
        );
    }

    for (index, value) in values.iter().enumerate() {
        if value.trim().is_empty() {
            push_issue(
                question,
                format!("{field}[{index}]"),
                "must not be empty",
                issues,
            );
        }
    }
}

fn check_index(
    question: usize,
    field: &str,
    value: u32,
    length: usize,
    issues: &mut Vec<SchemaIssue>,
) {
    if usize::try_from(value).map_or(true, |value| value >= length) {
        push_issue(
            question,
            field,
            format!("index {value} is out of range for {length} entries"),
            issues,
        );
    }
}

fn check_indices(
    question: usize,
    field: &str,
    values: &[u32],
    length: usize,
    unique: bool,
    issues: &mut Vec<SchemaIssue>,
) {
    let mut seen = HashSet::with_capacity(values.len());

    for (position, value) in values.iter().enumerate() {
        check_index(
            question,
            &format!("{field}[{position}]"),
            *value,
            length,
            issues,
        );

        if unique && !seen.insert(*value) {
            push_issue(
                question,
                format!("{field}[{position}]"),
                format!("duplicate index {value}"),
                issues,
            );
        }
    }
}

fn check_percent(question: usize, field: &str, value: f64, issues: &mut Vec<SchemaIssue>) {
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        push_issue(question, field, "must be between 0 and 100", issues);
    }
}

fn push_issue(
    question: usize,
    field: impl Into<String>,
    message: impl Into<String>,
    issues: &mut Vec<SchemaIssue>,
) {
    issues.push(SchemaIssue {
        question: Some(question),
        field: Some(field.into()),
        message: message.into(),
    });
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn convert_one(question: &Value) -> Result<Question, SchemaIssues> {
        convert(&json!([question])).map(|mut questions| questions.remove(0))
    }

    #[test]
    fn parses_every_question_type() {
        let questions = json!([
            {
                "type": "single_choice",
                "prompt": "Pick one",
                "options": ["a", "b"],
                "correct_answer": 1
            },
            {
                "type": "multiple_choice",
                "prompt": "Pick some",
                "options": ["a", "b", "c"],
                "correct_answer": [0, 2]
            },
            {
                "type": "true_false",
                "statements": ["a", "b"],
                "correct_answer": [true, false]
            },
            {
                "type": "text_input",
                "prompt": "Type it",
                "correct_answer": "answer"
            },
            {
                "type": "number_input",
                "prompt": "How many?",
                "unit": null,
                "correct_answer": 42
            },
            {
                "type": "matching",
                "left": ["a", "b"],
                "right": ["b", "a"],
                "correct_answer": [1, 0]
            },
            {
                "type": "grouping",
                "categories": ["a", "b"],
                "items": ["one", "two"],
                "correct_answer": [0, 1]
            },
            {
                "type": "coords",
                "prompt": "Where?",
                "image": "https://example.com/image.png",
                "correct_answer": { "x": 50.0, "y": 25.0 }
            },
            {
                "type": "order",
                "prompt": "Order it",
                "items": ["a", "b", "c"],
                "correct_answer": [2, 0, 1]
            }
        ]);

        let questions = convert(&questions).expect("all example questions are valid");
        assert_eq!(questions.len(), TYPES.len());
    }

    #[test]
    fn rejects_unknown_fields() {
        let error = convert_one(&json!({
            "type": "text_input",
            "prompt": "Type it",
            "correct_answer": "answer",
            "unexpected": true
        }))
        .expect_err("unknown fields must be rejected");

        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn rejects_unknown_question_type() {
        let error = convert_one(&json!({ "type": "essay", "prompt": "Write" }))
            .expect_err("unknown type must be rejected");

        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn requires_number_unit_field() {
        let error = convert_one(&json!({
            "type": "number_input",
            "prompt": "How many?",
            "correct_answer": 42
        }))
        .expect_err("unit is required");

        assert!(error.to_string().contains("missing field `unit`"));
    }

    #[test]
    fn accepts_null_and_string_units() {
        let null = convert_one(&json!({
            "type": "number_input",
            "prompt": "How many?",
            "unit": null,
            "correct_answer": 42
        }))
        .expect("null unit is valid");
        let string = convert_one(&json!({
            "type": "number_input",
            "prompt": "How many?",
            "unit": "kg",
            "correct_answer": 42
        }))
        .expect("string unit is valid");

        assert_eq!(
            null,
            Question::NumberInput(NumberInput {
                prompt: "How many?".to_owned(),
                unit: Nullable::Null,
                correct_answer: 42.0,
            })
        );
        assert_eq!(
            string,
            Question::NumberInput(NumberInput {
                prompt: "How many?".to_owned(),
                unit: Nullable::Value("kg".to_owned()),
                correct_answer: 42.0,
            })
        );
    }

    #[test]
    fn rejects_out_of_range_indices() {
        let error = convert_one(&json!({
            "type": "single_choice",
            "prompt": "Pick one",
            "options": ["a", "b"],
            "correct_answer": 2
        }))
        .expect_err("index must refer to an option");

        assert!(error.to_string().contains("out of range"));
    }

    #[test]
    fn rejects_negative_indices() {
        let error = convert_one(&json!({
            "type": "order",
            "prompt": "Order it",
            "items": ["a", "b", "c"],
            "correct_answer": [-1, 0, 1]
        }))
        .expect_err("negative indices are not u32");

        assert!(error.to_string().contains("invalid value"));
    }

    #[test]
    fn rejects_wrong_true_false_length() {
        let error = convert_one(&json!({
            "type": "true_false",
            "statements": ["a", "b"],
            "correct_answer": [true]
        }))
        .expect_err("one answer per statement");

        assert!(error.to_string().contains("one boolean per statement"));
    }

    #[test]
    fn rejects_incomplete_order_permutation() {
        let duplicate = convert_one(&json!({
            "type": "order",
            "prompt": "Order it",
            "items": ["a", "b", "c"],
            "correct_answer": [0, 0, 1]
        }))
        .expect_err("duplicate index is not a permutation");
        let missing = convert_one(&json!({
            "type": "order",
            "prompt": "Order it",
            "items": ["a", "b", "c"],
            "correct_answer": [0, 1]
        }))
        .expect_err("missing index is not a permutation");

        assert!(duplicate.to_string().contains("duplicate index"));
        assert!(missing.to_string().contains("permutation"));
    }

    #[test]
    fn rejects_duplicate_matching_indices() {
        let error = convert_one(&json!({
            "type": "matching",
            "left": ["a", "b"],
            "right": ["x", "y"],
            "correct_answer": [0, 0]
        }))
        .expect_err("matching targets may be used at most once");

        assert!(error.to_string().contains("duplicate index"));
    }

    #[test]
    fn rejects_grouping_length_mismatch() {
        let error = convert_one(&json!({
            "type": "grouping",
            "categories": ["a", "b"],
            "items": ["one", "two"],
            "correct_answer": [0, 1, 0]
        }))
        .expect_err("one category per item");

        assert!(error.to_string().contains("one category index per item"));
    }

    #[test]
    fn rejects_invalid_coords() {
        let error = convert_one(&json!({
            "type": "coords",
            "prompt": "Where?",
            "image": "not a uri",
            "correct_answer": { "x": 120.0, "y": 50.0 }
        }))
        .expect_err("image and percentages are validated");

        let message = error.to_string();
        assert!(message.contains("absolute URI"));
        assert!(message.contains("between 0 and 100"));
    }

    #[test]
    fn reports_all_issues() {
        let error = convert(&json!([
            {
                "type": "true_false",
                "statements": ["a", "b"],
                "correct_answer": [true]
            },
            {
                "type": "single_choice",
                "prompt": "",
                "options": ["a"],
                "correct_answer": 0
            }
        ]))
        .expect_err("both questions are invalid");

        assert_eq!(error.0.len(), 3);
    }
}
