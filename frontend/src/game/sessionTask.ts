import type { AnswerSubmission, DefuserPart, Question, SessionAnswer } from '../api/types'
import { shuffleTask, tasksFor, type Task } from './adapters'
import { glyphLabel } from './glyphs'
import type { ModuleDef } from './modules/types'
import { seededRandom, type PlannedModule } from './plan'

/** The list a question type shows as symbols (backend/src/session/glyphs.rs, `symbol_field`). */
const SYMBOL_FIELD: Partial<Record<Question['type'], string>> = {
  single_choice: 'options',
  multiple_choice: 'options',
  order: 'items',
  grouping: 'items',
  matching: 'right',
}

/**
 * The defuser's question as the modules know it. The server sends only the defuser's half (see
 * backend/src/session/brief.rs); what is missing is filled with what the bomb shows instead:
 * - a list shown as symbols gets glyph labels, entry i showing symbol glyphs[i], so answers still
 *   refer to list indices;
 * - true/false statements become "Aussage 1, 2, …", the manual has the statements in that order;
 * - a missing prompt stays empty, so the module shows no question.
 */
export function defuserQuestion(part: DefuserPart): Question {
  const task: Record<string, unknown> = { ...part.task }
  const field = SYMBOL_FIELD[part.task.type]
  if (field && part.glyphs?.length) task[field] = part.glyphs.map(glyphLabel)
  if (part.task.type === 'true_false') {
    task.statements = Array.from({ length: part.task.statementCount ?? 0 }, (_, i) => `Aussage ${i + 1}`)
  }
  return { prompt: '', ...task, id: `part-${part.position}` } as Question
}

/** A number from a string, so the same game and part always get the same module. */
function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** The terminal shows who is logged in; the manual says which question belongs to that user. */
function withUser(task: Task, user: string | undefined): Task {
  if (!user || task.primitive.kind !== 'text') return task
  return { ...task, primitive: { ...task.primitive, user } } as Task
}

/**
 * A module for one part of the bomb. The plain variant of each question comes first (e.g. pick the
 * right answers rather than the wrong ones). What the module shows across its top:
 * - choice and order questions: the question (the answers are symbols);
 * - true/false, matching, grouping: the fixed instruction ("Welche Aussagen sind wahr?", …);
 * - numbers, free text, coordinates: nothing, the question is in the manual.
 */
export function planPart(part: DefuserPart, gameId: string, modules: ModuleDef[]): PlannedModule | null {
  const question = defuserQuestion(part)
  const random = seededRandom(hash(`${gameId}:${part.position}`))
  for (const task of tasksFor(question)) {
    const fitting = modules.filter((module) => module.supports(task.primitive, question.type))
    if (fitting.length === 0) continue
    const module = fitting[Math.floor(random() * fitting.length)]
    // Mix the answers so their order on the bomb gives nothing away; "Aussage n" must keep its number.
    const shown = question.type === 'true_false' ? task : shuffleTask(task, random)
    return { question, task: withUser(shown, part.task.user), module, heading: task.prompt || null }
  }
  return null
}

/** The session protocol names the question by the part's position, not by id. */
export function sessionAnswer({ type, answer }: AnswerSubmission): SessionAnswer {
  return { type, answer } as SessionAnswer
}
