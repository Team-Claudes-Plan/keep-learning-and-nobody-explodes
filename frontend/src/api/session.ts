// Client of the game session websocket, see schema/session-protocol.md.
//
// The server runs the game: it picks the questions, keeps the time, judges answers and counts
// strikes. A SessionClient keeps one socket to one game, folds what the server sends into a
// SessionState and reconnects with `resume` when the connection drops. Pages read the state with
// useSession and send answers through the client.

import { useSyncExternalStore } from 'react'
import { currentUserId, sessionSocketUrl } from './client'
import type {
  GameEvent,
  GameView,
  Role,
  SessionAnswer,
  SessionClientMessage,
  SessionErrorCode,
  SessionServerMessage,
} from './types'

export type Briefing = Extract<SessionServerMessage, { type: 'briefing' }>
export type AnswerEvent = Extract<GameEvent, { type: 'answer_submitted' }>

export type Connection =
  /** Socket opening, or waiting for the answer to create/join/resume. */
  | 'connecting'
  /** In the game, updates arrive live. */
  | 'open'
  /** The socket dropped; trying to resume. */
  | 'reconnecting'
  /** Could not enter the game (see `error`); no more attempts. */
  | 'failed'
  | 'closed'

export type SessionError = { code: SessionErrorCode | 'connection'; message: string }

export type SessionState = {
  connection: Connection
  gameId: string | null
  /** The own player id (= user id). */
  playerId: string | null
  /** The game as last seen: a snapshot with every later event applied. */
  game: GameView | null
  /** What the own role gets to see this turn. */
  briefing: Briefing | null
  /** The latest judged answer, for feedback. */
  lastAnswer: AnswerEvent | null
  /** The latest error the server sent (or a connection problem). */
  error: SessionError | null
}

/** The server refused create, join or resume, or the connection failed before (`code: 'connection'`). */
export class SessionRefused extends Error {
  readonly code: SessionError['code']
  constructor(code: SessionError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export type CreateOptions = {
  topics: string[]
  questionCount: number
  role?: Role
  timeLimitSecs?: number
  /** A storey game: the skill of the storey and the island it is played on. */
  storey?: { skillId: string; islandId: string }
  /** Only this user may join. */
  invited?: string
}

const OVER: GameView['status'][] = ['won', 'lost', 'aborted']

export function isOver(game: GameView | null): boolean {
  return game !== null && OVER.includes(game.status)
}

// The token from `welcome` is the only way back into a game, so it is kept per game.

type Credentials = { token: string; playerId: string }

const tokenKey = (gameId: string) => `session:${gameId}`

export function storedCredentials(gameId: string): Credentials | null {
  try {
    const raw = localStorage.getItem(tokenKey(gameId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Credentials>
    // the token only works for the user it was issued to
    const userId = currentUserId()
    if (typeof value.token !== 'string' || !userId || value.playerId !== userId) return null
    return { token: value.token, playerId: userId }
  } catch {
    return null
  }
}

function storeCredentials(gameId: string, credentials: Credentials | null) {
  try {
    if (credentials) localStorage.setItem(tokenKey(gameId), JSON.stringify(credentials))
    else localStorage.removeItem(tokenKey(gameId))
  } catch {
    // Without storage a reload cannot get back into the game, the open socket still works.
  }
}

/** Applies one logged event to the game. */
function applyEvent(game: GameView, event: GameEvent, sequence: number): GameView {
  const next: GameView = { ...game, last_sequence: sequence }
  switch (event.type) {
    case 'game_created':
      return {
        ...next,
        status: 'waiting',
        topics: event.topics,
        skill_id: event.skill_id ?? null,
        invited: event.invited ?? null,
        players: [{ player_id: event.created_by, seat: 0, online: true, ready: false }],
        parts: event.parts.map((part) => ({ position: part.position, question_type: part.question_type, result: null })),
      }
    case 'player_joined':
      return {
        ...next,
        players: [
          ...game.players.filter((player) => player.player_id !== event.player_id),
          { player_id: event.player_id, seat: event.seat, online: true, ready: false },
        ].sort((a, b) => a.seat - b.seat),
      }
    case 'roles_assigned':
      return { ...next, status: 'ready', defuser: event.defuser, expert: event.expert }
    case 'player_ready':
      return {
        ...next,
        players: game.players.map((player) => (player.player_id === event.player_id ? { ...player, ready: true } : player)),
      }
    case 'game_started':
      return {
        ...next,
        status: 'active',
        deadline: event.deadline,
        players: game.players.map((player) => ({ ...player, ready: true })),
      }
    case 'turn_started':
      return { ...next, turn: event.turn, defuser: event.defuser, expert: event.expert }
    case 'answer_submitted':
      return {
        ...next,
        strikes: event.strikes,
        parts: game.parts.map((part) =>
          part.position === event.turn ? { ...part, result: event.correct ? 'solved' : 'failed' } : part,
        ),
      }
    case 'game_ended':
      return { ...next, status: event.outcome, reason: event.reason }
  }
}

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

/** One player's connection to one game. */
export class SessionClient {
  private state: SessionState
  private readonly listeners = new Set<() => void>()
  private socket: WebSocket | null = null
  /** The first message: create or join; afterwards always resume. */
  private entry: SessionClientMessage | null
  /** Inside the game: create/join/resume was accepted. */
  private entered = false
  private retries = 0
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private onWelcome: ((gameId: string) => void) | null = null

  constructor(entry: SessionClientMessage, gameId: string | null = null) {
    this.entry = entry
    this.state = {
      connection: 'connecting',
      gameId,
      playerId: null,
      game: null,
      briefing: null,
      lastAnswer: null,
      error: null,
    }
    this.connect()
  }

  getState = (): SessionState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Resolves with the game id once the server accepted create or join. */
  welcomed(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.state.gameId && this.entered) return resolve(this.state.gameId)
      this.onWelcome = resolve
      const stop = this.subscribe(() => {
        if (this.state.connection === 'failed' || this.state.connection === 'closed') {
          stop()
          const error = this.state.error
          reject(new SessionRefused(error?.code ?? 'connection', error?.message ?? 'connection closed'))
        } else if (this.entered) stop()
      })
    })
  }

  submitAnswer(turn: number, answer: SessionAnswer): boolean {
    return this.send({ type: 'submit_answer', turn, answer })
  }

  /** Ready to play; the game starts once both players are. */
  ready(): boolean {
    return this.send({ type: 'ready' })
  }

  forfeit(): boolean {
    return this.send({ type: 'forfeit' })
  }

  close() {
    this.closed = true
    clearTimeout(this.retryTimer)
    this.socket?.close()
    this.socket = null
    this.update({ connection: 'closed' })
  }

  private update(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private send(message: SessionClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.entered) {
      this.update({ error: { code: 'connection', message: 'Keine Verbindung zum Server.' } })
      return false
    }
    this.socket.send(JSON.stringify(message))
    return true
  }

  /** The message that gets this socket into the game. */
  private firstMessage(): SessionClientMessage | null {
    if (this.entry) return this.entry
    const { gameId, game } = this.state
    const credentials = gameId ? storedCredentials(gameId) : null
    if (!gameId || !credentials) return null
    // Knowing the game, only the missed events are needed.
    const lastSequence = game?.last_sequence ?? undefined
    return { type: 'resume', game_id: gameId, token: credentials.token, last_sequence: lastSequence }
  }

  private connect() {
    const userId = currentUserId()
    const first = this.firstMessage()
    if (!userId || !first) {
      this.fail({ code: 'connection', message: userId ? 'Kein Zugang zu diesem Spiel.' : 'Nicht angemeldet.' })
      return
    }
    let socket: WebSocket
    try {
      socket = new WebSocket(sessionSocketUrl(userId))
    } catch (error) {
      this.fail({ code: 'connection', message: error instanceof Error ? error.message : String(error) })
      return
    }
    this.socket = socket
    this.entered = false
    socket.onopen = () => socket.send(JSON.stringify(first))
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return
      try {
        this.receive(JSON.parse(event.data) as SessionServerMessage)
      } catch (error) {
        console.error('bad session message', error)
      }
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      this.dropped()
    }
  }

  /** The socket closed without us closing it. */
  private dropped() {
    if (this.closed) return
    const canResume = this.state.gameId !== null && storedCredentials(this.state.gameId) !== null
    if (isOver(this.state.game) || (!this.entered && this.entry) || !canResume) {
      // Lost before the server accepted create/join: nothing to resume.
      if (this.state.connection !== 'failed') {
        this.update({
          connection: isOver(this.state.game) ? 'closed' : 'failed',
          error: this.state.error ?? { code: 'connection', message: 'Verbindung zum Server fehlgeschlagen.' },
        })
      }
      return
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.retries, RETRY_DELAYS_MS.length - 1)]
    this.retries++
    this.update({ connection: 'reconnecting' })
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  private fail(error: SessionError) {
    this.closed = true
    clearTimeout(this.retryTimer)
    const socket = this.socket
    this.socket = null
    socket?.close()
    this.update({ connection: 'failed', error })
  }

  private enter() {
    if (this.entered) return
    this.entered = true
    this.retries = 0
    // From now on a lost connection resumes.
    this.entry = null
    this.update({ connection: 'open', error: null })
  }

  private receive(message: SessionServerMessage) {
    switch (message.type) {
      case 'welcome': {
        storeCredentials(message.game_id, { token: message.token, playerId: message.player_id })
        this.update({ gameId: message.game_id, playerId: message.player_id })
        this.enter()
        this.onWelcome?.(message.game_id)
        this.onWelcome = null
        return
      }
      case 'snapshot': {
        this.enter()
        const { briefing } = this.state
        const game = message.state
        this.update({
          game,
          gameId: game.game_id,
          playerId: this.state.playerId ?? storedCredentials(game.game_id)?.playerId ?? currentUserId() ?? null,
          // a briefing of an earlier turn no longer applies
          briefing: briefing && briefing.turn === game.turn ? briefing : null,
        })
        return
      }
      case 'event': {
        this.enter()
        const { game } = this.state
        // replays may overlap with what is already known
        if (!game || (game.last_sequence !== null && message.sequence <= game.last_sequence)) return
        const { event } = message
        const patch: Partial<SessionState> = { game: applyEvent(game, event, message.sequence) }
        if (event.type === 'turn_started' && this.state.briefing?.turn !== event.turn) patch.briefing = null
        if (event.type === 'answer_submitted') patch.lastAnswer = event
        this.update(patch)
        return
      }
      case 'briefing':
        this.enter()
        this.update({ briefing: message })
        return
      case 'presence': {
        const { game } = this.state
        if (!game) return
        this.update({
          game: {
            ...game,
            players: game.players.map((player) =>
              player.player_id === message.player_id ? { ...player, online: message.online } : player,
            ),
          },
        })
        return
      }
      case 'error': {
        const error = { code: message.code, message: message.message }
        if (this.entered) {
          // answers a single message, the game goes on
          this.update({ error })
          return
        }
        // create, join or resume was refused
        if (message.code === 'invalid_token' && this.state.gameId) storeCredentials(this.state.gameId, null)
        this.fail(error)
        return
      }
    }
  }
}

// Clients are shared by game id: the page that creates a game hands its open socket to the game
// page, and React's StrictMode remounts do not reconnect.

type Entry = { client: SessionClient; refs: number }
const clients = new Map<string, Entry>()

/**
 * The client for a game, connecting if there is none yet: with the stored token it resumes,
 * otherwise it joins (as `role`, if given). Pair every call with releaseSession.
 */
export function acquireSession(gameId: string, role?: Role): SessionClient {
  let entry = clients.get(gameId)
  if (!entry || entry.client.getState().connection === 'failed' || entry.client.getState().connection === 'closed') {
    const credentials = storedCredentials(gameId)
    const first: SessionClientMessage = credentials
      ? { type: 'resume', game_id: gameId, token: credentials.token }
      : { type: 'join', game_id: gameId, role }
    entry = { client: new SessionClient(first, gameId), refs: 0 }
    clients.set(gameId, entry)
  }
  entry.refs++
  return entry.client
}

/** Closes the client once nobody uses it any more (after a tick, so a remount can take it over). */
export function releaseSession(client: SessionClient) {
  for (const [gameId, entry] of clients) {
    if (entry.client !== client) continue
    entry.refs--
    setTimeout(() => {
      if (entry.refs > 0 || clients.get(gameId) !== entry) return
      clients.delete(gameId)
      client.close()
    }, 0)
  }
}

/** Opens a new game and resolves with its id; the open socket waits for acquireSession. */
export async function createSession(options: CreateOptions): Promise<string> {
  const client = new SessionClient({
    type: 'create',
    topics: options.topics,
    question_count: options.questionCount,
    role: options.role,
    time_limit_secs: options.timeLimitSecs,
    skill_id: options.storey?.skillId,
    island_id: options.storey?.islandId,
    invited: options.invited,
  })
  try {
    const gameId = await client.welcomed()
    clients.set(gameId, { client, refs: 0 })
    return gameId
  } catch (error) {
    client.close()
    throw error
  }
}

export function useSession(client: SessionClient): SessionState {
  return useSyncExternalStore(client.subscribe, client.getState)
}
