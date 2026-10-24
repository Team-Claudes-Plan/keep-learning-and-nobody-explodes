import { useEffect, useState } from 'react'
import { fetchQuestions, submitAnswer } from '../api/client'
import type { Question, QuestionType } from '../api/types'
import { submissionFor } from './adapters'
import type { ModuleDef } from './modules/types'
import { planBomb, planForType, playableTypes, type PlannedModule } from './plan'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from './questionTypes'
import { initialValue, isComplete, submitsImmediately, type AnyValue } from './primitives'

const BOMB_SIZE = 5
const BOMB_SECONDS = 300
const MAX_STRIKES = 3

type SlotStatus = 'active' | 'sending' | 'solved' | 'failed' | 'submitted'

type Slot = PlannedModule & {
  value: AnyValue
  status: SlotStatus
  error?: string
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; questions: Question[] }

/** 'random' = normal bomb; a question type = every fitting module for that type once. */
type Mode = 'random' | QuestionType

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function formatTime(seconds: number) {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

type BombProps = {
  /** Modules the bomb may use. */
  modules: ModuleDef[]
}

export default function Bomb({ modules }: BombProps) {
  const [round, setRound] = useState(0)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [slots, setSlots] = useState<Slot[]>([])
  const [timeLeft, setTimeLeft] = useState(BOMB_SECONDS)
  const [mode, setMode] = useState<Mode>('random')
  /** Index of the module shown large; the others are collapsed. */
  const [expanded, setExpanded] = useState<number | null>(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchQuestions(controller.signal)
      .then((questions) => {
        const plan =
          mode === 'random' ? planBomb(questions, modules, BOMB_SIZE) : planForType(questions, modules, mode)
        setSlots(
          plan.map((p) => ({
            ...p,
            value: p.module.init?.(p.task.primitive) ?? initialValue(p.task.primitive),
            status: 'active',
          })),
        )
        setTimeLeft(BOMB_SECONDS)
        setExpanded(0)
        setLoad({ status: 'ready', questions })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: errorMessage(err) })
      })
    return () => controller.abort()
  }, [modules, mode, round])

  const strikes = slots.filter((s) => s.status === 'failed').length
  const exploded = strikes >= MAX_STRIKES || timeLeft <= 0
  const finished = slots.length > 0 && slots.every((s) => s.status !== 'active' && s.status !== 'sending')
  const running = load.status === 'ready' && slots.length > 0 && !exploded && !finished

  useEffect(() => {
    if (!running) return
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000)
    return () => clearTimeout(id)
  }, [running, timeLeft])

  function restart() {
    setLoad({ status: 'loading' })
    setRound((r) => r + 1)
  }

  function changeMode(next: Mode) {
    setLoad({ status: 'loading' })
    setMode(next)
  }

  function updateSlot(index: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function nextActive(after: number) {
    for (let k = 1; k <= slots.length; k++) {
      const i = (after + k) % slots.length
      if (i !== after && slots[i].status === 'active') return i
    }
    return null
  }

  /** `value` is passed explicitly when submitting right after a change. */
  async function lockIn(index: number, value: AnyValue = slots[index].value) {
    const slot = slots[index]
    if (slot.status !== 'active' || exploded || !isComplete(slot.task.primitive, value)) return
    updateSlot(index, { value, status: 'sending', error: undefined })
    try {
      const result = await submitAnswer(submissionFor(slot.task, value))
      const status: SlotStatus =
        result.correct === true ? 'solved' : result.correct === false ? 'failed' : 'submitted'
      updateSlot(index, { status })
      setExpanded(nextActive(index))
    } catch (err) {
      updateSlot(index, { status: 'active', error: errorMessage(err) })
    }
  }

  if (load.status === 'loading') return <p className="mg-muted">Bombe wird scharf gemacht…</p>

  if (load.status === 'error') {
    return (
      <div className="mg-center">
        <p>⚠️ {load.message}</p>
        <button className="mg-button" onClick={restart}>Erneut versuchen</button>
      </div>
    )
  }

  const playable = playableTypes(load.questions, modules)

  return (
    <div className={`bomb ${exploded ? 'is-exploded' : ''}`}>
      <div className="bomb-bar">
        <span className={`bomb-timer ${timeLeft <= 30 ? 'is-low' : ''}`}>{formatTime(timeLeft)}</span>
        <span className="bomb-strikes" aria-label={`${strikes} von ${MAX_STRIKES} Fehlern`}>
          {Array.from({ length: MAX_STRIKES }, (_, i) => (
            <span key={i} className={`bomb-strike ${i < strikes ? 'is-hit' : ''}`}>✕</span>
          ))}
        </span>
        <select
          className="mg-select"
          value={mode}
          onChange={(e) => changeMode(e.target.value as Mode)}
          aria-label="Fragetyp"
        >
          <option value="random">Zufällig</option>
          {QUESTION_TYPES.map((type) => (
            <option key={type} value={type} disabled={!playable.has(type)}>
              {QUESTION_TYPE_LABELS[type]}{playable.has(type) ? '' : ' (kein Modul)'}
            </option>
          ))}
        </select>
        <button className="mg-button" onClick={restart}>Neue Bombe</button>
      </div>

      {slots.length === 0 && <p className="mg-muted">Keine passenden Fragen für diese Module gefunden.</p>}

      {(exploded || finished) && (
        <div className={`bomb-result ${exploded ? 'is-bad' : 'is-good'}`}>
          {exploded ? '💥 BOOM. Die Bombe ist explodiert.' : '✅ Bombe entschärft!'}
        </div>
      )}

      <div className="bomb-grid">
        {slots.map((slot, index) => {
          const Module = slot.module.component
          const locked = slot.status !== 'active' || exploded
          const immediate = submitsImmediately(slot.task.primitive)

          if (expanded !== index) {
            return (
              <button
                key={`${round}-${index}`}
                className={`bomb-module is-collapsed is-${slot.status}`}
                onClick={() => setExpanded(index)}
              >
                <span className="bomb-module-head">
                  <span>{slot.module.icon} {slot.module.name}</span>
                  <span className={`bomb-led is-${slot.status}`} aria-label={slot.status} />
                </span>
                <span className="bomb-module-prompt">{slot.task.prompt}</span>
              </button>
            )
          }

          return (
            <section key={`${round}-${index}`} className={`bomb-module is-expanded is-${slot.status}`}>
              <header className="bomb-module-head">
                <span>{slot.module.icon} {slot.module.name}</span>
                <span className={`bomb-led is-${slot.status}`} aria-label={slot.status} />
              </header>
              <p className="mg-question">{slot.task.prompt}</p>
              <Module
                primitive={slot.task.primitive}
                value={slot.value}
                onChange={(value) => (immediate ? lockIn(index, value) : updateSlot(index, { value }))}
                disabled={locked}
                onLockIn={() => lockIn(index)}
              />
              {slot.error && <p className="bomb-error">⚠️ {slot.error}</p>}
              {immediate ? (
                slot.status !== 'active' && <p className="mg-muted bomb-lock">{slot.status === 'sending' ? 'Sende…' : 'Abgeschlossen'}</p>
              ) : (
                <button
                  className="mg-button mg-primary bomb-lock"
                  disabled={locked || !isComplete(slot.task.primitive, slot.value)}
                  onClick={() => lockIn(index)}
                >
                  {slot.status === 'sending' ? 'Sende…' : slot.status === 'active' ? 'Abschließen' : 'Abgeschlossen'}
                </button>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
