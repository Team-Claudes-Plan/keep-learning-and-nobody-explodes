//! Evaluates submitted answers against `tasks.solution`.
//!
//! The solution has the same shape as the answer value of its question type
//! (see `AnswerMap` in the frontend), except for `coords`, which is
//! `{ x, y, radius }` in percent of the image size.

use serde::Deserialize;
use serde_json::{Value, json};

use super::protocol::Answer;

const NUMBER_EPSILON: f64 = 1e-6;

#[derive(Deserialize)]
struct CoordsSolution {
    x: f64,
    y: f64,
    radius: f64,
}

/// `question` is the task content (needed for `caseSensitive`).
pub fn judge(
    question: &Value,
    solution: &Value,
    answer: &Answer,
) -> Result<bool, serde_json::Error> {
    if let Answer::Coords(point) = answer {
        let target: CoordsSolution = serde_json::from_value(solution.clone())?;
        return Ok((point.x - target.x).hypot(point.y - target.y) <= target.radius);
    }

    let expected: Answer = serde_json::from_value(json!({
        "type": answer.question_type(),
        "answer": solution,
    }))?;

    Ok(match (answer, expected) {
        (Answer::MultipleChoice(given), Answer::MultipleChoice(expected)) => {
            sorted(given.clone()) == sorted(expected)
        }
        (Answer::TextInput(given), Answer::TextInput(expected)) => {
            let case_sensitive = question
                .get("caseSensitive")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let (given, expected) = (given.trim(), expected.trim());
            if case_sensitive {
                given == expected
            } else {
                given.to_uppercase() == expected.to_uppercase()
            }
        }
        (Answer::NumberInput(given), Answer::NumberInput(expected)) => {
            (given - expected).abs() <= NUMBER_EPSILON * expected.abs().max(1.0)
        }
        (given, expected) => *given == expected,
    })
}

fn sorted(mut values: Vec<u32>) -> Vec<u32> {
    values.sort_unstable();
    values.dedup();
    values
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::protocol::Point;

    fn check(question: &Value, solution: &Value, answer: &Answer) -> bool {
        judge(question, solution, answer).expect("valid solution")
    }

    #[test]
    fn single_choice() {
        assert!(check(&json!({}), &json!(1), &Answer::SingleChoice(1)));
        assert!(!check(&json!({}), &json!(1), &Answer::SingleChoice(2)));
    }

    #[test]
    fn multiple_choice_ignores_order() {
        let solution = json!([0, 2, 4]);
        assert!(check(
            &json!({}),
            &solution,
            &Answer::MultipleChoice(vec![4, 0, 2])
        ));
        assert!(!check(
            &json!({}),
            &solution,
            &Answer::MultipleChoice(vec![0, 2])
        ));
    }

    #[test]
    fn true_false() {
        let solution = json!([true, false, true]);
        assert!(check(
            &json!({}),
            &solution,
            &Answer::TrueFalse(vec![true, false, true])
        ));
        assert!(!check(
            &json!({}),
            &solution,
            &Answer::TrueFalse(vec![true, true, true])
        ));
    }

    #[test]
    fn text_input_case() {
        let solution = json!("Paris");
        let answer = Answer::TextInput(" PARIS ".to_owned());
        assert!(check(&json!({}), &solution, &answer));
        assert!(!check(
            &json!({ "caseSensitive": true }),
            &solution,
            &answer
        ));
        assert!(check(
            &json!({ "caseSensitive": true }),
            &solution,
            &Answer::TextInput("Paris".to_owned())
        ));
    }

    #[test]
    fn number_input() {
        assert!(check(
            &json!({}),
            &json!(1440),
            &Answer::NumberInput(1440.0)
        ));
        assert!(!check(
            &json!({}),
            &json!(1440),
            &Answer::NumberInput(1441.0)
        ));
    }

    #[test]
    fn index_lists_keep_order() {
        let solution = json!([1, 2, 0]);
        assert!(check(
            &json!({}),
            &solution,
            &Answer::Matching(vec![1, 2, 0])
        ));
        assert!(check(&json!({}), &solution, &Answer::Order(vec![1, 2, 0])));
        assert!(check(
            &json!({}),
            &solution,
            &Answer::Grouping(vec![1, 2, 0])
        ));
        assert!(!check(&json!({}), &solution, &Answer::Order(vec![0, 1, 2])));
    }

    #[test]
    fn coords_within_radius() {
        let solution = json!({ "x": 50, "y": 50, "radius": 5 });
        assert!(check(
            &json!({}),
            &solution,
            &Answer::Coords(Point { x: 53.0, y: 54.0 })
        ));
        assert!(!check(
            &json!({}),
            &solution,
            &Answer::Coords(Point { x: 56.0, y: 50.0 })
        ));
    }

    #[test]
    fn malformed_solution_is_an_error() {
        judge(&json!({}), &json!("x"), &Answer::SingleChoice(0)).unwrap_err();
    }
}
