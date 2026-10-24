// Shapes exchanged with the backend, matching schema/questions.schema.json.
// Questions contain no solutions; the backend evaluates submitted answers.
// Answers reference options/items by their index in the delivered arrays.

export type SingleChoiceQuestion = {
  type: 'single_choice'
  id: string
  prompt: string
  options: string[]
}

export type MultipleChoiceQuestion = {
  type: 'multiple_choice'
  id: string
  prompt: string
  options: string[]
}

export type TrueFalseQuestion = {
  type: 'true_false'
  id: string
  statements: string[]
}

export type TextInputQuestion = {
  type: 'text_input'
  id: string
  prompt: string
  /** Default false: case is ignored and input is sent in upper case. */
  caseSensitive?: boolean
}

export type NumberInputQuestion = {
  type: 'number_input'
  id: string
  prompt: string
  unit?: string | null
}

export type MatchingQuestion = {
  type: 'matching'
  id: string
  left: string[]
  right: string[]
}

export type GroupingQuestion = {
  type: 'grouping'
  id: string
  categories: string[]
  items: string[]
}

export type CoordsQuestion = {
  type: 'coords'
  id: string
  prompt: string
  image: string
}

export type OrderQuestion = {
  type: 'order'
  id: string
  prompt: string
  items: string[]
}

export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | TextInputQuestion
  | NumberInputQuestion
  | MatchingQuestion
  | GroupingQuestion
  | CoordsQuestion
  | OrderQuestion

export type QuestionType = Question['type']

/** The answer value itself per question type (see schema/answer-submission.schema.json). */
export type AnswerMap = {
  /** Index of the chosen option. */
  single_choice: number
  /** Indices of the chosen options, ascending. */
  multiple_choice: number[]
  /** One value per statement, same order. */
  true_false: boolean[]
  text_input: string
  number_input: number
  /** Index into `right` per element of `left`, same order as `left`. */
  matching: number[]
  /** Category index per item, same order as items. */
  grouping: number[]
  /** Percent of the image size. */
  coords: { x: number; y: number }
  /** Item indices in the chosen order. */
  order: number[]
}

export type AnswerSubmission = {
  [T in QuestionType]: { questionId: string; type: T; answer: AnswerMap[T] }
}[QuestionType]

/** Backend response to a submitted answer. Not final yet. */
export type AnswerResult = {
  correct?: boolean
  /** Proposal: the correct answer, same shape as the submitted answer, so the UI can show what was wrong. */
  solution?: AnswerMap[QuestionType]
}
