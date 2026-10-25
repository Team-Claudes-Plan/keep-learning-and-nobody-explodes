//! How far the houses (topics) of an island are built.
//!
//! A member's level of a topic follows from the share of its tasks they ever
//! solved, in any game on any island. Topics are shared between an island and
//! its forks, so what someone learned carries over to every island with them.
//! A house is only built as far as **every** member of the island knows the
//! topic: on a fork with a new partner, exactly the houses both already know
//! are unlocked.

/// Highest level of a house; matches the storeys the frontend can draw.
pub const MAX_LEVEL: u8 = 4;

/// Level of one learner: the share of `tasks` they solved, rounded up to the
/// next of [`MAX_LEVEL`] steps, so any solved task unlocks the first level.
#[must_use]
pub fn level(solved: u32, tasks: u32) -> u8 {
    if tasks == 0 {
        return 0;
    }
    let solved = u64::from(solved.min(tasks));
    let steps = (u64::from(MAX_LEVEL) * solved).div_ceil(u64::from(tasks));
    u8::try_from(steps).unwrap_or(MAX_LEVEL)
}

/// Level of a house: what all members know, i.e. the lowest member level.
/// An island without members has nothing built.
#[must_use]
pub fn house_level(member_levels: impl IntoIterator<Item = u8>) -> u8 {
    member_levels.into_iter().min().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_rounds_up_to_the_next_step() {
        assert_eq!(level(0, 10), 0);
        assert_eq!(level(1, 10), 1);
        assert_eq!(level(3, 10), 2);
        assert_eq!(level(5, 10), 2);
        assert_eq!(level(6, 10), 3);
        assert_eq!(level(10, 10), MAX_LEVEL);
    }

    #[test]
    fn level_of_an_empty_topic_is_zero() {
        assert_eq!(level(0, 0), 0);
        assert_eq!(level(3, 0), 0);
    }

    #[test]
    fn level_is_capped() {
        // tasks can be deleted after they were solved
        assert_eq!(level(12, 10), MAX_LEVEL);
    }

    #[test]
    fn house_needs_every_member() {
        assert_eq!(house_level([3, 1]), 1);
        assert_eq!(house_level([2, 0]), 0, "one member has not learned it");
        assert_eq!(house_level([4, 4]), 4);
    }

    #[test]
    fn single_member_builds_alone() {
        assert_eq!(house_level([2]), 2);
        assert_eq!(house_level([]), 0);
    }
}
