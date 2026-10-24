import type { AnswerMap, Question, QuestionType } from '../api/types'

/** Human-readable lines for an answer, used to compare the player's answer with the solution. */
export function describeAnswer(question: Question, answer: AnswerMap[QuestionType]): string[] {
  switch (question.type) {
    case 'single_choice': {
      const a = answer as AnswerMap['single_choice']
      return [question.options[a.optionIndex] ?? '—']
    }
    case 'multiple_choice': {
      const a = answer as AnswerMap['multiple_choice']
      return a.optionIndices.length > 0 ? a.optionIndices.map((i) => question.options[i]) : ['(keine)']
    }
    case 'true_false': {
      const a = answer as AnswerMap['true_false']
      return question.statements.map((s, i) => `${a.values[i] ? 'Wahr' : 'Falsch'}: ${s}`)
    }
    case 'text_input': {
      // Case-insensitive answers are entered in upper case, so show the solution the same way.
      const text = (answer as AnswerMap['text_input']).text
      return [question.caseSensitive ? text : text.toUpperCase()]
    }
    case 'number_input': {
      const a = answer as AnswerMap['number_input']
      return [question.unit ? `${a.value} ${question.unit}` : String(a.value)]
    }
    case 'matching': {
      const a = answer as AnswerMap['matching']
      return [...a.pairs]
        .sort((x, y) => x.left - y.left)
        .map((p) => `${question.left[p.left]} → ${question.right[p.right] ?? '—'}`)
    }
    case 'grouping': {
      const a = answer as AnswerMap['grouping']
      return question.items.map((item, i) => `${item} → ${question.categories[a.assignments[i]] ?? '—'}`)
    }
    case 'coords': {
      const a = answer as AnswerMap['coords']
      return [`${Math.round(a.x)}% / ${Math.round(a.y)}%`]
    }
    case 'order': {
      const a = answer as AnswerMap['order']
      return [a.order.map((i) => question.items[i]).join(' → ')]
    }
  }
}
