import type { AnswerMap, AnswerResult, AnswerSubmission, Question, QuestionType } from './types'

const QUESTIONS: Question[] = [
  {
    type: 'single_choice',
    id: 'mock-single-1',
    prompt: 'Wie viele Bits hat ein Byte?',
    options: ['4', '8', '16', '32'],
  },
  {
    type: 'single_choice',
    id: 'mock-single-2',
    prompt: 'Welcher Planet ist der Sonne am nächsten?',
    options: ['Venus', 'Merkur', 'Mars', 'Erde'],
  },
  {
    type: 'multiple_choice',
    id: 'mock-multi-1',
    prompt: 'Welche Zahlen sind Primzahlen?',
    options: ['2', '4', '7', '9', '11'],
  },
  {
    type: 'multiple_choice',
    id: 'mock-multi-2',
    prompt: 'Welche davon sind Programmiersprachen?',
    options: ['Rust', 'HTML', 'Python', 'JSON'],
  },
  {
    type: 'true_false',
    id: 'mock-tf-1',
    statements: [
      'Wasser kocht auf Meereshöhe bei 100 °C.',
      'Spinnen sind Insekten.',
      'Licht ist schneller als Schall.',
    ],
  },
  {
    type: 'text_input',
    id: 'mock-text-1',
    prompt: 'Wie heißt die Hauptstadt von Frankreich?',
  },
  {
    type: 'number_input',
    id: 'mock-num-1',
    prompt: 'Wie viele Minuten hat ein Tag?',
    unit: 'min',
  },
  {
    type: 'number_input',
    id: 'mock-num-2',
    prompt: 'Wie viele Beine hat eine Spinne?',
    unit: null,
  },
  {
    type: 'matching',
    id: 'mock-match-1',
    left: ['Deutschland', 'Italien', 'Spanien'],
    right: ['Madrid', 'Berlin', 'Rom'],
  },
  {
    type: 'grouping',
    id: 'mock-group-1',
    categories: ['Säugetier', 'Vogel'],
    items: ['Hund', 'Adler', 'Wal', 'Pinguin', 'Fledermaus'],
  },
  {
    type: 'text_input',
    id: 'mock-text-2',
    prompt: 'Welches chemische Element hat das Symbol „Fe“?',
  },
  {
    type: 'coords',
    id: 'mock-coords-1',
    prompt: 'Wo ist das weiße X?',
    image: '/mock/radar.svg',
  },
  {
    type: 'coords',
    id: 'mock-coords-2',
    prompt: 'Wo ist das gelbe Quadrat?',
    image: '/mock/radar.svg',
  },
  {
    type: 'order',
    id: 'mock-order-1',
    prompt: 'Ordne chronologisch.',
    items: ['Mittelalter', 'Antike', 'Neuzeit'],
  },
  {
    type: 'order',
    id: 'mock-order-2',
    prompt: 'Ordne die Planeten nach Abstand zur Sonne.',
    items: ['Erde', 'Merkur', 'Mars', 'Venus'],
  },
  {
    type: 'matching',
    id: 'mock-match-2',
    left: ['HTML', 'CSS', 'SQL', 'Rust'],
    right: ['Datenbank', 'Struktur', 'Systeme', 'Gestaltung'],
  },
  {
    type: 'grouping',
    id: 'mock-group-2',
    categories: ['Obst', 'Gemüse', 'Getreide'],
    items: ['Apfel', 'Karotte', 'Weizen', 'Banane', 'Gurke', 'Hafer'],
  },
  {
    type: 'true_false',
    id: 'mock-tf-2',
    statements: ['Die Erde ist eine Scheibe.', 'Ein Jahr hat 12 Monate.'],
  },
]

// Target centers in percent, accepted within COORDS_TOLERANCE.
const COORDS_TARGETS: Record<string, { x: number; y: number }> = {
  'mock-coords-1': { x: 70, y: 30 },
  'mock-coords-2': { x: 41.25, y: 45 },
}
const COORDS_TOLERANCE = 8

// Mock-only solutions so the UI can give feedback without a backend.
const SOLUTIONS: Record<string, AnswerMap[QuestionType]> = {
  'mock-single-1': 1,
  'mock-single-2': 1,
  'mock-multi-1': [0, 2, 4],
  'mock-multi-2': [0, 2],
  'mock-tf-1': [true, false, true],
  'mock-text-1': 'Paris',
  'mock-text-2': 'Eisen',
  'mock-order-2': [1, 3, 0, 2],
  'mock-match-2': [1, 3, 0, 2],
  'mock-group-2': [0, 1, 2, 0, 1, 2],
  'mock-tf-2': [false, true],
  'mock-num-1': 1440,
  'mock-num-2': 8,
  'mock-match-1': [1, 2, 0],
  'mock-group-1': [0, 1, 0, 1, 0],
  'mock-order-1': [1, 0, 2],
}

function normalize(submission: AnswerSubmission): unknown {
  if (submission.type === 'text_input') return submission.answer.trim().toLowerCase()
  if (submission.type === 'multiple_choice') return [...submission.answer].sort((a, b) => a - b)
  return submission.answer
}

function sameAnswer(submission: AnswerSubmission, solution: AnswerMap[QuestionType]) {
  const expected = { ...submission, answer: solution } as AnswerSubmission
  return JSON.stringify(normalize(submission)) === JSON.stringify(normalize(expected))
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function mockFetchQuestions(): Promise<Question[]> {
  await delay(200)
  return structuredClone(QUESTIONS)
}

export async function mockSubmitAnswer(submission: AnswerSubmission): Promise<AnswerResult> {
  console.info('[mock] submitAnswer', submission)
  await delay(200)
  if (submission.type === 'coords') {
    const target = COORDS_TARGETS[submission.questionId]
    if (!target) return {}
    const { x, y } = submission.answer
    return { correct: Math.hypot(x - target.x, y - target.y) <= COORDS_TOLERANCE, solution: target }
  }
  const solution = SOLUTIONS[submission.questionId]
  if (solution === undefined) return {}
  return { correct: sameAnswer(submission, solution), solution }
}
