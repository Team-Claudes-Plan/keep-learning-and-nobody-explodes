//! Which tasks of a skill a bomb is built from: pure rules over the
//! candidates loaded by `Database::skill_task_candidates`.
//!
//! Tasks the players have not solved yet come first, the ones they failed
//! before the ones they never saw. Solved tasks come back once they rest for
//! [`REPEAT_DELAY`], the longest resting first, and fill up the bomb when the
//! skill runs out of fresh tasks. Every task is on the bomb at most once: the
//! players see all modules and the whole manual at the same time, so a repeat
//! would just be the same question twice. A skill with fewer tasks than the
//! bomb has modules makes a smaller bomb.

use chrono::{DateTime, TimeDelta, Utc};

use crate::db::{PickedTask, TaskCandidate};

/// How long a solved task rests before it is asked again without need.
pub const REPEAT_DELAY: TimeDelta = TimeDelta::minutes(10);

/// Why a candidate is picked, earliest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Tier {
    Failed,
    Unseen,
    Rested,
    Recent,
}

fn tier(candidate: &TaskCandidate, now: DateTime<Utc>) -> Tier {
    match (candidate.last_solved, candidate.last_failed) {
        (None, Some(_)) => Tier::Failed,
        (None, None) => Tier::Unseen,
        (Some(solved), _) if solved <= now - REPEAT_DELAY => Tier::Rested,
        (Some(_), _) => Tier::Recent,
    }
}

/// Picks up to `count` different tasks out of `candidates`; empty only
/// without candidates.
/// `random(n)` returns a number below `n` and shuffles tasks of equal rank.
pub fn pick(
    mut candidates: Vec<TaskCandidate>,
    count: usize,
    now: DateTime<Utc>,
    mut random: impl FnMut(usize) -> usize,
) -> Vec<PickedTask> {
    for i in (1..candidates.len()).rev() {
        candidates.swap(i, random(i + 1));
    }
    // stable, so the shuffle stays within a rank
    candidates.sort_by_key(|candidate| {
        let tier = tier(candidate, now);
        let rest = match tier {
            Tier::Rested | Tier::Recent => candidate.last_solved,
            Tier::Failed | Tier::Unseen => None,
        };
        (tier, rest)
    });
    candidates
        .into_iter()
        .take(count)
        .map(|candidate| candidate.task)
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use uuid::Uuid;

    use super::*;

    fn now() -> DateTime<Utc> {
        DateTime::from_timestamp(1_000_000, 0).expect("valid timestamp")
    }

    fn candidate(
        id: u128,
        solved_ago: Option<TimeDelta>,
        failed_ago: Option<TimeDelta>,
    ) -> TaskCandidate {
        TaskCandidate {
            task: PickedTask {
                task_id: Uuid::from_u128(id),
                instruction_id: Uuid::from_u128(id + 1000),
                question_type: "single_choice".to_owned(),
                content: json!({}),
            },
            last_solved: solved_ago.map(|ago| now() - ago),
            last_failed: failed_ago.map(|ago| now() - ago),
        }
    }

    fn ids(picked: &[PickedTask]) -> Vec<u128> {
        picked.iter().map(|task| task.task_id.as_u128()).collect()
    }

    /// A `random` that keeps the input order: it swaps every `i` with itself.
    fn no_shuffle(bound: usize) -> usize {
        bound - 1
    }

    #[test]
    fn fresh_tasks_come_before_solved_ones() {
        let candidates = vec![
            candidate(1, Some(TimeDelta::minutes(1)), None),
            candidate(2, Some(TimeDelta::hours(2)), None),
            candidate(3, None, None),
            candidate(4, None, Some(TimeDelta::minutes(1))),
            candidate(5, Some(TimeDelta::hours(1)), None),
        ];
        let picked = pick(candidates, 5, now(), no_shuffle);
        assert_eq!(
            ids(&picked),
            [4, 3, 2, 5, 1],
            "failed, unseen, then rested tasks longest resting first, recent last"
        );
    }

    #[test]
    fn a_solved_and_later_failed_task_counts_as_solved() {
        let candidates = vec![
            candidate(1, Some(TimeDelta::hours(1)), Some(TimeDelta::minutes(1))),
            candidate(2, None, None),
        ];
        assert_eq!(ids(&pick(candidates, 2, now(), no_shuffle)), [2, 1]);
    }

    #[test]
    fn never_repeats_a_task() {
        let candidates = vec![candidate(1, None, None), candidate(2, None, None)];
        assert_eq!(ids(&pick(candidates, 5, now(), no_shuffle)), [1, 2]);
    }

    #[test]
    fn takes_only_what_the_bomb_needs() {
        let candidates = (0..10).map(|id| candidate(id, None, None)).collect();
        assert_eq!(pick(candidates, 4, now(), no_shuffle).len(), 4);
    }

    #[test]
    fn nothing_to_pick_from_an_empty_skill() {
        assert!(pick(Vec::new(), 4, now(), no_shuffle).is_empty());
    }

    #[test]
    fn shuffles_within_a_tier_only() {
        let candidates = vec![
            candidate(1, None, None),
            candidate(2, None, None),
            candidate(3, Some(TimeDelta::hours(1)), None),
        ];
        // always swapping with index 0 turns [1, 2, 3] into [2, 3, 1]
        let picked = pick(candidates, 3, now(), |_| 0);
        assert_eq!(ids(&picked), [2, 1, 3], "the solved task stays last");
    }
}
