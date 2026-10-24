import { useEffect, useState } from 'react'
import { fetchQuestions, submitAnswer } from '../api/client'
import type { AnswerResult, AnswerSubmission, Question } from '../api/types'
import { submissionFor } from './adapters'
import { BOMB_SLOTS, type SlotStatus } from './Bomb3D'
import LockButton3D from './modules/LockButton3D'
import { describeAnswer } from './describe'
import type { ModuleDef } from './modules/types'
import { planBomb, type PlannedModule } from './plan'
import { initialValue, isComplete, submitsImmediately, type AnyValue } from './primitives'

const BOMB_SIZE = 5
const BOMB_SECONDS = 300
const MAX_STRIKES = 3

type Slot = PlannedModule & {
  value: AnyValue
  status: SlotStatus
  error?: string
  submission?: AnswerSubmission
  result?: AnswerResult
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; questions: Question[] }

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

type BombGameOptions = {
  /** Modules the bomb may use. */
  modules: ModuleDef[]
  /** Fixed plan (e.g. seeded for koop) instead of a random one. */
  plan?: (questions: Question[]) => PlannedModule[]
  /** 'defuser': no prompts on the bomb (the expert has those); 'solo': prompt shown next to the zoomed module. */
  view?: 'solo' | 'defuser'
  /** Timer stands still, e.g. while the bomb is still lying on the table. */
  paused?: boolean
}

/** Game state of one bomb: questions, modules on it, timer, strikes and the module that is zoomed in on. */
export function useBombGame({ modules, plan: fixedPlan, view = 'solo', paused = false }: BombGameOptions) {
  const [round, setRound] = useState(0)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [slots, setSlots] = useState<Slot[]>([])
  const [timeLeft, setTimeLeft] = useState(BOMB_SECONDS)
  /** Index of the module shown large (zoomed in on the bomb); null = bomb overview. */
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchQuestions(controller.signal)
      .then((questions) => {
        // Only as many modules as there are slots on the bomb.
        const plan = (fixedPlan ? fixedPlan(questions) : planBomb(questions, modules, BOMB_SIZE)).slice(0, BOMB_SLOTS)
        setSlots(
          plan.map((p) => ({
            ...p,
            value: p.module.init?.(p.task.primitive) ?? initialValue(p.task.primitive),
            status: 'active',
          })),
        )
        setTimeLeft(BOMB_SECONDS)
        setExpanded(null)
        setLoad({ status: 'ready', questions })
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: 'error', message: errorMessage(err) })
      })
    return () => controller.abort()
  }, [modules, round, fixedPlan])

  const strikes = slots.filter((s) => s.status === 'failed').length
  const exploded = strikes >= MAX_STRIKES || timeLeft <= 0
  const finished = slots.length > 0 && slots.every((s) => s.status !== 'active' && s.status !== 'sending')
  const running = load.status === 'ready' && slots.length > 0 && !exploded && !finished && !paused

  useEffect(() => {
    if (!running) return
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000)
    return () => clearTimeout(id)
  }, [running, timeLeft])

  function restart() {
    setLoad({ status: 'loading' })
    setRound((r) => r + 1)
  }

  function updateSlot(index: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  /** `value` is passed explicitly when submitting right after a change. */
  async function lockIn(index: number, value: AnyValue = slots[index].value) {
    const slot = slots[index]
    if (slot.status !== 'active' || exploded || !isComplete(slot.task.primitive, value)) return
    const submission = submissionFor(slot.task, value)
    updateSlot(index, { value, status: 'sending', error: undefined })
    try {
      const result = await submitAnswer(submission)
      const status: SlotStatus =
        result.correct === true ? 'solved' : result.correct === false ? 'failed' : 'submitted'
      // Stay on this module so the player sees the result.
      updateSlot(index, { status, submission, result })
    } catch (err) {
      updateSlot(index, { status: 'active', error: errorMessage(err) })
    }
  }

  function isImmediate(slot: Slot) {
    return submitsImmediately(slot.task.primitive) && !slot.module.confirm
  }

  function changeValue(index: number, value: AnyValue) {
    if (isImmediate(slots[index])) lockIn(index, value)
    else updateSlot(index, { value })
  }

  /** The module's 3D controls, mounted directly on the bomb; only interactive while zoomed in. */
  function render3d(slot: Slot, index: number) {
    const Module3D = slot.module.component3d
    if (!Module3D) return undefined
    const active = slot.status === 'active' && !exploded
    return (
      <group key={`${round}-${index}`}>
        <Module3D
          primitive={slot.task.primitive}
          value={slot.value}
          onChange={(value) => changeValue(index, value)}
          disabled={!active || expanded !== index}
          onLockIn={() => lockIn(index)}
        />
        {/* Modules that need confirming get a real button on the plate (the defuser has no card). */}
        {!isImmediate(slot) && (
          <LockButton3D
            enabled={active && expanded === index && isComplete(slot.task.primitive, slot.value)}
            label={slot.status === 'sending' ? 'SENDE…' : slot.status === 'active' ? 'ABSCHLIESSEN' : 'ABGESCHLOSSEN'}
            onPress={() => lockIn(index)}
          />
        )}
      </group>
    )
  }

  /** Card with prompt, controls and result. `onBomb`: the controls live on the 3D bomb, so leave them out. */
  function renderModule(index: number, onBomb = false, hidePrompt = false) {
    const slot = slots[index]
    const Module = slot.module.component
    const locked = slot.status !== 'active' || exploded
    const immediate = isImmediate(slot)

    return (
      <section key={`${round}-${index}`} className={`bomb-module is-expanded is-${slot.status}`}>
        <header className="bomb-module-head">
          <span>{slot.module.icon} {slot.module.name}</span>
          <span className={`bomb-led is-${slot.status}`} aria-label={slot.status} />
        </header>
        {!hidePrompt && <p className="mg-question">{slot.task.prompt}</p>}
        {!onBomb && (
          <Module
            primitive={slot.task.primitive}
            value={slot.value}
            onChange={(value) => changeValue(index, value)}
            disabled={locked}
            onLockIn={() => lockIn(index)}
          />
        )}
        {slot.error && <p className="bomb-error">⚠️ {slot.error}</p>}
        {slot.submission && slot.result && (
          <ResultPanel question={slot.question} submission={slot.submission} result={slot.result} />
        )}
        {immediate || onBomb ? (
          slot.status === 'sending' && <p className="mg-muted bomb-lock">Sende…</p>
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
  }

  const focused = load.status === 'ready' ? expanded : null
  const focusedOnBomb = focused !== null && slots[focused]?.module.component3d !== undefined
  const defuser = view === 'defuser'
  // 3D modules are worked on directly; 2D modules still need their controls in a card.
  const card =
    focused === null || (defuser && focusedOnBomb) ? null : renderModule(focused, focusedOnBomb, defuser)

  return {
    load,
    round,
    timeLeft,
    strikes,
    exploded,
    finished,
    focused,
    focusedOnBomb,
    /** Card for the focused module (prompt, 2D controls, result), shown over or beside it. */
    card,
    /** What goes onto the 3D bomb, one entry per planned module. */
    bombModules: slots.map((s, i) => ({ id: s.module.id, status: s.status, content3d: render3d(s, i) })),
    select: setExpanded,
    back: () => setExpanded(null),
    restart,
  }
}

type ResultPanelProps = { question: Question; submission: AnswerSubmission; result: AnswerResult }

function ResultPanel({ question, submission, result }: ResultPanelProps) {
  if (result.correct === undefined) return <div className="bomb-feedback">📨 Antwort gesendet.</div>
  if (result.correct) return <div className="bomb-feedback is-good">✅ Richtig!</div>

  const mine = describeAnswer(question, submission.answer)
  const right = result.solution ? describeAnswer(question, result.solution) : null

  return (
    <div className="bomb-feedback is-bad">
      <strong>❌ Falsch – Strike!</strong>
      {right && (
        <div className="bomb-compare">
          <div>
            <span className="mg-muted">Deine Antwort</span>
            <ul>
              {mine.map((line, i) => (
                <li key={i} className={mine.length === right.length && line !== right[i] ? 'is-wrong' : ''}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="is-solution">
            <span className="mg-muted">Richtig</span>
            <ul>
              {right.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
