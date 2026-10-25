import { useEffect, useMemo, useState } from 'react'
import type { SessionClient, SessionState } from '../api/session'
import { submissionFor } from './adapters'
import type { SlotStatus } from './Bomb3D'
import LockButton3D from './modules/LockButton3D'
import { MODULES } from './modules'
import type { PlannedModule } from './plan'
import { initialValue, isComplete, submitsImmediately, type AnyValue } from './primitives'
import { useE2eBomb } from './e2eHook'
import { planPart, sessionAnswer } from './sessionTask'

/** Shown for parts without a module yet (before the game starts): the bay stays empty. */
const UNKNOWN_MODULE = 'blank'

/** How long a solved module stays open (green LED) before the view zooms out. */
const SOLVED_ZOOM_OUT_MS = 1100

type Work = { value: AnyValue; sending: boolean; error?: string }

/**
 * The bomb of an online game as the defuser sees it: every module is there from the start and can
 * be opened and answered in any order. Solved and failed parts show their LED. The server judges
 * every answer.
 */
export function useSessionBomb(client: SessionClient, session: SessionState) {
  const { game, briefing, gameId } = session
  const parts = briefing?.role === 'defuser' ? briefing.parts : null
  /** The module per part position. */
  const planned = useMemo(() => {
    const byPosition = new Map<number, PlannedModule | null>()
    if (parts && gameId) for (const part of parts) byPosition.set(part.position, planPart(part, gameId, MODULES))
    return byPosition
  }, [parts, gameId])

  useE2eBomb(client, parts)

  const [work, setWork] = useState<Record<number, Work>>({})
  const [expanded, setExpanded] = useState<number | null>(null)

  // Fresh controls for every module once the bomb is known; a briefing sent again after a
  // reconnect keeps what was already set.
  useEffect(() => {
    setWork((prev) => {
      const next: Record<number, Work> = {}
      for (const [position, plan] of planned) {
        if (!plan) continue
        next[position] = prev[position] ?? {
          value: plan.module.init?.(plan.task.primitive) ?? initialValue(plan.task.primitive),
          sending: false,
        }
      }
      return next
    })
  }, [planned])

  // An error while sending answers the submission that is still out: that module is free again.
  useEffect(() => {
    if (!session.error) return
    setWork((prev) => {
      const next = { ...prev }
      for (const [position, entry] of Object.entries(prev)) {
        if (entry.sending) next[Number(position)] = { ...entry, sending: false, error: session.error?.message }
      }
      return next
    })
  }, [session.error])

  const over = game !== null && game.status !== 'active'
  const resultOf = (position: number) => game?.parts.find((p) => p.position === position)?.result ?? null

  // Once a module is solved, zoom back out to the bomb.
  const solvedOpen = expanded !== null && resultOf(expanded) === 'solved'
  useEffect(() => {
    if (!solvedOpen || expanded === null) return
    const id = setTimeout(() => setExpanded((open) => (open === expanded ? null : open)), SOLVED_ZOOM_OUT_MS)
    return () => clearTimeout(id)
  }, [solvedOpen, expanded])

  function answerable(position: number) {
    const current = work[position]
    return planned.get(position) != null && current !== undefined && !current.sending && !over && !resultOf(position)
  }

  function immediate(plan: PlannedModule) {
    return (submitsImmediately(plan.task.primitive) && !plan.module.confirm) || plan.module.submitWhenComplete === true
  }

  function lockIn(position: number, value: AnyValue = work[position]?.value ?? null) {
    const plan = planned.get(position)
    const current = work[position]
    if (!plan || !current || !answerable(position) || !isComplete(plan.task.primitive, value)) return
    const answer = sessionAnswer(submissionFor(plan.task, value))
    const sent = client.submitAnswer(position, answer)
    setWork((prev) => ({
      ...prev,
      [position]: { ...current, value, sending: sent, error: sent ? undefined : 'Keine Verbindung zum Server.' },
    }))
  }

  function change(position: number, value: AnyValue) {
    const plan = planned.get(position)
    const current = work[position]
    if (!plan || !current || !answerable(position)) return
    if (immediate(plan) && isComplete(plan.task.primitive, value)) lockIn(position, value)
    else setWork((prev) => ({ ...prev, [position]: { ...current, value } }))
  }

  function statusOf(position: number): SlotStatus {
    const result = resultOf(position)
    if (result) return result
    if (work[position]?.sending) return 'sending'
    return 'active'
  }

  function content3d(position: number) {
    const plan = planned.get(position)
    const current = work[position]
    if (!plan || !current) return undefined
    const Module3D = plan.module.component3d
    if (!Module3D) return undefined
    const focused = expanded === position
    const open = answerable(position)
    return (
      <group key={`${gameId}-${position}`}>
        <Module3D
          primitive={plan.task.primitive}
          value={current.value}
          onChange={(value) => change(position, value)}
          disabled={!open || !focused}
          onLockIn={() => lockIn(position)}
          heading={plan.heading ?? undefined}
        />
        {!immediate(plan) && (
          <LockButton3D
            enabled={open && focused && isComplete(plan.task.primitive, current.value)}
            label={current.sending ? 'SENDE…' : open ? 'ABSCHLIESSEN' : 'ABGESCHLOSSEN'}
            onPress={() => lockIn(position)}
          />
        )}
      </group>
    )
  }

  const bombModules = (game?.parts ?? []).map((p) => ({
    id: planned.get(p.position)?.module.id ?? UNKNOWN_MODULE,
    status: statusOf(p.position),
    content3d: content3d(p.position),
  }))

  const focused = over && game?.status === 'lost' ? null : expanded
  const focusedPlan = focused === null ? null : (planned.get(focused) ?? null)
  const focusedOnBomb = focusedPlan !== null && focusedPlan.module.component3d !== undefined

  /** Card for modules without 3D controls, and for errors. */
  function card() {
    if (focused === null || !focusedPlan) return null
    const current = work[focused]
    if (!current) return null
    const Module = focusedPlan.module.component
    const onBomb = focusedPlan.module.component3d !== undefined
    if (onBomb && !current.error) return null
    const open = answerable(focused)
    const position = focused
    return (
      <section className={`bomb-module is-expanded is-${statusOf(position)}`}>
        <header className="bomb-module-head">
          <span>
            {focusedPlan.module.icon} {focusedPlan.module.name}
          </span>
        </header>
        {focusedPlan.heading && <p className="mg-question">{focusedPlan.heading}</p>}
        {!onBomb && (
          <Module
            primitive={focusedPlan.task.primitive}
            value={current.value}
            onChange={(value) => change(position, value)}
            disabled={!open}
            onLockIn={() => lockIn(position)}
          />
        )}
        {current.error && <p className="bomb-error">⚠️ {current.error}</p>}
        {!onBomb && !immediate(focusedPlan) && (
          <button
            className="mg-button mg-primary bomb-lock"
            disabled={!open || !isComplete(focusedPlan.task.primitive, current.value)}
            onClick={() => lockIn(position)}
          >
            {current.sending ? 'Sende…' : open ? 'Abschließen' : 'Abgeschlossen'}
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
    /** Some question has no fitting module (should not happen with the current modules). */
    unplayable: [...planned.values()].some((plan) => plan === null),
    /** Any module with a known plan can be opened. */
    select: (index: number) => {
      if (planned.get(index)) setExpanded(index)
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
