//! What each role gets to see of a bomb: the defuser's modules and the
//! expert's manual. Neither can solve a module alone.
//!
//! Per question type:
//!
//! - `single_choice`, `multiple_choice`, `order`: the question on the bomb,
//!   the answers as symbols; the manual says which symbol stands for what.
//! - `matching`: the left side in plain text on the bomb, the right side as
//!   symbols the manual decodes.
//! - `grouping`: the groups in plain text on the bomb, the things to sort as
//!   symbols the manual decodes.
//! - `true_false`: the bomb only shows "Aussage 1, 2, …", the manual lists
//!   the statements behind them, in that order.
//! - `number_input`: the bomb only shows the unit, the question is in the
//!   manual.
//! - `text_input`: the terminal only shows who is logged in; the manual says
//!   which question belongs to that user.
//! - `coords`: just the controls on the bomb, the question is in the manual.
//!
//! When a game ran out of symbols, a choice part keeps its answers in plain
//! text and its question moves to the manual instead.
//!
//! Everything here is derived from the game id, so every briefing of a game
//! (and every reconnect) shows the same bomb and the same manual.

use serde_json::{Map, Value};
use uuid::Uuid;

use super::{
    glyphs,
    protocol::{DefuserPart, ManualPage, PartInfo, Symbol},
    task,
};
use crate::db::PartDetails;

/// Login names on the free-text terminals, with a number appended.
const USER_NAMES: [&str; 12] = [
    "falke", "otter", "luchs", "kranich", "dachs", "marder", "uhu", "wiesel", "biber", "reiher",
    "fuchs", "specht",
];

/// The defuser's modules, in part order.
#[must_use]
pub fn defuser(game: Uuid, parts: &[PartInfo], details: &[PartDetails]) -> Vec<DefuserPart> {
    let users = terminal_users(game, details);
    parts
        .iter()
        .zip(details)
        .zip(users)
        .map(|((info, part), user)| defuser_part(info, part, user))
        .collect()
}

/// The expert's manual pages, shuffled, symbols shuffled per page.
#[must_use]
pub fn manual(game: Uuid, parts: &[PartInfo], details: &[PartDetails]) -> Vec<ManualPage> {
    let users = terminal_users(game, details);
    let mut random = Random::new(game, 1);
    let mut pages: Vec<ManualPage> = parts
        .iter()
        .zip(details)
        .zip(users)
        .map(|((info, part), user)| {
            let mut page = manual_page(info, part, user);
            random.shuffle(&mut page.symbols);
            page
        })
        .collect();
    random.shuffle(&mut pages);
    pages
}

/// Shows the question on the bomb (`single_choice`, `multiple_choice`,
/// `order`), as long as the answers are symbols.
fn prompt_on_bomb(question_type: &str) -> bool {
    matches!(question_type, "single_choice" | "multiple_choice" | "order")
}

fn has_symbols(info: &PartInfo, part: &PartDetails) -> bool {
    !info.glyphs.is_empty() && glyphs::symbol_field(&part.question_type).is_some()
}

fn defuser_part(info: &PartInfo, part: &PartDetails, user: Option<String>) -> DefuserPart {
    let mut content = task::content_object(&part.content);
    let symbols = has_symbols(info, part);
    if symbols && let Some(field) = glyphs::symbol_field(&part.question_type) {
        content.remove(field);
    }
    let prompt = prompt_of(part, &content);
    content.remove("prompt");
    if symbols
        && prompt_on_bomb(&part.question_type)
        && let Some(prompt) = prompt
    {
        content.insert("prompt".to_owned(), prompt);
    }
    if part.question_type == "true_false" {
        let count = statements_of(part, &content).len();
        content.remove("statements");
        content.insert("statementCount".to_owned(), count.into());
    }
    if let Some(user) = user {
        content.insert("user".to_owned(), user.into());
    }
    content.insert("id".to_owned(), info.task_id.to_string().into());
    content.insert("type".to_owned(), part.question_type.clone().into());
    DefuserPart {
        position: info.position,
        task: Value::Object(content),
        glyphs: if symbols {
            info.glyphs.clone()
        } else {
            Vec::new()
        },
    }
}

fn manual_page(info: &PartInfo, part: &PartDetails, user: Option<String>) -> ManualPage {
    let content = task::content_object(&part.content);
    if has_symbols(info, part) {
        return ManualPage {
            symbols: info
                .glyphs
                .iter()
                .zip(glyphs::symbol_texts(
                    &part.question_type,
                    &content.clone().into(),
                ))
                .map(|(&glyph, text)| Symbol { glyph, text })
                .collect(),
            ..ManualPage::default()
        };
    }
    if part.question_type == "true_false" {
        return ManualPage {
            statements: statements_of(part, &content),
            ..ManualPage::default()
        };
    }
    ManualPage {
        prompt: prompt_of(part, &content),
        user,
        ..ManualPage::default()
    }
}

/// The question: in the content, or (`text_input`, `number_input`, `coords`)
/// in the instruction.
fn prompt_of(part: &PartDetails, content: &Map<String, Value>) -> Option<Value> {
    content.get("prompt").cloned().or_else(|| {
        task::instruction_object(&part.instruction)
            .get("prompt")
            .cloned()
    })
}

fn statements_of(part: &PartDetails, content: &Map<String, Value>) -> Vec<Value> {
    content
        .get("statements")
        .cloned()
        .or_else(|| {
            task::instruction_object(&part.instruction)
                .get("statements")
                .cloned()
        })
        .and_then(|statements| statements.as_array().cloned())
        .unwrap_or_default()
}

/// A login name per `text_input` part, all different within a game.
fn terminal_users(game: Uuid, details: &[PartDetails]) -> Vec<Option<String>> {
    let mut random = Random::new(game, 2);
    let mut taken: Vec<String> = Vec::new();
    details
        .iter()
        .map(|part| {
            if part.question_type != "text_input" {
                return None;
            }
            let name = USER_NAMES[random.below(USER_NAMES.len())];
            let mut user = format!("{name}_{}", 10 + random.below(90));
            let base = user.clone();
            for n in 2.. {
                if !taken.contains(&user) {
                    break;
                }
                user = format!("{base}{n}");
            }
            taken.push(user.clone());
            Some(user)
        })
        .collect()
}

/// Deterministic random numbers (splitmix64) from a game id, one stream per
/// `stream`.
struct Random(u64);

impl Random {
    fn new(game: Uuid, stream: u64) -> Self {
        let (high, low) = game.as_u64_pair();
        Self(high ^ low.rotate_left(17) ^ stream.wrapping_mul(0x9E37_79B9_7F4A_7C15))
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A number below `bound` (at least 1).
    fn below(&mut self, bound: usize) -> usize {
        let bound = u64::try_from(bound.max(1)).unwrap_or(u64::MAX);
        usize::try_from(self.next() % bound).unwrap_or_default()
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            items.swap(i, self.below(i + 1));
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use serde_json::json;

    use super::*;

    const GAME: Uuid = Uuid::from_u128(0xABCD_1234);

    fn part(question_type: &str, content: Value, instruction: Value) -> PartDetails {
        PartDetails {
            question_type: question_type.to_owned(),
            content,
            instruction,
            solution: json!(0),
        }
    }

    fn info(position: u32, question_type: &str, glyphs: Vec<u8>) -> PartInfo {
        PartInfo {
            position,
            task_id: Uuid::from_u128(u128::from(position) + 100),
            question_type: question_type.to_owned(),
            glyphs,
        }
    }

    /// The defuser's module and the manual page of a single part.
    fn split(info: &PartInfo, part: &PartDetails) -> (Value, Vec<u8>, ManualPage) {
        let parts = std::slice::from_ref(info);
        let details = std::slice::from_ref(part);
        let module = defuser(GAME, parts, details).remove(0);
        let page = manual(GAME, parts, details).remove(0);
        (module.task, module.glyphs, page)
    }

    #[test]
    fn choice_questions_on_the_bomb_answers_as_symbols() {
        for question_type in ["single_choice", "multiple_choice"] {
            let part = part(
                question_type,
                json!({ "prompt": "2 + 2?", "options": ["3", "4"] }),
                json!({ "options": ["3", "4"] }),
            );
            let (task, glyphs, page) = split(&info(0, question_type, vec![5, 9]), &part);
            assert_eq!(task["prompt"], "2 + 2?");
            assert!(task.get("options").is_none());
            assert_eq!(glyphs, [5, 9]);
            assert_eq!(page.prompt, None);
            let mut symbols = page.symbols.clone();
            symbols.sort_by_key(|s| s.glyph);
            assert_eq!(
                symbols,
                [
                    Symbol {
                        glyph: 5,
                        text: json!("3")
                    },
                    Symbol {
                        glyph: 9,
                        text: json!("4")
                    }
                ]
            );
        }
    }

    #[test]
    fn order_shows_the_question_and_symbols() {
        let part = part(
            "order",
            json!({ "prompt": "Sortiere", "items": ["a", "b", "c"] }),
            json!({ "items": ["a", "b", "c"] }),
        );
        let (task, glyphs, page) = split(&info(0, "order", vec![1, 2, 3]), &part);
        assert_eq!(task["prompt"], "Sortiere");
        assert!(task.get("items").is_none());
        assert_eq!(glyphs, [1, 2, 3]);
        assert_eq!(page.symbols.len(), 3);
        assert_eq!(page.prompt, None);
    }

    #[test]
    fn matching_keeps_the_left_side_and_hides_the_question() {
        let part = part(
            "matching",
            json!({ "prompt": "Ordne", "left": ["x", "y"], "right": ["1", "2"] }),
            json!({ "left": ["x", "y"], "right": ["1", "2"] }),
        );
        let (task, glyphs, page) = split(&info(0, "matching", vec![3, 4]), &part);
        assert_eq!(task["left"], json!(["x", "y"]));
        assert!(task.get("right").is_none());
        assert!(task.get("prompt").is_none());
        assert_eq!(glyphs, [3, 4]);
        assert_eq!(page.symbols.len(), 2);
        assert_eq!(page.prompt, None);
    }

    #[test]
    fn grouping_keeps_the_groups_and_hides_the_items() {
        let part = part(
            "grouping",
            json!({ "prompt": "Sortiere", "categories": ["A", "B"], "items": ["a", "b", "c"] }),
            json!({ "categories": ["A", "B"], "items": ["a", "b", "c"] }),
        );
        let (task, glyphs, page) = split(&info(0, "grouping", vec![7, 8, 9]), &part);
        assert_eq!(task["categories"], json!(["A", "B"]));
        assert!(task.get("items").is_none());
        assert!(task.get("prompt").is_none());
        assert_eq!(glyphs, [7, 8, 9]);
        assert_eq!(page.symbols.len(), 3);
    }

    #[test]
    fn true_false_statements_only_in_the_manual_in_order() {
        let part = part(
            "true_false",
            json!({ "statements": ["A", "B", "C"] }),
            json!({ "statements": ["A", "B", "C"] }),
        );
        let (task, glyphs, page) = split(&info(0, "true_false", Vec::new()), &part);
        assert!(task.get("statements").is_none());
        assert_eq!(task["statementCount"], 3);
        assert_eq!(glyphs, Vec::<u8>::new());
        assert_eq!(page.statements, [json!("A"), json!("B"), json!("C")]);
        assert_eq!(page.prompt, None);
    }

    #[test]
    fn number_and_coords_questions_only_in_the_manual() {
        let number = part(
            "number_input",
            json!({ "unit": "kg" }),
            json!({ "prompt": "Wie schwer?" }),
        );
        let (task, _, page) = split(&info(0, "number_input", Vec::new()), &number);
        assert_eq!(task["unit"], "kg");
        assert!(task.get("prompt").is_none());
        assert_eq!(page.prompt, Some(json!("Wie schwer?")));

        let coords = part(
            "coords",
            json!({ "image": "map.png", "prompt": "Wo?" }),
            json!({}),
        );
        let (task, _, page) = split(&info(0, "coords", Vec::new()), &coords);
        assert_eq!(task["image"], "map.png");
        assert!(task.get("prompt").is_none());
        assert_eq!(page.prompt, Some(json!("Wo?")));
    }

    #[test]
    fn terminals_show_a_user_the_manual_explains() {
        let text = part(
            "text_input",
            json!({ "caseSensitive": false }),
            json!({ "prompt": "Hauptstadt?" }),
        );
        let (task, _, page) = split(&info(0, "text_input", Vec::new()), &text);
        let user = task["user"].as_str().expect("user").to_owned();
        assert!(task.get("prompt").is_none());
        assert_eq!(page.user, Some(user));
        assert_eq!(page.prompt, Some(json!("Hauptstadt?")));
    }

    #[test]
    fn terminal_users_differ_within_a_game() {
        let details: Vec<PartDetails> = (0..30)
            .map(|_| part("text_input", json!({}), json!({ "prompt": "?" })))
            .collect();
        let users: Vec<String> = terminal_users(GAME, &details)
            .into_iter()
            .map(|user| user.expect("user"))
            .collect();
        assert_eq!(users.iter().collect::<HashSet<_>>().len(), users.len());
    }

    #[test]
    fn choice_without_symbols_moves_the_question_to_the_manual() {
        let part = part(
            "single_choice",
            json!({ "prompt": "2 + 2?", "options": ["3", "4"] }),
            json!({}),
        );
        let (task, glyphs, page) = split(&info(0, "single_choice", Vec::new()), &part);
        assert_eq!(task["options"], json!(["3", "4"]));
        assert!(task.get("prompt").is_none());
        assert_eq!(glyphs, Vec::<u8>::new());
        assert_eq!(page.prompt, Some(json!("2 + 2?")));
        assert_eq!(page.symbols, Vec::<Symbol>::new());
    }

    #[test]
    fn pages_never_say_which_module_they_are_for() {
        let page = serde_json::to_value(ManualPage {
            prompt: Some(json!("?")),
            ..ManualPage::default()
        })
        .expect("serialize");
        assert_eq!(page, json!({ "prompt": "?" }));
    }

    #[test]
    fn the_same_game_always_gets_the_same_manual() {
        let parts: Vec<PartInfo> = (0..6)
            .map(|position| {
                let glyph = u8::try_from(position * 3).expect("small");
                info(position, "single_choice", vec![glyph, glyph + 1, glyph + 2])
            })
            .collect();
        let details: Vec<PartDetails> = (0..6)
            .map(|i| {
                part(
                    "single_choice",
                    json!({ "prompt": format!("Frage {i}"), "options": ["a", "b", "c"] }),
                    json!({}),
                )
            })
            .collect();
        assert_eq!(
            manual(GAME, &parts, &details),
            manual(GAME, &parts, &details)
        );
        let in_order: Vec<u8> = parts.iter().map(|p| p.glyphs[0]).collect();
        let pages: Vec<u8> = manual(GAME, &parts, &details)
            .iter()
            .map(|page| page.symbols.iter().map(|s| s.glyph).min().expect("symbols"))
            .collect();
        let mut sorted = pages.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, in_order);
    }
}
