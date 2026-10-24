import type { Question, QuestionType } from '../api/types'
import { tasksFor, type Task } from './adapters'
import type { ModuleDef } from './modules/types'

export type PlannedModule = { question: Question; task: Task; module: ModuleDef }

function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Picks up to `size` questions and a random fitting module for each. */
export function planBomb(questions: Question[], modules: ModuleDef[], size: number): PlannedModule[] {
  const plan: PlannedModule[] = []
  for (const question of shuffle(questions)) {
    if (plan.length >= size) break
    const options = tasksFor(question).flatMap((task) =>
      modules.filter((m) => m.supports(task.primitive, question.type)).map((module) => ({ task, module })),
    )
    if (options.length === 0) continue
    plan.push({ question, ...options[Math.floor(Math.random() * options.length)] })
  }
  return plan
}

/** Test mode: one module per (task variant × fitting module) for the given question type. */
export function planForType(questions: Question[], modules: ModuleDef[], type: QuestionType): PlannedModule[] {
  const ofType = shuffle(questions.filter((q) => q.type === type))
  if (ofType.length === 0) return []

  const plan: PlannedModule[] = []
  const variants = tasksFor(ofType[0]).length
  for (let variant = 0; variant < variants; variant++) {
    for (const module of modules) {
      // Rotate through the questions so each module gets a different one where possible.
      for (let k = 0; k < ofType.length; k++) {
        const question = ofType[(plan.length + k) % ofType.length]
        const task = tasksFor(question)[variant]
        if (task && module.supports(task.primitive, question.type)) {
          plan.push({ question, task, module })
          break
        }
      }
    }
  }
  return plan
}

/** Question types that at least one of the modules can play with the given questions. */
export function playableTypes(questions: Question[], modules: ModuleDef[]): Set<QuestionType> {
  const types = new Set<QuestionType>()
  for (const question of questions) {
    if (tasksFor(question).some((task) => modules.some((m) => m.supports(task.primitive, question.type)))) {
      types.add(question.type)
    }
  }
  return types
}
