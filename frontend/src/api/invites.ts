import { useEffect, useSyncExternalStore } from 'react'
import { USES_BACKEND, currentUserId, userSocketUrl } from './client'
import { mockIsOnline, mockUser } from './mockIslands'
import type { Presence, PresenceStatus, UserSummary } from './types'

// The user channel: one websocket per signed-in user while the app is open. It tells who of the
// island partners is online and carries game invites. The backend does not have it yet; the
// protocol is proposed in BACKEND_MODIFICATIONS.md. Without a backend a fake server plays Mia.

// ---- Wire format (BACKEND_MODIFICATIONS.md) ----

type ClientMessage =
  | { type: 'invite'; request_id: string; to: string; island_id: string; topic_id: string; storey_id: string; game_id: string }
  | { type: 'answer_invite'; invite_id: string; accept: boolean }
  | { type: 'cancel_invite'; invite_id: string }

type ServerMessage =
  | { type: 'presence'; user_id: string; online: boolean }
  | { type: 'invite_sent'; request_id: string; invite_id: string }
  | {
      type: 'invite'
      invite_id: string
      from: UserSummary
      island_id: string
      topic_id: string
      storey_id: string
      game_id: string
    }
  | { type: 'invite_answered'; invite_id: string; accepted: boolean }
  | { type: 'invite_cancelled'; invite_id: string }
  | { type: 'error'; request_id?: string; code: string; message: string }

// ---- What the app sees ----

export type Invite = {
  id: string
  from: UserSummary
  islandId: string
  topicId: string
  storeyId: string
  /** The game to join: a session id with a backend, a koop seed without. */
  gameId: string
}

export type InviteRequest = Omit<Invite, 'id' | 'from'> & { to: string }

/** How an invite I sent ended. `lost`: the channel dropped before an answer came. */
export type InviteOutcome = 'accepted' | 'declined' | 'cancelled' | 'lost'

export type ChannelConnection = 'connecting' | 'open' | 'offline'

export type ChannelState = {
  connection: ChannelConnection
  /** Only users the server reported; everyone else is offline. */
  online: Record<string, boolean>
  /** Invites to me, oldest first. */
  incoming: Invite[]
}

export class InviteError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

type Transport = { send(message: ClientMessage): void; close(): void }
type TransportEvents = { open(): void; message(message: ServerMessage): void; close(): void }

const RETRY_MS = [1000, 2000, 5000, 10000, 30000]
const REQUEST_TIMEOUT_MS = 10000

class UserChannel {
  private state: ChannelState = { connection: 'connecting', online: {}, incoming: [] }
  private listeners = new Set<() => void>()
  private transport: Transport | null = null
  private attempt = 0
  private retryTimer: number | undefined
  private nextRequest = 1
  private requests = new Map<string, { resolve(id: string): void; reject(error: Error): void }>()
  private outgoing = new Map<string, (outcome: InviteOutcome) => void>()
  private started = false

  getState = () => this.state

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Connects once; the channel then stays open (and reconnects) while the app runs. */
  start() {
    if (this.started) return
    this.started = true
    this.connect()
  }

  private set(patch: Partial<ChannelState>) {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private connect() {
    this.set({ connection: 'connecting' })
    const events: TransportEvents = {
      open: () => {
        this.attempt = 0
        this.set({ connection: 'open' })
      },
      message: (message) => this.handle(message),
      close: () => this.dropped(),
    }
    if (!USES_BACKEND) {
      this.transport = new MockServer(events)
      return
    }
    const userId = currentUserId()
    if (!userId) {
      // Not signed in yet: try again later, the id may appear (e.g. after creating a user).
      this.transport = null
      this.dropped()
      return
    }
    this.transport = socketTransport(userSocketUrl(userId), events)
  }

  /** Everything tied to the connection is gone; the server sends presence and open invites again. */
  private dropped() {
    this.transport = null
    for (const { reject } of this.requests.values()) reject(new InviteError('offline', 'Keine Verbindung zum Server.'))
    this.requests.clear()
    for (const done of this.outgoing.values()) done('lost')
    this.outgoing.clear()
    this.set({ connection: 'offline', online: {}, incoming: [] })
    const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]
    this.attempt++
    window.clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => this.connect(), delay)
  }

  private handle(message: ServerMessage) {
    switch (message.type) {
      case 'presence':
        if (this.state.online[message.user_id] !== message.online) {
          this.set({ online: { ...this.state.online, [message.user_id]: message.online } })
        }
        break
      case 'invite_sent':
        this.requests.get(message.request_id)?.resolve(message.invite_id)
        this.requests.delete(message.request_id)
        break
      case 'invite': {
        if (this.state.incoming.some((invite) => invite.id === message.invite_id)) break
        const invite: Invite = {
          id: message.invite_id,
          from: message.from,
          islandId: message.island_id,
          topicId: message.topic_id,
          storeyId: message.storey_id,
          gameId: message.game_id,
        }
        this.set({ incoming: [...this.state.incoming, invite] })
        break
      }
      case 'invite_answered':
        this.finish(message.invite_id, message.accepted ? 'accepted' : 'declined')
        break
      case 'invite_cancelled':
        // Either the inviter took it back (I am the invitee) or the server dropped mine.
        this.removeIncoming(message.invite_id)
        this.finish(message.invite_id, 'cancelled')
        break
      case 'error': {
        const request = message.request_id ? this.requests.get(message.request_id) : undefined
        if (request && message.request_id) {
          request.reject(new InviteError(message.code, message.message))
          this.requests.delete(message.request_id)
        }
        break
      }
    }
  }

  private finish(inviteId: string, outcome: InviteOutcome) {
    const done = this.outgoing.get(inviteId)
    this.outgoing.delete(inviteId)
    done?.(outcome)
  }

  private removeIncoming(inviteId: string) {
    if (!this.state.incoming.some((invite) => invite.id === inviteId)) return
    this.set({ incoming: this.state.incoming.filter((invite) => invite.id !== inviteId) })
  }

  /** Sends an invite; resolves with its id once the server passed it on. `onOutcome` fires once. */
  invite(request: InviteRequest, onOutcome: (outcome: InviteOutcome) => void): Promise<string> {
    const transport = this.transport
    if (!transport || this.state.connection !== 'open') {
      return Promise.reject(new InviteError('offline', 'Keine Verbindung zum Server.'))
    }
    const requestId = `r${this.nextRequest++}`
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.requests.delete(requestId)
        reject(new InviteError('timeout', 'Der Server antwortet nicht.'))
      }, REQUEST_TIMEOUT_MS)
      this.requests.set(requestId, {
        resolve: (inviteId) => {
          window.clearTimeout(timer)
          this.outgoing.set(inviteId, onOutcome)
          resolve(inviteId)
        },
        reject: (error) => {
          window.clearTimeout(timer)
          reject(error)
        },
      })
      transport.send({
        type: 'invite',
        request_id: requestId,
        to: request.to,
        island_id: request.islandId,
        topic_id: request.topicId,
        storey_id: request.storeyId,
        game_id: request.gameId,
      })
    })
  }

  /** Takes back an invite I sent. */
  cancel(inviteId: string) {
    this.outgoing.delete(inviteId)
    this.transport?.send({ type: 'cancel_invite', invite_id: inviteId })
  }

  /** Accepts or declines an invite to me. */
  answer(inviteId: string, accept: boolean) {
    this.removeIncoming(inviteId)
    this.transport?.send({ type: 'answer_invite', invite_id: inviteId, accept })
  }
}

function socketTransport(url: string, events: TransportEvents): Transport {
  const socket = new WebSocket(url)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    events.close()
  }
  socket.onopen = () => events.open()
  socket.onmessage = (event) => {
    try {
      events.message(JSON.parse(String(event.data)) as ServerMessage)
    } catch {
      // Not a message of ours.
    }
  }
  socket.onerror = close
  socket.onclose = close
  return {
    send: (message) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    },
    close: () => {
      socket.onclose = null
      socket.close()
    },
  }
}

// ---- The fake server for running without a backend ----

const MOCK_PARTNERS = ['user-mia', 'user-leo']
const MOCK_ANSWER_MS = 3000

/**
 * Plays the server and the partners: reports the mock presence, and an online partner accepts
 * every invite after a few seconds. `window.mockInvite()` lets Mia invite you.
 */
class MockServer implements Transport {
  private timers = new Set<number>()
  private online: Record<string, boolean> = {}
  private nextId = 1
  private readonly events: TransportEvents

  constructor(events: TransportEvents) {
    this.events = events
    this.later(0, () => {
      events.open()
      this.reportPresence()
    })
    const poll = window.setInterval(() => this.reportPresence(), 1000)
    this.timers.add(poll)
    ;(window as unknown as { mockInvite?: () => void }).mockInvite = () => this.inviteMe()
  }

  private later(ms: number, run: () => void) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer)
      run()
    }, ms)
    this.timers.add(timer)
  }

  private reportPresence() {
    for (const userId of MOCK_PARTNERS) {
      const online = mockIsOnline(userId)
      if (this.online[userId] === online) continue
      this.online[userId] = online
      this.events.message({ type: 'presence', user_id: userId, online })
    }
  }

  private inviteMe() {
    const from = mockUser('user-mia') ?? { id: 'user-mia', name: 'Mia' }
    this.events.message({
      type: 'invite',
      invite_id: `mock-${this.nextId++}`,
      from,
      island_id: 'with-mia',
      topic_id: 'topic-calculus',
      storey_id: 'ground',
      game_id: String(Math.floor(100000 + Math.random() * 900000)),
    })
  }

  send(message: ClientMessage) {
    if (message.type !== 'invite') return
    if (!mockIsOnline(message.to)) {
      const name = mockUser(message.to)?.name ?? 'Dein Partner'
      this.later(100, () =>
        this.events.message({
          type: 'error',
          request_id: message.request_id,
          code: 'partner_offline',
          message: `${name} ist offline.`,
        }),
      )
      return
    }
    const inviteId = `mock-${this.nextId++}`
    this.later(150, () => this.events.message({ type: 'invite_sent', request_id: message.request_id, invite_id: inviteId }))
    this.later(MOCK_ANSWER_MS, () => this.events.message({ type: 'invite_answered', invite_id: inviteId, accepted: true }))
  }

  close() {
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers.clear()
  }
}

// ---- Shared instance and hooks ----

const channel = new UserChannel()

export function startUserChannel() {
  channel.start()
}

export function sendInvite(request: InviteRequest, onOutcome: (outcome: InviteOutcome) => void): Promise<string> {
  channel.start()
  return channel.invite(request, onOutcome)
}

export function cancelInvite(inviteId: string) {
  channel.cancel(inviteId)
}

export function answerInvite(inviteId: string, accept: boolean) {
  channel.answer(inviteId, accept)
}

export function channelState(): ChannelState {
  return channel.getState()
}

/** The user channel's state; connects it on first use. */
export function useUserChannel(): ChannelState {
  useEffect(() => channel.start(), [])
  return useSyncExternalStore(channel.subscribe, channel.getState)
}

export function presenceOf(state: ChannelState, userId: string): PresenceStatus {
  return state.online[userId] ? 'online' : 'offline'
}

/** Presence over the user channel, in the shape of `subscribePresence`. */
export function subscribeChannelPresence(userIds: string[], onPresence: (presence: Presence) => void): () => void {
  channel.start()
  const last: Record<string, PresenceStatus> = {}
  const report = () => {
    const state = channel.getState()
    for (const userId of userIds) {
      const status = presenceOf(state, userId)
      if (last[userId] === status) continue
      last[userId] = status
      onPresence({ userId, status })
    }
  }
  report()
  return channel.subscribe(report)
}
