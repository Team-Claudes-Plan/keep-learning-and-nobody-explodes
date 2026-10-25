//! How far the houses (topics) of an island are built.
//!
//! A skill is a storey of a house and the unit of knowledge: it is learned by a
//! member once they solved at least one of its tasks. Topics are shared between
//! an island and its forks, so what someone learned carries over to every
//! island with them. A house is only built as far as **every** member of the
//! island knows its skills: on a fork with a new partner, exactly the storeys
//! both already know are unlocked.

/// Highest level of a house; matches the storeys the frontend can draw.
pub const MAX_LEVEL: u8 = 4;

/// A skill is learned when every member solved at least one of its tasks.
/// An island without members has learned nothing.
#[must_use]
pub fn skill_learned(member_solved: impl IntoIterator<Item = u32>) -> bool {
    let mut member_solved = member_solved.into_iter();
    let Some(first) = member_solved.next() else {
        return false;
    };
    first > 0 && member_solved.all(|solved| solved > 0)
}

/// Level of a house: the number of skills every member learned, capped at the
/// storeys the frontend can draw.
#[must_use]
pub fn house_level(learned: impl IntoIterator<Item = bool>) -> u8 {
    let learned = learned.into_iter().filter(|learned| *learned).count();
    u8::try_from(learned).unwrap_or(MAX_LEVEL).min(MAX_LEVEL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_needs_every_member() {
        assert!(skill_learned([1]));
        assert!(skill_learned([1, 3]));
        assert!(!skill_learned([1, 0]), "one member has not started it");
        assert!(
            !skill_learned([]),
            "an island without members learned nothing"
        );
    }

    #[test]
    fn house_level_counts_learned_skills() {
        assert_eq!(house_level([]), 0);
        assert_eq!(house_level([false, true, true]), 2);
        assert_eq!(house_level([true, false, true, true]), 3);
    }

    #[test]
    fn house_level_is_capped() {
        assert_eq!(house_level([true; 6]), MAX_LEVEL);
    }
}
