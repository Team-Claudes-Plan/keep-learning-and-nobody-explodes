//! How far the houses (topics) of an island are built.
//!
//! The skills of a topic form its skill tree, ordered by `skills.position`:
//! the storeys of the house, ground floor first. A member passed a skill once
//! they won a bomb played on it. Topics are shared between an island and its
//! forks, so what someone passed carries over to every island with them. A
//! house is only built as far as **every** member of the island passed its
//! skills, in order: on a fork with a new partner, exactly the storeys both
//! already passed are built, plus the next one to play.

use uuid::Uuid;

use crate::db::TopicProgress;

/// A skill is passed when every member won a bomb on it. An island without
/// members has passed nothing.
#[must_use]
pub fn skill_passed(member_wins: impl IntoIterator<Item = u32>) -> bool {
    let mut member_wins = member_wins.into_iter();
    let Some(first) = member_wins.next() else {
        return false;
    };
    first > 0 && member_wins.all(|wins| wins > 0)
}

/// Level of a house: the number of skills passed in a row from the ground
/// floor. A passed skill above an unpassed one does not count yet.
#[must_use]
pub fn house_level(passed: impl IntoIterator<Item = bool>) -> u32 {
    let leading = passed.into_iter().take_while(|passed| *passed).count();
    u32::try_from(leading).unwrap_or(u32::MAX)
}

/// Whether the storey at `position` can be played on a house at `level`:
/// every passed storey, and the next one.
#[must_use]
pub fn storey_unlocked(position: u32, level: u32) -> bool {
    position <= level
}

/// Whether each skill of `topic` (in skill tree order) is passed by every
/// member of the island.
#[must_use]
pub fn passed_skills(topic: &TopicProgress) -> Vec<bool> {
    topic
        .skills
        .iter()
        .map(|skill| skill_passed(skill.members.iter().map(|member| member.wins)))
        .collect()
}

/// Whether the storey of `skill_id` can be played on `topic`'s house; `None`
/// if the skill is not part of the topic.
#[must_use]
pub fn skill_unlocked(topic: &TopicProgress, skill_id: Uuid) -> Option<bool> {
    let index = topic.skills.iter().position(|skill| skill.id == skill_id)?;
    let level = house_level(passed_skills(topic));
    Some(storey_unlocked(u32::try_from(index).ok()?, level))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_needs_every_member() {
        assert!(skill_passed([1]));
        assert!(skill_passed([1, 3]));
        assert!(!skill_passed([1, 0]), "one member has not won it yet");
        assert!(
            !skill_passed([]),
            "an island without members passed nothing"
        );
    }

    #[test]
    fn house_level_counts_passed_skills_from_the_ground_floor() {
        assert_eq!(house_level([]), 0);
        assert_eq!(house_level([true, true, false]), 2);
        assert_eq!(
            house_level([false, true, true]),
            0,
            "the ground floor is not passed yet"
        );
        assert_eq!(house_level([true, false, true, true]), 1);
        assert_eq!(house_level([true; 9]), 9, "houses grow with their skills");
    }

    #[test]
    fn passed_storeys_and_the_next_one_are_unlocked() {
        assert!(storey_unlocked(0, 0), "the ground floor is always open");
        assert!(storey_unlocked(2, 2));
        assert!(!storey_unlocked(3, 2));
    }
}
