import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { USES_BACKEND } from '../api/client'
import { InviteError, cancelInvite, channelState, presenceOf, sendInvite, useUserChannel } from '../api/invites'
import { acquireSession, createSession, releaseSession, type SessionClient } from '../api/session'
import type { UserSummary } from '../api/types'

/** The bomb an invite starts: the house's topic, a few modules, five minutes. */
const SESSION_MODULES = 5
const SESSION_SECONDS = 300
/** An invite nobody answers is taken back. */
const INVITE_TIMEOUT_MS = 60000

export type InviteFlow =
  | { step: 'idle' }
  | { step: 'starting' }
  | { step: 'waiting'; partner: UserSummary }
  | { step: 'error'; title: string; message: string }

type Target = { islandId: string; topicId: string; storeyId: string }

/** Where each player goes once the invite is accepted: the inviter defuses, the invitee reads. */
export function gamePath(gameId: string, role: 'defuser' | 'expert'): string {
  if (USES_BACKEND) return role === 'defuser' ? `/koop/spiel/${gameId}` : `/koop/spiel/${gameId}?rolle=expert`
  // Without a backend the seeded koop plays the game: both sides build the bomb from the seed.
  return role === 'defuser' ? `/koop/${gameId}/bombe` : `/koop/${gameId}/handbuch`
}

/** A random koop seed, standing in for a game id without a backend. */
function mockGameId() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

type Pending = { inviteId: string | null; client: SessionClient | null; timer: number | undefined; done: boolean }

/**
 * Starting a game from a storey: check that the partner is online, open the game, invite them and
 * wait. On accept the inviter goes to the bomb; decline, timeout or leaving the page cancel the game.
 */
export function useInviteFlow(partner: UserSummary | null, target: Target | null) {
  const navigate = useNavigate()
  const channel = useUserChannel()
  const [flow, setFlow] = useState<InviteFlow>({ step: 'idle' })
  const pending = useRef<Pending | null>(null)

  /** Ends the waiting: takes back the invite and gives up the game, unless it was handed over. */
  const teardown = useCallback((handover: boolean) => {
    const current = pending.current
    if (!current) return
    pending.current = null
    current.done = true
    window.clearTimeout(current.timer)
    if (!handover) {
      if (current.inviteId) cancelInvite(current.inviteId)
      current.client?.forfeit()
    }
    const client = current.client
    if (!client) return
    // On handover the game page takes the socket over; give it time to mount first.
    if (handover) window.setTimeout(() => releaseSession(client), 2000)
    else releaseSession(client)
  }, [])

  // Leaving the storey while waiting cancels the invite.
  useEffect(() => () => teardown(false), [teardown])

  // A different room was picked: start over there.
  const targetKey = target ? `${target.islandId}/${target.topicId}/${target.storeyId}` : ''
  useEffect(() => {
    teardown(false)
    setFlow({ step: 'idle' })
  }, [targetKey, teardown])

  const fail = useCallback(
    (title: string, message: string) => {
      teardown(false)
      setFlow({ step: 'error', title, message })
    },
    [teardown],
  )

  const start = useCallback(async () => {
    if (!target || pending.current) return
    if (!partner) {
      setFlow({
        step: 'error',
        title: 'Allein geht das nicht',
        message: 'Auf dieser Insel bist du allein. Hol dir jemanden auf die Insel, dann entschärft ihr zu zweit.',
      })
      return
    }
    const state = channelState()
    if (state.connection !== 'open') {
      setFlow({
        step: 'error',
        title: 'Funkstille',
        message: 'Keine Verbindung zum Server, Einladungen kommen gerade nicht an. Versuch es gleich nochmal.',
      })
      return
    }
    if (presenceOf(state, partner.id) !== 'online') {
      setFlow({
        step: 'error',
        title: `${partner.name} ist offline`,
        message: `Ohne Experten kein Entschärfen. Sobald ${partner.name} online ist, kannst du die Session starten.`,
      })
      return
    }

    const current: Pending = { inviteId: null, client: null, timer: undefined, done: false }
    pending.current = current
    setFlow({ step: 'starting' })

    const accepted = (gameId: string) => {
      if (current.done) return
      teardown(true)
      setFlow({ step: 'idle' })
      navigate(gamePath(gameId, 'defuser'))
    }

    try {
      let gameId: string
      if (USES_BACKEND) {
        gameId = await createSession({
          topics: [target.topicId],
          questionCount: SESSION_MODULES,
          role: 'defuser',
          timeLimitSecs: SESSION_SECONDS,
        })
        // Hold the game's socket until the inviter moves on to the game page.
        const client = acquireSession(gameId)
        if (current.done) {
          client.forfeit()
          releaseSession(client)
          return
        }
        current.client = client
        // The partner joining starts the game, even if the accept message got lost on the way.
        const unsubscribe = client.subscribe(() => {
          if (client.getState().game?.status === 'active') {
            unsubscribe()
            accepted(gameId)
          }
        })
      } else {
        gameId = mockGameId()
      }
      if (current.done) return

      const inviteId = await sendInvite(
        { to: partner.id, islandId: target.islandId, topicId: target.topicId, storeyId: target.storeyId, gameId },
        (outcome) => {
          if (current.done) return
          if (outcome === 'accepted') accepted(gameId)
          else if (outcome === 'declined') fail('Abgelehnt', `${partner.name} hat die Einladung abgelehnt.`)
          else if (outcome === 'cancelled') fail('Einladung verfallen', 'Die Einladung gilt nicht mehr.')
          else fail('Verbindung verloren', 'Die Verbindung zum Server ist abgerissen. Starte die Session neu.')
        },
      )
      if (current.done) {
        cancelInvite(inviteId)
        return
      }
      current.inviteId = inviteId
      current.timer = window.setTimeout(
        () => fail('Keine Antwort', `${partner.name} hat nicht reagiert. Die Einladung ist zurückgezogen.`),
        INVITE_TIMEOUT_MS,
      )
      setFlow({ step: 'waiting', partner })
    } catch (error) {
      if (current.done) return
      if (error instanceof InviteError && error.code === 'partner_offline') {
        fail(`${partner.name} ist offline`, `Ohne Experten kein Entschärfen. Versuch es, sobald ${partner.name} online ist.`)
      } else {
        fail('Das hat nicht geklappt', error instanceof Error ? error.message : String(error))
      }
    }
  }, [partner, target, navigate, teardown, fail])

  const cancel = useCallback(() => {
    teardown(false)
    setFlow({ step: 'idle' })
  }, [teardown])

  const partnerOnline = partner !== null && presenceOf(channel, partner.id) === 'online'

  return { flow, start, cancel, dismiss: cancel, partnerOnline }
}
