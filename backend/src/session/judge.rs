//! Evaluates submitted answers against `tasks.solution`.
//!
//! Solutions may be stored raw or wrapped as `{"correct_answer": ...}`. The
//! answer value has the same shape as the submitted answer, except for
//! `coords`, which is `{ x, y, radius }` in percent of the image size. Older
//! coordinates without a radius use a default tolerance.

use serde::Deserialize;
use serde_json::{Value, json};

use super::{protocol::Answer, task};

const NUMBER_EPSILON: f64 = 1e-6;
const DEFAULT_COORDS_RADIUS: f64 = 5.0;

#[derive(Deserialize)]
struct CoordsSolution {
    x: f64,
    y: f64,
    #[serde(default)]
    radius: Option<f64>,
    #[serde(default)]
    tolerance_radius: Option<f64>,
}

impl CoordsSolution {
    fn radius(&self) -> f64 {
        self.radius
            .or(self.tolerance_radius)
            .unwrap_or(DEFAULT_COORDS_RADIUS)
    }
}

/// `question` is the task content (needed for `caseSensitive`).
pub fn judge(
    question: &Value,
    solution: &Value,
    answer: &Answer,
) -> Result<bool, serde_json::Error> {
    if let Answer::Coords(point) = answer {
        let inner = task::answer_value(solution);
        let mut target: CoordsSolution = serde_json::from_value(inner.clone())?;

        if target.radius.is_none() && target.tolerance_radius.is_none() {
            target.radius = solution
                .get("radius")
                .or_else(|| solution.get("tolerance_radius"))
                .and_then(Value::as_f64);
        }

        return Ok((point.x - target.x).hypot(point.y - target.y) <= target.radius());
    }

    let solution = task::answer_value(solution);
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
    fn wrapped_solutions_are_unwrapped() {
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": 1 }),
            &Answer::SingleChoice(1)
        ));
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": [0, 2] }),
            &Answer::MultipleChoice(vec![0, 2])
        ));
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": [true, false] }),
            &Answer::TrueFalse(vec![true, false])
        ));
        assert!(check(
            &json!({ "caseSensitive": true }),
            &json!({ "correct_answer": "Paris" }),
            &Answer::TextInput("Paris".to_owned())
        ));
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": 1440 }),
            &Answer::NumberInput(1440.0)
        ));
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": [1, 0] }),
            &Answer::Matching(vec![1, 0])
        ));
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": [0, 1] }),
            &Answer::Grouping(vec![0, 1])
        ));
        assert!(check(
            &json!({}),
            &json!({ "correct_answer": [2, 0, 1] }),
            &Answer::Order(vec![2, 0, 1])
        ));
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
    fn coords_without_radius_use_the_default_tolerance() {
        let raw = json!({ "x": 50, "y": 50 });
        let wrapped = json!({ "correct_answer": { "x": 50, "y": 50 } });

        assert!(check(
            &json!({}),
            &raw,
            &Answer::Coords(Point { x: 52.0, y: 53.0 })
        ));
        assert!(check(
            &json!({}),
            &wrapped,
            &Answer::Coords(Point { x: 52.0, y: 53.0 })
        ));
        assert!(!check(
            &json!({}),
            &wrapped,
            &Answer::Coords(Point { x: 56.0, y: 50.0 })
        ));
    }

    #[test]
    fn coords_accept_tolerance_alias_and_outer_radius() {
        let alias = json!({ "x": 50, "y": 50, "tolerance_radius": 2 });
        let outer = json!({
            "correct_answer": { "x": 50, "y": 50 },
            "radius": 2
        });

        assert!(!check(
            &json!({}),
            &alias,
            &Answer::Coords(Point { x: 53.0, y: 50.0 })
        ));
        assert!(!check(
            &json!({}),
            &outer,
            &Answer::Coords(Point { x: 53.0, y: 50.0 })
        ));
    }

    #[test]
    fn malformed_solution_is_an_error() {
        judge(&json!({}), &json!("x"), &Answer::SingleChoice(0)).unwrap_err();
    }
}
