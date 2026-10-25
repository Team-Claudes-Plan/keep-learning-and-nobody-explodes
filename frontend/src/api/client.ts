import { subscribeChannelPresence } from './invites'
import { mockFetchQuestions, mockSubmitAnswer } from './mock'
import {
  mockAddIslandMember,
  mockCreateIsland,
  mockFetchIslands,
  mockForkIsland,
  mockSubscribePresence,
} from './mockIslands'
import type {
  AnswerResult,
  AnswerSubmission,
  IslandsResponse,
  Lobby,
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
  sessions: '/api/sessions',
  sessionSocket: '/api/sessions/ws',
  userSocket: '/api/users/ws',
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

/** Games waiting for a second player. */
export function fetchLobbies(signal?: AbortSignal): Promise<Lobby[]> {
  if (!API_URL) return Promise.resolve([])
  return request(ENDPOINTS.sessions, { signal })
}

/**
 * Websocket URL of the game session (schema/session-protocol.md). Browsers cannot set headers on
 * websockets, so the user goes into the query. A relative VITE_API_URL (the dev proxy) is resolved
 * against the page.
 */
export function sessionSocketUrl(userId: string): string {
  return socketUrl(ENDPOINTS.sessionSocket, userId)
}

/** The user's own channel: presence of island partners and game invites (schema/user-channel.md). */
export function userSocketUrl(userId: string): string {
  return socketUrl(ENDPOINTS.userSocket, userId)
}

function socketUrl(path: string, userId: string): string {
  if (!API_URL) throw new Error('no backend configured (VITE_API_URL)')
  const url = new URL(`${API_URL.replace(/\/$/, '')}${path}`, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('user_id', userId)
  return url.toString()
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
 * Online status of the given users: called once per user right away, then on every change.
 * Returns a function that stops listening.
 */
export function subscribePresence(userIds: string[], onPresence: (presence: Presence) => void): () => void {
  if (!API_URL) return mockSubscribePresence(userIds, onPresence)
  // Comes over the user channel; until the backend has it, everyone else shows as offline.
  return subscribeChannelPresence(userIds, onPresence)
}

type UploadOptions = {
  /** Called with the share of bytes sent so far, from 0 to 1. */
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

/** Uploads course documents to an island, all in one multipart request. */
export function uploadDocuments(islandId: string, files: File[], options: UploadOptions = {}): Promise<UploadResponse> {
  if (!API_URL) return mockUploadDocuments(islandId, files, options)

  const body = new FormData()
  for (const file of files) body.append('file', file, file.name)

  // XMLHttpRequest instead of fetch: fetch cannot report upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}${ENDPOINTS.upload(islandId)}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(uploadErrorMessage(xhr)))
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResponse)
      } catch {
        reject(new Error('Upload failed: unexpected response'))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed: network error'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

/** The backend answers errors with a plain-text message. */
function uploadErrorMessage(xhr: XMLHttpRequest): string {
  const message = xhr.responseText.trim()
  if (message) return message
  if (xhr.status === 413) return 'The files are too large'
  return `Upload failed: ${xhr.status}`
}

async function mockUploadDocuments(
  islandId: string,
  files: File[],
  { onProgress, signal }: UploadOptions,
): Promise<UploadResponse> {
  for (let step = 1; step <= 10; step++) {
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError')
    onProgress?.(step / 10)
  }
  return {
    island_id: islandId,
    objects: files.map((file) => ({
      key: `uploads/${islandId}/mock/${file.name}`,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
    })),
    failures: [],
  }
}
