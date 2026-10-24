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

export type AnswerMap = {
  single_choice: { optionIndex: number }
  multiple_choice: { optionIndices: number[] }
  /** One value per statement, same order. */
  true_false: { values: boolean[] }
  text_input: { text: string }
  number_input: { value: number }
  matching: { pairs: { left: number; right: number }[] }
  /** Category index per item, same order as items. */
  grouping: { assignments: number[] }
  /** Percent of the image size. */
  coords: { x: number; y: number }
  /** Item indices in the chosen order. */
  order: { order: number[] }
}

export type AnswerSubmission = {
  [T in QuestionType]: { questionId: string; type: T; answer: AnswerMap[T] }
}[QuestionType]

/** Backend response to a submitted answer. Not final yet. */
export type AnswerResult = {
  correct?: boolean
}
