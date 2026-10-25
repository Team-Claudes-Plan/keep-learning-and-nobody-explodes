import { mockFetchQuestions, mockSubmitAnswer } from './mock'
import { mockFetchIslands, mockSubscribePresence } from './mockIslands'
import type { AnswerResult, AnswerSubmission, IslandsResponse, Presence, Question, UploadResponse } from './types'

// Set VITE_API_URL (e.g. in .env.local) to talk to a real backend.
// Without it, mock data is used.
const API_URL: string | undefined = import.meta.env.VITE_API_URL

// TODO: Endpoints are placeholders until the backend contract is fixed.
const ENDPOINTS = {
  questions: '/questions',
  answer: (questionId: string) => `/questions/${encodeURIComponent(questionId)}/answer`,
  islands: '/islands',
  upload: (islandId: string) => `/upload?island_id=${encodeURIComponent(islandId)}`,
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

/** Islands of the learning groups the current user belongs to. */
export function fetchIslands(signal?: AbortSignal): Promise<IslandsResponse> {
  if (!API_URL) return mockFetchIslands()
  return request(ENDPOINTS.islands, { signal })
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
