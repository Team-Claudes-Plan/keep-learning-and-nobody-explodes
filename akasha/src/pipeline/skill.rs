//! Skills are the storeys of a topic: the classification level between topic
//! and task. The extraction keeps deciding the topics; this module only groups
//! every question of a topic into one of its skills.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::schema::{Question, SchemaIssue, SchemaIssues, TopicQuestions};

/// Longest accepted skill name, in characters.
pub const MAX_SKILL_CHARS: usize = 60;

/// One topic as it already exists on the island, with its skills.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExistingTopic {
    pub topic: String,
    pub skills: Vec<String>,
}

/// The questions the classification filed under one skill.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillQuestions {
    pub skill: String,
    pub questions: Vec<Question>,
}

/// One topic with its questions grouped by skill.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TopicSkills {
    pub topic: String,
    pub skills: Vec<SkillQuestions>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Assignment {
    topic: usize,
    question: usize,
    skill: String,
}

/// Parses the LLM's skill assignments and groups the validated questions.
///
/// `existing` contains the island's current skills per topic. A proposed name
/// that only differs in case from an existing skill reuses the existing
/// spelling; every other valid name becomes a new skill.
pub fn classify(
    value: &Value,
    topics: &[TopicQuestions],
    existing: &[ExistingTopic],
) -> Result<Vec<TopicSkills>, SchemaIssues> {
    let Some(assignments) = value.as_array() else {
        return Err(SchemaIssues(vec![issue(
            None,
            None,
            None,
            "expected a JSON array of skill assignments",
        )]));
    };

    let assigned = parse_assignments(assignments, topics)?;

    Ok(build_skills(topics, &assigned, existing))
}

#[allow(
    clippy::too_many_lines,
    reason = "every assignment rule is collected in one feedback round"
)]
fn parse_assignments(
    assignments: &[Value],
    topics: &[TopicQuestions],
) -> Result<Vec<Vec<Option<Assigned>>>, SchemaIssues> {
    let mut assigned: Vec<Vec<Option<Assigned>>> = topics
        .iter()
        .map(|topic| vec![None; topic.questions.len()])
        .collect();
    let mut issues = Vec::new();

    for (index, assignment) in assignments.iter().enumerate() {
        let assignment = match serde_json::from_value::<Assignment>(assignment.clone()) {
            Ok(assignment) => assignment,
            Err(error) => {
                issues.push(issue(
                    None,
                    None,
                    Some(format!("assignments[{index}]")),
                    error.to_string(),
                ));
                continue;
            }
        };

        let Some(topic) = topics.get(assignment.topic) else {
            issues.push(issue(
                Some(assignment.topic),
                None,
                Some(format!("assignments[{index}].topic")),
                format!("topic index {} is out of range", assignment.topic),
            ));
            continue;
        };
        if assignment.question >= topic.questions.len() {
            issues.push(issue(
                Some(assignment.topic),
                Some(assignment.question),
                Some(format!("assignments[{index}].question")),
                format!(
                    "question index {} is out of range for {} questions",
                    assignment.question,
                    topic.questions.len()
                ),
            ));
            continue;
        }

        let skill = assignment.skill.trim();
        if skill.is_empty() {
            issues.push(issue(
                Some(assignment.topic),
                Some(assignment.question),
                Some("skill".to_owned()),
                "must not be empty",
            ));
            continue;
        }
        if skill.chars().count() > MAX_SKILL_CHARS {
            issues.push(issue(
                Some(assignment.topic),
                Some(assignment.question),
                Some("skill".to_owned()),
                format!("must be at most {MAX_SKILL_CHARS} characters"),
            ));
            continue;
        }

        let slot = &mut assigned[assignment.topic][assignment.question];
        if slot.is_some() {
            issues.push(issue(
                Some(assignment.topic),
                Some(assignment.question),
                Some("skill".to_owned()),
                "question is assigned more than once",
            ));
            continue;
        }
        *slot = Some(Assigned {
            skill: skill.to_owned(),
            rank: index,
        });
    }

    for (topic_index, assigned_topic) in assigned.iter().enumerate() {
        for (question, assigned_skill) in assigned_topic.iter().enumerate() {
            if assigned_skill.is_none() {
                issues.push(issue(
                    Some(topic_index),
                    Some(question),
                    Some("skill".to_owned()),
                    "no skill assigned",
                ));
            }
        }
    }

    if issues.is_empty() {
        Ok(assigned)
    } else {
        Err(SchemaIssues(issues))
    }
}

/// A question's skill and where the LLM first named it in its answer.
#[derive(Clone)]
struct Assigned {
    skill: String,
    rank: usize,
}

/// Groups the questions by skill in skill tree order: existing skills keep
/// their order, new ones follow in the order the LLM first named them, which
/// the prompt asks to be from foundational to advanced. Stored in this order,
/// new skills become the next storeys of their house.
fn build_skills(
    topics: &[TopicQuestions],
    assigned: &[Vec<Option<Assigned>>],
    existing: &[ExistingTopic],
) -> Vec<TopicSkills> {
    topics
        .iter()
        .enumerate()
        .map(|(topic_index, topic)| {
            let existing = existing_skill_names(existing, &topic.topic);
            let mut skills: Vec<(usize, SkillQuestions)> = Vec::new();

            for (question_index, question) in topic.questions.iter().enumerate() {
                let proposed = assigned[topic_index][question_index]
                    .as_ref()
                    .expect("every question was assigned");
                let skill = canonical_skill(existing, &proposed.skill);
                let order = existing
                    .iter()
                    .position(|name| name.to_lowercase() == skill.to_lowercase())
                    .unwrap_or(existing.len() + proposed.rank);

                match skills
                    .iter_mut()
                    .find(|(_, group)| group.skill.to_lowercase() == skill.to_lowercase())
                {
                    Some((group_order, group)) => {
                        *group_order = (*group_order).min(order);
                        group.questions.push(question.clone());
                    }
                    None => skills.push((
                        order,
                        SkillQuestions {
                            skill,
                            questions: vec![question.clone()],
                        },
                    )),
                }
            }
            skills.sort_by_key(|(order, _)| *order);
            let skills = skills.into_iter().map(|(_, group)| group).collect();

            TopicSkills {
                topic: topic.topic.clone(),
                skills,
            }
        })
        .collect()
}

fn existing_skill_names<'a>(existing: &'a [ExistingTopic], topic: &str) -> &'a [String] {
    existing
        .iter()
        .find(|entry| entry.topic.to_lowercase() == topic.to_lowercase())
        .map_or(&[], |entry| entry.skills.as_slice())
}

fn canonical_skill(existing: &[String], proposed: &str) -> String {
    existing
        .iter()
        .find(|skill| skill.to_lowercase() == proposed.to_lowercase())
        .cloned()
        .unwrap_or_else(|| proposed.to_owned())
}

fn issue(
    topic: Option<usize>,
    question: Option<usize>,
    field: Option<String>,
    message: impl Into<String>,
) -> SchemaIssue {
    SchemaIssue {
        topic,
        question,
        field,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn questions(count: usize) -> Vec<Question> {
        (0..count)
            .map(|index| {
                serde_json::from_value(json!({
                    "type": "text_input",
                    "prompt": format!("Frage {index}"),
                    "correct_answer": "x"
                }))
                .expect("valid question")
            })
            .collect()
    }

    fn topics() -> Vec<TopicQuestions> {
        vec![
            TopicQuestions {
                topic: "Mathe".to_owned(),
                questions: questions(3),
            },
            TopicQuestions {
                topic: "Physik".to_owned(),
                questions: questions(1),
            },
        ]
    }

    #[test]
    fn groups_questions_of_multiple_topics_by_skill() {
        let existing = [ExistingTopic {
            topic: "mathe".to_owned(),
            skills: vec!["Multiplikation".to_owned()],
        }];
        let assignments = json!([
            { "topic": 0, "question": 0, "skill": "multiplikation" },
            { "topic": 0, "question": 1, "skill": "Division" },
            { "topic": 0, "question": 2, "skill": "Multiplikation" },
            { "topic": 1, "question": 0, "skill": "Kräfte" }
        ]);

        let topics = classify(&assignments, &topics(), &existing).expect("valid assignments");

        assert_eq!(topics.len(), 2);
        assert_eq!(topics[0].topic, "Mathe");
        assert_eq!(topics[0].skills.len(), 2);
        assert_eq!(topics[0].skills[0].skill, "Multiplikation");
        assert_eq!(
            topics[0].skills[0].questions.len(),
            2,
            "case is canonicalized"
        );
        assert_eq!(topics[0].skills[1].skill, "Division");
        assert_eq!(topics[1].topic, "Physik");
        assert_eq!(topics[1].skills[0].skill, "Kräfte");
    }

    #[test]
    fn orders_new_skills_after_existing_ones_as_first_named() {
        let existing = [ExistingTopic {
            topic: "Mathe".to_owned(),
            skills: vec!["Addition".to_owned(), "Multiplikation".to_owned()],
        }];
        // the LLM names "Brüche" before "Division", and "Multiplikation"
        // only for the last question
        let assignments = json!([
            { "topic": 0, "question": 1, "skill": "Brüche" },
            { "topic": 0, "question": 0, "skill": "Division" },
            { "topic": 0, "question": 2, "skill": "multiplikation" },
            { "topic": 1, "question": 0, "skill": "Kräfte" }
        ]);

        let topics = classify(&assignments, &topics(), &existing).expect("valid assignments");

        let names: Vec<&str> = topics[0]
            .skills
            .iter()
            .map(|skill| skill.skill.as_str())
            .collect();
        assert_eq!(names, ["Multiplikation", "Brüche", "Division"]);
    }

    #[test]
    fn rejects_missing_duplicate_and_unknown_assignments() {
        let assignments = json!([
            { "topic": 0, "question": 0, "skill": "A" },
            { "topic": 0, "question": 0, "skill": "B" },
            { "topic": 0, "question": 9, "skill": "C" },
            { "topic": 9, "question": 0, "skill": "D" },
            { "topic": 1, "question": 0, "skill": " " },
            { "topic": 1, "question": 0, "skill": "x".repeat(MAX_SKILL_CHARS + 1) }
        ]);

        let error = classify(&assignments, &topics(), &[]).expect_err("invalid assignments");
        let message = error.to_string();

        assert!(message.contains("assigned more than once"), "{message}");
        assert!(message.contains("out of range"), "{message}");
        assert!(message.contains("must not be empty"), "{message}");
        assert!(message.contains("at most 60 characters"), "{message}");
        assert!(message.contains("no skill assigned"), "{message}");
    }

    #[test]
    fn rejects_assignments_with_unknown_fields() {
        let error = classify(
            &json!([{ "topic": 0, "question": 0, "skill": "A", "extra": true }]),
            &topics(),
            &[],
        )
        .expect_err("unknown fields are rejected");

        assert!(error.to_string().contains("unknown field"));
    }

    #[test]
    fn keeps_topics_without_questions() {
        let topics = [TopicQuestions {
            topic: "Leer".to_owned(),
            questions: Vec::new(),
        }];

        let classified = classify(&json!([]), &topics, &[]).expect("nothing to assign");

        assert_eq!(
            classified,
            [TopicSkills {
                topic: "Leer".to_owned(),
                skills: Vec::new(),
            }]
        );
    }
}
