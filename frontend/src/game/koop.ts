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

/** Where plan entry i sits on the bomb (Slot_{i+1}); left/right as seen from the timer side. */
export const SLOT_LABELS = [
  'Vorne rechts',
  'Oben vorne, links',
  'Oben vorne, rechts',
  'Oben hinten, links',
  'Oben hinten, rechts',
  'Hinten, links',
  'Hinten, rechts',
  'Unten hinten, links',
  'Unten hinten, rechts',
  'Unten vorne, links',
  'Unten vorne, rechts',
]

export function newSeed() {
  return Math.floor(100000 + Math.random() * 900000)
}
