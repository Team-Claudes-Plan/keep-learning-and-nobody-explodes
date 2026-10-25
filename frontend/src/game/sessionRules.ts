// How big the bomb of a storey is. The frontend decides it per round and tells the backend in
// `create`; the backend picks that many tasks of the storey's skill (repeating if it has fewer).

/** Modules on the bomb of the ground floor; every storey above adds one. */
const BASE_MODULES = 4
/** The most modules a storey bomb gets. */
const MAX_MODULES = 8
/** Time per module on the clock. */
const SECONDS_PER_MODULE = 60

/** Questions on the bomb of the storey at `index` (0 is the ground floor): 4 to 8. */
export function questionsForStorey(index: number): number {
  return Math.min(MAX_MODULES, BASE_MODULES + Math.max(0, index))
}

/** Time limit for a bomb with `questions` modules. */
export function secondsForQuestions(questions: number): number {
  return questions * SECONDS_PER_MODULE
}
