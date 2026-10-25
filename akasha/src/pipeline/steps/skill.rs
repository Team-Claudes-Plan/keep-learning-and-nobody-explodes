//! Step 4: group the validated questions of every topic into skills.

use crate::pipeline::{
    PipelineContext, PipelineStep, SKILL, StepFailure, StepId, StepOutcome,
    error::SkillError,
    prompt,
    schema::TopicQuestions,
    skill::{self, ExistingTopic, MAX_SKILL_CHARS},
};
use crate::provider::{Llm, OutputFormat};

/// Groups each topic's questions into existing or new skills.
#[derive(Clone, Debug)]
pub struct SkillStep<L: Llm> {
    llm: L,
}

impl<L: Llm> SkillStep<L> {
    #[must_use]
    pub fn new(llm: L) -> Self {
        Self { llm }
    }
}

impl<L: Llm> PipelineStep for SkillStep<L> {
    fn id(&self) -> StepId {
        SKILL
    }

    async fn run<'a>(
        &'a self,
        context: &'a mut PipelineContext,
    ) -> Result<StepOutcome, StepFailure> {
        let topics = context
            .topics
            .as_ref()
            .ok_or_else(|| StepFailure::new(SkillError::MissingQuestions, SKILL))?;

        let questions = serde_json::to_string_pretty(topics)
            .map_err(|error| StepFailure::new(SkillError::Serialize(error), SKILL))?;
        let question_count = topics
            .iter()
            .map(|topic| topic.questions.len())
            .sum::<usize>();
        let max_skill_chars = MAX_SKILL_CHARS.to_string();
        let system = prompt::render(
            prompt::SKILL,
            &[
                ("language", context.input.language.as_str()),
                ("max_skill_chars", max_skill_chars.as_str()),
            ],
        );

        let mut user = format!(
            "Island: {}\nTarget language: {}\n\nTopics and their existing skills:\n{}\n\n\
             Questions grouped by topic:\n{}",
            context.input.island_name,
            context.input.language,
            skill_catalog(topics, &context.input.existing_skills),
            questions,
        );
        if let Some(feedback) = &context.last_feedback {
            user.push_str(
                "\n\nThe previous classification was rejected for these reasons. \
                 Fix every issue and return the complete assignment array again:\n",
            );
            user.push_str(feedback);
            user.push('\n');
        }

        tracing::info!(
            chronicle = %context.input.id,
            topics = topics.len(),
            questions = question_count,
            has_feedback = context.last_feedback.is_some(),
            "skill classification started"
        );
        tracing::debug!(
            chronicle = %context.input.id,
            system_chars = system.len(),
            user_chars = user.len(),
            "skill classification prompt prepared"
        );

        let response = self
            .llm
            .complete(&system, &user, 0.0, OutputFormat::Text)
            .await
            .map_err(|error| StepFailure::new(SkillError::Llm(error), SKILL))?;

        if response.trim().is_empty() {
            return Err(StepFailure::new(SkillError::EmptyResponse, SKILL));
        }

        let value = prompt::parse_json_response(&response)
            .map_err(|error| StepFailure::new(SkillError::InvalidJson(error), SKILL))?;
        let skills = skill::classify(&value, topics, &context.input.existing_skills)
            .map_err(|issues| StepFailure::new(SkillError::Invalid(issues), SKILL))?;

        let skill_count = skills.iter().map(|topic| topic.skills.len()).sum::<usize>();
        tracing::info!(
            chronicle = %context.input.id,
            response_chars = response.len(),
            topics = skills.len(),
            skills = skill_count,
            questions = question_count,
            "skill classification completed"
        );
        for topic in &skills {
            for skill in &topic.skills {
                tracing::debug!(
                    chronicle = %context.input.id,
                    topic = %topic.topic,
                    skill = %skill.skill,
                    questions = skill.questions.len(),
                    "classified skill"
                );
            }
        }

        context.skills = Some(skills);

        Ok(StepOutcome::Next)
    }
}

/// The topic and skill names the classifier may reuse, as a Markdown list.
fn skill_catalog(topics: &[TopicQuestions], existing: &[ExistingTopic]) -> String {
    let mut lines = Vec::new();

    for topic in topics {
        let skills = existing
            .iter()
            .find(|entry| entry.topic.to_lowercase() == topic.topic.to_lowercase())
            .map_or(&[][..], |entry| entry.skills.as_slice());

        if skills.is_empty() {
            lines.push(format!("- {}: no skills yet", topic.topic));
            continue;
        }

        lines.push(format!("- {}", topic.topic));
        for skill in skills {
            lines.push(format!("  - {skill}"));
        }
    }

    lines.join("\n")
}
