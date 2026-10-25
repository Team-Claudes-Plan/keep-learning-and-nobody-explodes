//! Prompt templates and tolerant JSON parsing of LLM responses.

use serde_json::Value;

pub const EXTRACTION: &str = include_str!("prompt/system.md");
pub const REVIEW: &str = include_str!("prompt/review.md");
pub const SKILL: &str = include_str!("prompt/skill.md");

/// Replaces `{{name}}` placeholders. Unknown placeholders are left untouched so
/// a prompt bug is visible in the rendered request.
#[must_use]
pub fn render(template: &str, variables: &[(&str, &str)]) -> String {
    let mut output = template.to_owned();

    for (name, value) in variables {
        output = output.replace(&format!("{{{{{name}}}}}"), value);
    }

    output
}

/// Parses JSON from a model response, tolerating Markdown fences or prose
/// around the actual JSON value.
pub fn parse_json_response(response: &str) -> Result<Value, serde_json::Error> {
    let trimmed = response.trim();

    if let Ok(value) = serde_json::from_str(trimmed) {
        return Ok(value);
    }

    if let Some(fenced) = strip_code_fence(trimmed)
        && let Ok(value) = serde_json::from_str(fenced.trim())
    {
        return Ok(value);
    }

    if let (Some(start), Some(end)) = (trimmed.find(['[', '{']), trimmed.rfind([']', '}']))
        && start < end
        && let Ok(value) = serde_json::from_str(&trimmed[start..=end])
    {
        return Ok(value);
    }

    serde_json::from_str(trimmed)
}

fn strip_code_fence(input: &str) -> Option<&str> {
    let rest = input.strip_prefix("```")?;
    let rest = rest.strip_prefix("json").unwrap_or(rest);
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))
        .unwrap_or(rest);

    rest.strip_suffix("```")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn renders_all_placeholders() {
        let rendered = render(
            "language={{language}} count={{max_questions}}",
            &[("language", "German"), ("max_questions", "5")],
        );

        assert_eq!(rendered, "language=German count=5");
        assert!(!rendered.contains("{{"));
    }

    #[test]
    fn extraction_template_has_no_missing_placeholders() {
        let rendered = render(
            EXTRACTION,
            &[
                ("language", "German"),
                ("max_questions", "10"),
                ("allowed_types", "text_input"),
                ("image_section", "images"),
                ("island_context", "island"),
                ("existing_topics", "- Cells"),
            ],
        );

        assert!(!rendered.contains("{{"), "unrendered placeholder in prompt");
    }

    #[test]
    fn review_template_has_no_missing_placeholders() {
        let rendered = render(REVIEW, &[("language", "German")]);

        assert!(!rendered.contains("{{"), "unrendered placeholder in prompt");
    }

    #[test]
    fn skill_template_has_no_missing_placeholders() {
        let rendered = render(SKILL, &[("language", "German"), ("max_skill_chars", "60")]);

        assert!(!rendered.contains("{{"), "unrendered placeholder in prompt");
    }

    #[test]
    fn parses_plain_json() {
        assert_eq!(
            parse_json_response("[1, 2]").expect("valid JSON"),
            json!([1, 2])
        );
    }

    #[test]
    fn parses_json_in_code_fence() {
        assert_eq!(
            parse_json_response("```json\n[{\"type\": \"text_input\"}]\n```")
                .expect("valid fenced JSON"),
            json!([{ "type": "text_input" }])
        );
    }

    #[test]
    fn parses_json_between_prose() {
        assert_eq!(
            parse_json_response("Here is the result:\n{\"valid\": true}\nDone.")
                .expect("valid embedded JSON"),
            json!({ "valid": true })
        );
    }

    #[test]
    fn rejects_text_without_json() {
        parse_json_response("no json here").expect_err("plain text is not JSON");
    }
}
