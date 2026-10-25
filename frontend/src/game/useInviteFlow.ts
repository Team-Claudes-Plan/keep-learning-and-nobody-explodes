import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { USES_BACKEND } from '../api/client'
import { InviteError, cancelInvite, channelState, presenceOf, sendInvite, useUserChannel } from '../api/invites'
import { SessionRefused, acquireSession, createSession, isOver, releaseSession, type SessionClient } from '../api/session'
import type { UserSummary } from '../api/types'
import { sessionErrorText } from './sessionErrors'
import { questionsForStorey, secondsForQuestions } from './sessionRules'

/** An invite nobody answers is taken back. */
const INVITE_TIMEOUT_MS = 60000

export type InviteFlow =
  | { step: 'idle' }
  | { step: 'starting' }
  | { step: 'waiting'; partner: UserSummary }
  /** Accepted: both press "Bereit"; the game page opens once the server started the game. `client` is null without a backend. */
  | { step: 'ready'; partner: UserSummary; client: SessionClient | null }
  | { step: 'error'; title: string; message: string }

/** The storey to play: `storeyId` is the id of its skill, `storeyIndex` its floor (0 is the ground floor). */
type Target = { islandId: string; topicId: string; storeyId: string; storeyIndex: number }

/**
 * Where each player goes once the invite is accepted: the inviter starts with the bomb, the invitee
 * with the manual. `islandId` lets the game page lead back to the house afterwards.
 */
export function gamePath(gameId: string, role: 'defuser' | 'expert', islandId?: string): string {
  if (USES_BACKEND) {
    const query = new URLSearchParams()
    if (role === 'expert') query.set('rolle', 'expert')
    if (islandId) query.set('insel', islandId)
    const search = query.toString()
    return `/koop/spiel/${gameId}${search ? `?${search}` : ''}`
  }
  // Without a backend the seeded koop plays the game: both sides build the bomb from the seed.
  return role === 'defuser' ? `/koop/${gameId}/bombe` : `/koop/${gameId}/handbuch`
}

/** A random koop seed, standing in for a game id without a backend. */
function mockGameId() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

type Pending = {
  inviteId: string | null
  client: SessionClient | null
  gameId: string | null
  timer: number | undefined
  /** The partner accepted (or joined): no more invite to take back. */
  accepted: boolean
  done: boolean
  unsubscribe?: () => void
}

/**
 * Starting a game from a storey: check that the partner is online, open the game, invite them and
 * wait. On accept both players press "Bereit"; once the server started the game the inviter goes to
 * the bomb. Decline, timeout or leaving the page cancel the game.
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
    current.unsubscribe?.()
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

    const current: Pending = { inviteId: null, client: null, gameId: null, timer: undefined, accepted: false, done: false }
    pending.current = current
    setFlow({ step: 'starting' })

    /** The partner is in: on to the ready check. */
    const accepted = () => {
      if (current.done || current.accepted) return
      current.accepted = true
      current.inviteId = null
      window.clearTimeout(current.timer)
      setFlow({ step: 'ready', partner, client: current.client })
    }
    /** Both are ready and the clock runs: hand the socket over to the game page. */
    const started = (gameId: string) => {
      if (current.done) return
      teardown(true)
      setFlow({ step: 'idle' })
      navigate(gamePath(gameId, 'defuser', target.islandId))
    }

    try {
      let gameId: string
      if (USES_BACKEND) {
        const questions = questionsForStorey(target.storeyIndex)
        gameId = await createSession({
          topics: [target.topicId],
          questionCount: questions,
          role: 'defuser',
          timeLimitSecs: secondsForQuestions(questions),
          storey: { skillId: target.storeyId, islandId: target.islandId },
          invited: partner.id,
        })
        // Hold the game's socket until the inviter moves on to the game page.
        const client = acquireSession(gameId)
        if (current.done) {
          client.forfeit()
          releaseSession(client)
          return
        }
        current.client = client
        current.gameId = gameId
        const id = gameId
        current.unsubscribe = client.subscribe(() => {
          const { game, connection } = client.getState()
          // The partner joining fills the game, even if the accept message got lost on the way.
          if (game?.status === 'ready' || game?.status === 'active') accepted()
          if (game?.status === 'active') started(id)
          else if (isOver(game)) fail('Abgebrochen', `${partner.name} hat die Session abgebrochen.`)
          else if (connection === 'failed') fail('Verbindung verloren', 'Die Verbindung zum Spiel ist abgerissen. Starte die Session neu.')
        })
      } else {
        gameId = mockGameId()
        current.gameId = gameId
      }
      if (current.done) return

      const inviteId = await sendInvite(
        { to: partner.id, islandId: target.islandId, topicId: target.topicId, storeyId: target.storeyId, gameId },
        (outcome) => {
          if (current.done) return
          if (outcome === 'accepted') accepted()
          else if (outcome === 'declined') fail('Abgelehnt', `${partner.name} hat die Einladung abgelehnt.`)
          else if (current.accepted) return
          else if (outcome === 'cancelled') fail('Einladung verfallen', 'Die Einladung gilt nicht mehr.')
          else fail('Verbindung verloren', 'Die Verbindung zum Server ist abgerissen. Starte die Session neu.')
        },
      )
      if (current.done) {
        cancelInvite(inviteId)
        return
      }
      if (current.accepted) return
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
      } else if (error instanceof SessionRefused || error instanceof InviteError) {
        fail('Das geht hier nicht', sessionErrorText(error))
      } else {
        fail('Das hat nicht geklappt', error instanceof Error ? error.message : String(error))
      }
    }
  }, [partner, target, navigate, teardown, fail])

  /** Without a backend: the played partner is ready too, off to the bomb. */
  const enterMockGame = useCallback(() => {
    const current = pending.current
    if (!current?.accepted || !current.gameId || !target) return
    const gameId = current.gameId
    teardown(true)
    setFlow({ step: 'idle' })
    navigate(gamePath(gameId, 'defuser', target.islandId))
  }, [target, navigate, teardown])

  const cancel = useCallback(() => {
    teardown(false)
    setFlow({ step: 'idle' })
  }, [teardown])

  const partnerOnline = partner !== null && presenceOf(channel, partner.id) === 'online'

  return { flow, start, cancel, dismiss: cancel, enterMockGame, partnerOnline }
}
