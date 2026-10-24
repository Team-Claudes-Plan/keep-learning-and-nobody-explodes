import type { AnswerMap, Question, QuestionType } from '../api/types'

/** Human-readable lines for an answer, used to compare the player's answer with the solution. */
export function describeAnswer(question: Question, answer: AnswerMap[QuestionType]): string[] {
  switch (question.type) {
    case 'single_choice':
      return [question.options[answer as AnswerMap['single_choice']] ?? '—']
    case 'multiple_choice': {
      const a = answer as AnswerMap['multiple_choice']
      return a.length > 0 ? a.map((i) => question.options[i]) : ['(keine)']
    }
    case 'true_false': {
      const a = answer as AnswerMap['true_false']
      return question.statements.map((s, i) => `${a[i] ? 'Wahr' : 'Falsch'}: ${s}`)
    }
    case 'text_input': {
      // Case-insensitive answers are entered in upper case, so show the solution the same way.
      const text = answer as AnswerMap['text_input']
      return [question.caseSensitive ? text : text.toUpperCase()]
    }
    case 'number_input': {
      const value = answer as AnswerMap['number_input']
      return [question.unit ? `${value} ${question.unit}` : String(value)]
    }
    case 'matching': {
      const a = answer as AnswerMap['matching']
      return question.left.map((left, i) => `${left} → ${question.right[a[i]] ?? '—'}`)
    }
    case 'grouping': {
      const a = answer as AnswerMap['grouping']
      return question.items.map((item, i) => `${item} → ${question.categories[a[i]] ?? '—'}`)
    }
    case 'coords': {
      const a = answer as AnswerMap['coords']
      return [`${Math.round(a.x)}% / ${Math.round(a.y)}%`]
    }
    case 'order':
      return [(answer as AnswerMap['order']).map((i) => question.items[i]).join(' → ')]
  }
}
