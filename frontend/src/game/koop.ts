import type { Question } from '../api/types'
import { MODULES } from './modules'
import { planBomb, seededRandom, type PlannedModule } from './plan'

/** Modules on a koop bomb. Both players derive the same bomb from the shared seed. */
export const KOOP_BOMB_SIZE = 5

export function planKoop(questions: Question[], seed: number): PlannedModule[] {
  return planBomb(questions, MODULES, KOOP_BOMB_SIZE, seededRandom(seed))
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
