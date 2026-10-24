import type { AnswerSubmission, Question } from '../api/types'
import type { AnyValue, PrimitiveKind, PrimitiveOf, ValueOf } from './primitives'

type TaskOf<K extends PrimitiveKind> = {
  prompt: string
  primitive: PrimitiveOf<K>
  toSubmission: (value: ValueOf<K>) => AnswerSubmission
}

/** One way to play a question: a prompt, a primitive, and how to turn its value into an answer. */
export type Task = { [K in PrimitiveKind]: TaskOf<K> }[PrimitiveKind]

function task<K extends PrimitiveKind>(t: TaskOf<K>): Task {
  return t as unknown as Task
}

export function submissionFor(task: Task, value: AnyValue): AnswerSubmission {
  return (task.toSubmission as (v: AnyValue) => AnswerSubmission)(value)
}

/** All ways a question can be played. Empty if no primitive fits yet. */
export function tasksFor(question: Question): Task[] {
  const questionId = question.id

  switch (question.type) {
    case 'single_choice':
      return [
        task<'pick'>({
          prompt: question.prompt,
          primitive: { kind: 'pick', mode: 'one', items: question.options },
          toSubmission: ([optionIndex]) => ({ questionId, type: 'single_choice', answer: optionIndex }),
        }),
      ]

    case 'multiple_choice':
      return [
        task<'pick'>({
          prompt: question.prompt,
          primitive: { kind: 'pick', mode: 'many', items: question.options, selects: 'true' },
          toSubmission: (optionIndices) => ({
            questionId,
            type: 'multiple_choice',
            answer: [...optionIndices].sort((a, b) => a - b),
          }),
        }),
        task<'pick'>({
          prompt: question.prompt,
          primitive: { kind: 'pick', mode: 'many', items: question.options, selects: 'false' },
          toSubmission: (wrong) => ({
            questionId,
            type: 'multiple_choice',
            answer: question.options.map((_, i) => i).filter((i) => !wrong.includes(i)),
          }),
        }),
      ]

    case 'true_false':
      return [
        task<'pick'>({
          prompt: 'Welche Aussagen sind wahr?',
          primitive: {
            kind: 'pick',
            mode: 'many',
            items: question.statements,
            onLabel: 'WAHR',
            offLabel: 'FALSCH',
            selects: 'true',
          },
          toSubmission: (picked) => ({
            questionId,
            type: 'true_false',
            answer: question.statements.map((_, i) => picked.includes(i)),
          }),
        }),
        task<'pick'>({
          prompt: 'Welche Aussagen sind falsch?',
          primitive: { kind: 'pick', mode: 'many', items: question.statements, selects: 'false' },
          toSubmission: (picked) => ({
            questionId,
            type: 'true_false',
            answer: question.statements.map((_, i) => !picked.includes(i)),
          }),
        }),
        task<'assign'>({
          prompt: 'Wahr oder falsch?',
          primitive: { kind: 'assign', items: question.statements, targets: ['Wahr', 'Falsch'] },
          toSubmission: (targets) => ({
            questionId,
            type: 'true_false',
            answer: targets.map((t) => t === 0),
          }),
        }),
      ]

    case 'number_input':
      return [
        task<'number'>({
          prompt: question.prompt,
          primitive: { kind: 'number', unit: question.unit },
          toSubmission: (value) => ({ questionId, type: 'number_input', answer: value ?? 0 }),
        }),
      ]

    case 'matching':
      return [
        task<'assign'>({
          prompt: 'Ordne richtig zu.',
          primitive: { kind: 'assign', items: question.left, targets: question.right, unique: true },
          toSubmission: (targets) => ({
            questionId,
            type: 'matching',
            answer: targets.map((right) => right ?? -1),
          }),
        }),
      ]

    case 'grouping':
      return [
        task<'assign'>({
          prompt: 'Sortiere in die richtige Gruppe.',
          primitive: { kind: 'assign', items: question.items, targets: question.categories },
          toSubmission: (targets) => ({
            questionId,
            type: 'grouping',
            answer: targets.map((t) => t ?? -1),
          }),
        }),
      ]

    case 'text_input':
      return [
        task<'text'>({
          prompt: question.prompt,
          primitive: { kind: 'text', uppercase: !question.caseSensitive },
          toSubmission: (text) => ({ questionId, type: 'text_input', answer: text.trim() }),
        }),
      ]

    case 'order':
      return [
        task<'sequence'>({
          prompt: question.prompt,
          primitive: { kind: 'sequence', items: question.items },
          toSubmission: (order) => ({ questionId, type: 'order', answer: order }),
        }),
      ]

    case 'coords':
      return [
        task<'point'>({
          prompt: question.prompt,
          primitive: { kind: 'point', image: question.image },
          toSubmission: (point) => ({
            questionId,
            type: 'coords',
            answer: { x: point?.x ?? 0, y: point?.y ?? 0 },
          }),
        }),
      ]
  }
}
