import { mockFetchQuestions, mockSubmitAnswer } from './mock'
import type { AnswerResult, AnswerSubmission, Question } from './types'

// Set VITE_API_URL (e.g. in .env.local) to talk to a real backend.
// Without it, mock data is used.
const API_URL: string | undefined = import.meta.env.VITE_API_URL

// TODO: Endpoints are placeholders until the backend contract is fixed.
const ENDPOINTS = {
  questions: '/questions',
  answer: (questionId: string) => `/questions/${encodeURIComponent(questionId)}/answer`,
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export function fetchQuestions(signal?: AbortSignal): Promise<Question[]> {
  if (!API_URL) return mockFetchQuestions()
  return request(ENDPOINTS.questions, { signal })
}

export function submitAnswer(submission: AnswerSubmission): Promise<AnswerResult> {
  if (!API_URL) return mockSubmitAnswer(submission)
  return request(ENDPOINTS.answer(submission.questionId), {
    method: 'POST',
    body: JSON.stringify(submission),
  })
}
