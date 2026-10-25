import { mockFetchQuestions, mockSubmitAnswer } from './mock'
import {
  mockAddIslandMember,
  mockCreateIsland,
  mockFetchIslands,
  mockForkIsland,
  mockSubscribePresence,
  mockUploadDocuments,
} from './mockIslands'
import type {
  AnswerResult,
  AnswerSubmission,
  IslandsResponse,
  Presence,
  Question,
  UploadResponse,
} from './types'

// Set VITE_API_URL (e.g. in .env.local) to talk to a real backend, see .env.example.
// Without it, mock data is used.
const API_URL: string | undefined = import.meta.env.VITE_API_URL

/** Whether the app talks to a real backend rather than the mocks. */
export const USES_BACKEND = Boolean(API_URL)

const USER_KEY = 'userId'

// There is no login yet: the backend trusts the user id it is sent (`X-User-Id`). The id comes from
// `PUT /api/users/create` and is kept in localStorage; VITE_USER_ID can preset one.

export function currentUserId(): string | undefined {
  try {
    return localStorage.getItem(USER_KEY) ?? import.meta.env.VITE_USER_ID
  } catch {
    return import.meta.env.VITE_USER_ID
  }
}

export function setCurrentUserId(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(USER_KEY, userId)
    else localStorage.removeItem(USER_KEY)
  } catch {
    // Without storage the id only lives until the page reloads.
  }
}

/** The request names no user, or one the backend does not know. */
export class SignedOutError extends Error {
  constructor() {
    super('not signed in')
  }
}

const ENDPOINTS = {
  // TODO: Placeholders until the bomb game plays over the session websocket.
  questions: '/questions',
  answer: (questionId: string) => `/questions/${encodeURIComponent(questionId)}/answer`,
  createUser: '/api/users/create',
  islands: '/api/islands',
  createIsland: '/api/islands/create',
  members: (islandId: string) => `/api/islands/${encodeURIComponent(islandId)}/members`,
  fork: (islandId: string) => `/api/islands/${encodeURIComponent(islandId)}/fork`,
  upload: (islandId: string) => `/upload?island_id=${encodeURIComponent(islandId)}`,
}

/** The backend's error text: `{"message": …}` from /api, plain text from /upload. */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as { message?: unknown }
    if (typeof body.message === 'string') return body.message
  } catch {
    // not JSON
  }
  return text || `${res.status} ${res.statusText}`
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const userId = currentUserId()
  const headers = new Headers(init?.headers)
  if (userId) headers.set('X-User-Id', userId)
  // A FormData body sets its own multipart content type.
  if (init?.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (res.status === 401) throw new SignedOutError()
  if (!res.ok) throw new Error(await errorMessage(res))
  return res
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init)
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

/** Islands the current user is a member of. */
export function fetchIslands(signal?: AbortSignal): Promise<IslandsResponse> {
  if (!API_URL) return mockFetchIslands()
  if (!currentUserId()) return Promise.reject(new SignedOutError())
  return request(ENDPOINTS.islands, { signal })
}

/** Creates a user and returns its id; the mocks always play as the same user. */
export async function createUser(name: string): Promise<string> {
  if (!API_URL) return 'user-me'
  const { id } = await request<{ id: string }>(ENDPOINTS.createUser, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  return id
}

/** Creates an island for the current user, optionally together with a partner. Returns its id. */
export async function createIsland(name: string, partnerId?: string): Promise<string> {
  const { id } = API_URL
    ? await request<{ id: string }>(ENDPOINTS.createIsland, {
        method: 'PUT',
        body: JSON.stringify({ name, partner_id: partnerId }),
      })
    : await mockCreateIsland(name, partnerId)
  return id
}

/** Adds the second member to an island the current user is on. */
export async function addIslandMember(islandId: string, userId: string): Promise<void> {
  if (!API_URL) return mockAddIslandMember(islandId, userId)
  await send(ENDPOINTS.members(islandId), { method: 'PUT', body: JSON.stringify({ user_id: userId }) })
}

/**
 * Forks an island for the current user and a new partner. The fork shares the houses; each starts
 * as far as both already know its topic. Returns the fork's id.
 */
export async function forkIsland(islandId: string, partnerId: string, name?: string): Promise<string> {
  const { id } = API_URL
    ? await request<{ id: string }>(ENDPOINTS.fork(islandId), {
        method: 'PUT',
        body: JSON.stringify({ partner_id: partnerId, name }),
      })
    : await mockForkIsland(islandId, partnerId, name)
  return id
}

/**
 * Uploads documents to an island. The houses appear once the backend has read the documents and
 * Akasha has generated questions from them, which takes a while.
 */
export function uploadDocuments(islandId: string, files: File[]): Promise<UploadResponse> {
  if (!API_URL) return mockUploadDocuments(islandId, files)
  const body = new FormData()
  for (const file of files) body.append('file', file, file.name)
  return request(ENDPOINTS.upload(islandId), { method: 'POST', body })
}

/**
 * Online status of the given users: called once per user right away, then on every change.
 * Returns a function that stops listening.
 */
export function subscribePresence(userIds: string[], onPresence: (presence: Presence) => void): () => void {
  // TODO: Real presence needs a backend channel (e.g. a websocket like the game session's
  // 'presence' message). Until then everyone else shows as offline.
  if (!API_URL) return mockSubscribePresence(userIds, onPresence)
  for (const userId of userIds) onPresence({ userId, status: 'offline' })
  return () => undefined
}
