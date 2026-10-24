import type { QuestionType } from '../api/types'

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single_choice: 'Single Choice',
  multiple_choice: 'Multiple Choice',
  true_false: 'Wahr / Falsch',
  text_input: 'Texteingabe',
  number_input: 'Zahleneingabe',
  matching: 'Zuordnen',
  grouping: 'Gruppieren',
  coords: 'Koordinaten',
  order: 'Reihenfolge',
}

export const QUESTION_TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]
