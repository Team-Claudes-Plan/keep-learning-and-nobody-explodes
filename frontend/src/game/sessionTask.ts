import type { Briefing } from '../api/session'
import type { AnswerSubmission, Question, SessionAnswer } from '../api/types'
import { tasksFor } from './adapters'
import { glyphLabel } from './glyphs'
import type { ModuleDef } from './modules/types'
import { seededRandom, type PlannedModule } from './plan'

type DefuserBriefing = Extract<Briefing, { role: 'defuser' }>

/** The list a question type shows as symbols (backend/src/session/glyphs.rs, `symbol_field`). */
const SYMBOL_FIELD: Partial<Record<Question['type'], string>> = {
  single_choice: 'options',
  multiple_choice: 'options',
  order: 'items',
  grouping: 'items',
  matching: 'right',
}

/**
 * The defuser's question as the modules know it. The server leaves out the prompt (the expert has
 * it) and, with symbols, the answer list: that list is filled with glyph labels, entry i showing
 * symbol glyphs[i], so answers still refer to list indices.
 */
export function defuserQuestion(briefing: DefuserBriefing): Question {
  const task = { ...(briefing.task as Record<string, unknown>) }
  const field = SYMBOL_FIELD[task.type as Question['type']]
  if (field && briefing.glyphs) task[field] = briefing.glyphs.map(glyphLabel)
  return { prompt: '', ...task, id: `turn-${briefing.turn}` } as Question
}

/** A number from a string, so the same game and turn always get the same module. */
function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A module for this turn's question. The plain variant of each question comes first (e.g. pick the
 * right answers rather than the wrong ones): the expert's manual only knows the question, not how
 * the bomb asks it.
 */
export function planTurn(briefing: DefuserBriefing, gameId: string, modules: ModuleDef[]): PlannedModule | null {
  const question = defuserQuestion(briefing)
  const random = seededRandom(hash(`${gameId}:${briefing.turn}`))
  for (const task of tasksFor(question)) {
    const fitting = modules.filter((module) => module.supports(task.primitive, question.type))
    if (fitting.length === 0) continue
    const module = fitting[Math.floor(random() * fitting.length)]
    // Only fixed instructions (e.g. "Wahr oder falsch?") go on the module; the question is the expert's.
    return { question, task, module, heading: task.prompt || null }
  }
  return null
}

/** The session protocol names the question by turn, not by id. */
export function sessionAnswer({ type, answer }: AnswerSubmission): SessionAnswer {
  return { type, answer } as SessionAnswer
}
