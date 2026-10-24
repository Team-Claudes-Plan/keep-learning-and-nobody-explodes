//! Static test data; to be replaced by a real data source.

use super::model::{Level, Question, Topic};

const TOPICS: [(&str, &str); 2] = [("math", "Mathematik"), ("geography", "Geographie")];

const LEVELS: [&str; 3] = ["Anfänger", "Fortgeschritten", "Experte"];

pub fn topics() -> Vec<Topic> {
    TOPICS
        .iter()
        .map(|&(id, name)| Topic {
            id: id.into(),
            name: name.into(),
        })
        .collect()
}

/// Returns the levels of a topic, or `None` if the topic does not exist.
pub fn levels(topic_id: &str) -> Option<Vec<Level>> {
    TOPICS.iter().any(|&(id, _)| id == topic_id).then(|| {
        (0..)
            .zip(LEVELS)
            .map(|(id, name)| Level {
                id,
                name: name.into(),
            })
            .collect()
    })
}

/// Returns the questions of a level, or `None` if the topic or level does not exist.
pub fn questions(topic_id: &str, level_id: u32) -> Option<Vec<Question>> {
    levels(topic_id)?.iter().any(|l| l.id == level_id).then(|| {
        let id = |n: u32| format!("{topic_id}-{level_id}-{n}");
        let list = |items: &[&str]| items.iter().map(|&s| s.to_owned()).collect::<Vec<_>>();

        match level_id {
            0 => vec![
                Question::SingleChoice {
                    id: id(1),
                    prompt: "What is the correct answer?".into(),
                    options: list(&["This one", "No, this one", "Nope, its this", "... or this"]),
                },
                Question::TrueFalse {
                    id: id(2),
                    statements: list(&[
                        "This sentence is false.",
                        "Trees are humans.",
                        "Water is blue.",
                    ]),
                },
                Question::TextInput {
                    id: id(3),
                    prompt: "What is my last name?".into(),
                },
            ],
            1 => vec![
                Question::MultipleChoice {
                    id: id(1),
                    prompt: "What are the correct answers?".into(),
                    options: list(&["This one", "No, this one", "Also, its this", "... and this"]),
                },
                Question::NumberInput {
                    id: id(2),
                    prompt: "2+2".into(),
                    unit: None,
                },
                Question::Order {
                    id: id(3),
                    prompt: "Order these items".into(),
                    items: list(&["Ding 1", "Ding 2", "Ding 3"]),
                },
            ],
            _ => vec![
                Question::Matching {
                    id: id(1),
                    left: list(&["Begriff 1", "Begriff 2", "Begriff 3"]),
                    right: list(&["Definition 1", "Definition 2", "Definition 3"]),
                },
                Question::Grouping {
                    id: id(2),
                    categories: list(&["Gruppe 1", "Gruppe 2"]),
                    items: list(&["Ding 1", "Ding 2", "Ding 3", "Ding 4", "Ding 5"]),
                },
                Question::Coords {
                    id: id(3),
                    prompt: "Wo ist X?".into(),
                    image: "https://server/image.png".into(),
                },
            ],
        }
    })
}
