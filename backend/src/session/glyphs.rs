//! Symbols that stand in for answers on the bomb. The defuser only sees the
//! symbol, the expert's briefing says what it stands for, so the two have to
//! describe the shapes to each other.
//!
//! The server hands them out when a game is created, so both players see the
//! same bomb and no symbol appears twice in one game. The drawings live in the
//! frontend (`frontend/src/game/glyphs.ts`); the server only deals in indices.

use serde_json::Value;
use uuid::Uuid;

/// Number of drawings in `frontend/src/game/glyphs.ts`. Keep both in sync.
pub const GLYPH_COUNT: u8 = 21;

/// The list of a question that the defuser sees as symbols instead of text,
/// or `None` for question types without symbols.
#[must_use]
pub fn symbol_field(question_type: &str) -> Option<&'static str> {
    match question_type {
        "single_choice" | "multiple_choice" => Some("options"),
        "order" | "grouping" => Some("items"),
        "matching" => Some("right"),
        _ => None,
    }
}

/// What each symbol of a question stands for, in list order. Empty for
/// question types without symbols.
#[must_use]
pub fn symbol_texts(question_type: &str, content: &Value) -> Vec<Value> {
    symbol_field(question_type)
        .and_then(|field| content.get(field))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Deals symbols to the parts of one game: `demands` is how many a part needs.
///
/// A symbol is used at most once per game. A part gets all its symbols or
/// none; when the pool runs out, the remaining parts that do not fit are
/// shown as plain text. `random(n)` returns a number below `n`.
#[must_use]
pub fn assign(demands: &[usize], mut random: impl FnMut(usize) -> usize) -> Vec<Vec<u8>> {
    let mut pool: Vec<u8> = (0..GLYPH_COUNT).collect();
    for i in (1..pool.len()).rev() {
        pool.swap(i, random(i + 1));
    }
    let mut pool = pool.into_iter();
    demands
        .iter()
        .map(|&demand| {
            if demand > pool.len() {
                return Vec::new();
            }
            pool.by_ref().take(demand).collect()
        })
        .collect()
}

/// A uniformly distributed number below `bound`, from a fresh UUID.
#[must_use]
pub fn random_below(bound: usize) -> usize {
    let bound = u128::try_from(bound).unwrap_or(u128::MAX).max(1);
    usize::try_from(Uuid::new_v4().as_u128() % bound).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::*;

    fn counter() -> impl FnMut(usize) -> usize {
        let mut next = 0;
        move |bound| {
            next += 7;
            next % bound
        }
    }

    #[test]
    fn symbols_per_question_type() {
        let content = json!({ "options": ["a", "b"], "right": ["x", "y", "z"], "items": ["i"] });
        assert_eq!(
            symbol_texts("single_choice", &content),
            [json!("a"), json!("b")]
        );
        assert_eq!(symbol_texts("multiple_choice", &content).len(), 2);
        assert_eq!(symbol_texts("matching", &content).len(), 3);
        assert_eq!(symbol_texts("order", &content).len(), 1);
        assert_eq!(symbol_texts("grouping", &content).len(), 1);
        assert_eq!(symbol_texts("true_false", &content), Vec::<Value>::new());
        assert_eq!(symbol_texts("number_input", &content), Vec::<Value>::new());
        assert_eq!(
            symbol_texts("single_choice", &json!({})),
            Vec::<Value>::new()
        );
    }

    #[test]
    fn no_symbol_twice_in_a_game() {
        let parts = assign(&[4, 0, 6, 3, 5], counter());
        assert_eq!(
            parts.iter().map(Vec::len).collect::<Vec<_>>(),
            [4, 0, 6, 3, 5]
        );
        let all: Vec<u8> = parts.concat();
        let unique: HashSet<u8> = all.iter().copied().collect();
        assert_eq!(all.len(), unique.len());
        assert!(all.iter().all(|&glyph| glyph < GLYPH_COUNT));
    }

    #[test]
    fn a_game_can_use_every_symbol() {
        let demand = usize::from(GLYPH_COUNT);
        let parts = assign(&[demand], counter());
        let unique: HashSet<u8> = parts.concat().into_iter().collect();
        assert_eq!(unique.len(), demand);
    }

    #[test]
    fn parts_that_do_not_fit_fall_back_to_text() {
        // 8 + 8 leaves 5 symbols: the 6 does not fit, the later 5 still does
        let parts = assign(&[8, 8, 6, 5], counter());
        assert_eq!(parts.iter().map(Vec::len).collect::<Vec<_>>(), [8, 8, 0, 5]);
        let all: Vec<u8> = parts.concat();
        let unique: HashSet<u8> = all.iter().copied().collect();
        assert_eq!(all.len(), unique.len());
    }

    #[test]
    fn dealing_is_random() {
        let a = assign(&[10], random_below_from(1));
        let b = assign(&[10], random_below_from(2));
        assert_ne!(a, b);
    }

    fn random_below_from(seed: usize) -> impl FnMut(usize) -> usize {
        let mut state = seed;
        move |bound| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1);
            (state >> 33) % bound
        }
    }

    #[test]
    fn random_below_stays_in_range() {
        assert!((0..100).all(|_| random_below(5) < 5));
        assert_eq!(random_below(1), 0);
    }
}
