import type { Question, QuestionType } from '../api/types'
import { brief, type Briefed } from './briefing'
import { MODULES } from './modules'
import { planBomb, planForType, seededRandom } from './plan'

/** Modules on a koop bomb. Both players derive the same bomb from the shared seed. */
export const KOOP_BOMB_SIZE = 5

/**
 * The koop bomb for a seed, split into what the defuser sees and what the manual says. A question
 * type makes it a practice bomb: every task of that type in every fitting module.
 */
export function planKoop(questions: Question[], seed: number, type: QuestionType | null = null): Briefed[] {
  const random = seededRandom(seed)
  const plan = type ? planForType(questions, MODULES, type, random) : planBomb(questions, MODULES, KOOP_BOMB_SIZE, random)
  // own random stream per module, so the symbols never depend on anything else on the bomb
  return plan.map((planned, i) => brief(planned, seededRandom(seed * 31 + i + 1)))
}

export function newSeed() {
  return Math.floor(100000 + Math.random() * 900000)
}
