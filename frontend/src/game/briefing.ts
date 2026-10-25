import type { Task } from './adapters'
import { GLYPHS, glyphLabel } from './glyphs'
import type { PlannedModule, Random } from './plan'

// Koop: what the defuser sees on the bomb and what the expert reads in the manual, per question
// type. Neither can solve a module alone: the bomb shows symbols, numbers or just the controls, the
// manual says what they stand for (or what the question is).

/** What the expert's manual says about one module. */
export type Manual = {
  /** Page heading, e.g. "Modul 2 · Einfachauswahl" (session games, where pages arrive turn by turn). */
  title?: string
  /** The question, when only the expert has it (free text, numbers, the radar). */
  prompt?: string
  /** True/false: the statements behind "Aussage 1, 2, …" on the bomb. */
  statements?: string[]
  /** What each symbol on the bomb stands for. */
  glyphs?: { glyph: number; text: string }[]
  /** Free-text terminals: the user shown on the terminal; the manual lists these together. */
  user?: string
  /** Further lists from the manual entry (session games), e.g. the groups to sort into. */
  lists?: { title: string; items: string[] }[]
  /** Further notes from the manual entry (session games). */
  notes?: string[]
}

const USER_NAMES = ['falke', 'otter', 'luchs', 'kranich', 'dachs', 'marder', 'uhu', 'wiesel', 'biber', 'reiher', 'fuchs', 'specht']

/** A login name like "luchs_42", the same on both sides for a seed. */
function userName(random: Random) {
  return `${USER_NAMES[Math.floor(random() * USER_NAMES.length)]}_${10 + Math.floor(random() * 90)}`
}

export type Briefed = PlannedModule & { manual: Manual }

/** A random symbol for every label (all different), for the same bomb on both sides. */
function pickGlyphs(count: number, random: Random) {
  const pool = GLYPHS.map((_, i) => i)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, count)
}

function withPrimitive(task: Task, patch: object): Task {
  return { ...task, primitive: { ...task.primitive, ...patch } } as Task
}

/** Splits one planned module into the defuser's part (task + heading) and the expert's manual. */
export function brief(planned: PlannedModule, random: Random): Briefed {
  const { question, task } = planned
  const primitive = task.primitive

  const symbols = (labels: string[]) => {
    const glyphs = pickGlyphs(labels.length, random)
    return { labels: glyphs.map(glyphLabel), manual: glyphs.map((glyph, i) => ({ glyph, text: labels[i] })) }
  }

  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
    case 'order': {
      // the question on the bomb, the answers as symbols, the manual says which is which
      if (primitive.kind !== 'pick' && primitive.kind !== 'sequence') break
      const { labels, manual } = symbols(primitive.items)
      return { ...planned, task: withPrimitive(task, { items: labels }), heading: task.prompt, manual: { glyphs: manual } }
    }
    case 'true_false': {
      // "Welche Aussage ist wahr?" on the bomb, the statements themselves only in the manual
      if (primitive.kind !== 'pick' && primitive.kind !== 'assign') break
      const items = primitive.items.map((_, i) => `Aussage ${i + 1}`)
      return { ...planned, task: withPrimitive(task, { items }), heading: task.prompt, manual: { statements: primitive.items } }
    }
    case 'matching': {
      // left side in plain text, right side as symbols the manual decodes
      if (primitive.kind !== 'assign') break
      const { labels, manual } = symbols(primitive.targets)
      return { ...planned, task: withPrimitive(task, { targets: labels }), heading: task.prompt, manual: { glyphs: manual } }
    }
    case 'grouping': {
      // the groups in plain text, the things to sort as symbols
      if (primitive.kind !== 'assign') break
      const { labels, manual } = symbols(primitive.items)
      return { ...planned, task: withPrimitive(task, { items: labels }), heading: task.prompt, manual: { glyphs: manual } }
    }
    case 'number_input':
      // the bomb only shows the unit (on the lock or terminal), the question is in the manual
      return { ...planned, heading: null, manual: { prompt: task.prompt } }
    case 'text_input': {
      // the terminal shows only who is logged in; the manual says which question belongs to that user
      const user = userName(random)
      return { ...planned, task: withPrimitive(task, { user }), heading: null, manual: { prompt: task.prompt, user } }
    }
    case 'coords':
      // just the controls on the bomb, the question is in the manual
      return { ...planned, heading: null, manual: { prompt: task.prompt } }
  }
  return { ...planned, manual: { prompt: task.prompt } }
}
