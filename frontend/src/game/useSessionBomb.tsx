import { useEffect, useMemo, useState } from 'react'
import type { SessionClient, SessionState } from '../api/session'
import { submissionFor } from './adapters'
import type { SlotStatus } from './Bomb3D'
import LockButton3D from './modules/LockButton3D'
import { MODULES } from './modules'
import { initialValue, isComplete, submitsImmediately, type AnyValue } from './primitives'
import { planTurn, sessionAnswer } from './sessionTask'

/** Shown for parts whose module this player never saw (the bay stays empty, only the LED counts). */
const UNKNOWN_MODULE = 'blank'

type Work = { turn: number; value: AnyValue; sending: boolean; error?: string }

/**
 * The bomb of an online game as the defuser sees it: one slot per part, the current turn's module
 * is live, solved and failed parts show their LED. The server judges every answer.
 */
export function useSessionBomb(client: SessionClient, session: SessionState) {
  const { game, briefing, gameId } = session
  const turn = game?.turn ?? null
  const defuserBriefing = briefing?.role === 'defuser' && briefing.turn === turn ? briefing : null
  const planned = useMemo(
    () => (defuserBriefing && gameId ? planTurn(defuserBriefing, gameId, MODULES) : null),
    [defuserBriefing, gameId],
  )

  const [work, setWork] = useState<Work | null>(null)
  /** Module shown per turn this player defused, so finished parts keep their look. */
  const [seen, setSeen] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState<number | null>(null)

  // A new turn: fresh controls, and zoom in on the module to work on.
  useEffect(() => {
    if (!planned || turn === null) return
    setWork({ turn, value: planned.module.init?.(planned.task.primitive) ?? initialValue(planned.task.primitive), sending: false })
    setSeen((prev) => ({ ...prev, [turn]: planned.module.id }))
    setExpanded(turn)
  }, [planned, turn])

  // An error while sending answers the submission: the module is free again.
  useEffect(() => {
    if (!session.error) return
    setWork((prev) => (prev?.sending ? { ...prev, sending: false, error: session.error?.message } : prev))
  }, [session.error])

  const current = planned && work && work.turn === turn ? work : null
  const over = game !== null && game.status !== 'active'
  const part = game?.parts.find((p) => p.position === turn)
  const answerable = current !== null && !current.sending && !over && !part?.result

  function lockIn(value: AnyValue = current?.value ?? null) {
    if (!planned || !current || turn === null || !answerable || !isComplete(planned.task.primitive, value)) return
    const answer = sessionAnswer(submissionFor(planned.task, value))
    const sent = client.submitAnswer(turn, answer)
    setWork({ ...current, value, sending: sent, error: sent ? undefined : 'Keine Verbindung zum Server.' })
  }

  const immediate =
    planned !== null &&
    ((submitsImmediately(planned.task.primitive) && !planned.module.confirm) || planned.module.submitWhenComplete === true)

  function change(value: AnyValue) {
    if (!planned || !current || !answerable) return
    if (immediate && isComplete(planned.task.primitive, value)) lockIn(value)
    else setWork({ ...current, value })
  }

  function statusOf(position: number): SlotStatus {
    const result = game?.parts.find((p) => p.position === position)?.result
    if (result) return result
    if (position === turn && current?.sending) return 'sending'
    return 'active'
  }

  const liveIndex = planned && current && turn !== null ? turn : null
  const complete = planned !== null && current !== null && isComplete(planned.task.primitive, current.value)

  function content3d() {
    if (!planned || !current || liveIndex === null) return undefined
    const Module3D = planned.module.component3d
    if (!Module3D) return undefined
    const focused = expanded === liveIndex
    return (
      <group key={`${gameId}-${liveIndex}`}>
        <Module3D
          primitive={planned.task.primitive}
          value={current.value}
          onChange={change}
          disabled={!answerable || !focused}
          onLockIn={() => lockIn()}
          heading={planned.heading ?? undefined}
        />
        {!immediate && (
          <LockButton3D
            enabled={answerable && focused && complete}
            label={current.sending ? 'SENDE…' : answerable ? 'ABSCHLIESSEN' : 'ABGESCHLOSSEN'}
            onPress={() => lockIn()}
          />
        )}
      </group>
    )
  }

  const bombModules = (game?.parts ?? []).map((p) => ({
    id: p.position === liveIndex && planned ? planned.module.id : (seen[p.position] ?? UNKNOWN_MODULE),
    status: statusOf(p.position),
    content3d: p.position === liveIndex ? content3d() : undefined,
  }))

  const focused = over && game?.status === 'lost' ? null : expanded
  const focusedOnBomb = focused !== null && focused === liveIndex && planned?.module.component3d !== undefined

  /** Card for modules without 3D controls, and for errors. */
  function card() {
    if (focused === null || focused !== liveIndex || !planned || !current) return null
    const Module = planned.module.component
    const onBomb = planned.module.component3d !== undefined
    if (onBomb && !current.error) return null
    return (
      <section className={`bomb-module is-expanded is-${statusOf(focused)}`}>
        <header className="bomb-module-head">
          <span>
            {planned.module.icon} {planned.module.name}
          </span>
        </header>
        {planned.heading && <p className="mg-question">{planned.heading}</p>}
        {!onBomb && (
          <Module
            primitive={planned.task.primitive}
            value={current.value}
            onChange={change}
            disabled={!answerable}
            onLockIn={() => lockIn()}
          />
        )}
        {current.error && <p className="bomb-error">⚠️ {current.error}</p>}
        {!onBomb && !immediate && (
          <button className="mg-button mg-primary bomb-lock" disabled={!answerable || !complete} onClick={() => lockIn()}>
            {current.sending ? 'Sende…' : answerable ? 'Abschließen' : 'Abgeschlossen'}
          </button>
        )}
      </section>
    )
  }

  return {
    bombModules,
    focused,
    focusedOnBomb,
    card: card(),
    /** No module fits the question (should not happen with the current modules). */
    unplayable: defuserBriefing !== null && planned === null,
    // Only the module of this turn can be opened.
    select: (index: number) => {
      if (index === liveIndex) setExpanded(index)
    },
    back: () => setExpanded(null),
  }
}

/** Seconds until the deadline, ticking. */
export function useTimeLeft(deadline: string | null, running: boolean, fallback: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [running])
  if (!deadline) return fallback
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000))
}
