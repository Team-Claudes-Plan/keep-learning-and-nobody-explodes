import { useEffect, useState } from 'react'
import { fetchQuestions, submitAnswer } from '../api/client'
import type { AnswerResult, AnswerSubmission, Question, QuestionType } from '../api/types'
import { submissionFor } from './adapters'
import Bomb3D, { BOMB_SLOTS, type SlotStatus } from './Bomb3D'
import LockButton3D from './modules/LockButton3D'
import { describeAnswer } from './describe'
import { MODULES } from './modules'
import type { ModuleDef } from './modules/types'
import { planBomb, planForType, playableTypes, type PlannedModule } from './plan'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from './questionTypes'
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

/** Test bar: a random bomb, or every task variant of one question type in every fitting module. */
type Mode = 'random' | QuestionType

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; questions: Question[] }

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

type BombProps = {
  /** Modules the bomb may use. */
  modules: ModuleDef[]
  /** Fixed plan (e.g. seeded for koop) instead of a random one. */
  plan?: (questions: Question[]) => PlannedModule[]
  /** 'defuser': no prompts on the bomb (the expert has those); 'solo': prompt shown next to the zoomed module. */
  view?: 'solo' | 'defuser'
  /** Shows the test bar to pick a question type and click through its tasks. */
  testBar?: boolean
  /** Practice round (e.g. koop with a question type): no timer, no explosion. */
  practice?: boolean
  /** Shown in the top left, e.g. the koop code, so both players can check they have the same bomb. */
  badge?: string
}

/** Full-screen 3D bomb, nothing else: click a module to zoom in and work on it. */
export default function Bomb({
  modules,
  plan: fixedPlan,
  view = 'solo',
  testBar = false,
  practice = false,
  badge,
}: BombProps) {
  const [round, setRound] = useState(0)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [slots, setSlots] = useState<Slot[]>([])
  const [timeLeft, setTimeLeft] = useState(BOMB_SECONDS)
  /** Index of the module shown large (zoomed in on the bomb); null = bomb overview. */
  const [expanded, setExpanded] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>('random')
  /** Modules the plan had before it was cut down to the slots on the bomb. */
  const [plannedCount, setPlannedCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchQuestions(controller.signal)
      .then((questions) => {
        // Only as many modules as there are slots on the bomb.
        const full = fixedPlan
          ? fixedPlan(questions)
          : mode === 'random'
            ? planBomb(questions, modules, BOMB_SIZE)
            : planForType(questions, MODULES, mode) // testing a type: every module that can play it
        setPlannedCount(full.length)
        const plan = full.slice(0, BOMB_SLOTS)
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
  }, [modules, round, fixedPlan, mode])

  /** Testing one question type: no timer and no explosion, so every module can be tried. */
  const testing = practice || (testBar && mode !== 'random')
  const strikes = slots.filter((s) => s.status === 'failed').length
  const exploded = !testing && (strikes >= MAX_STRIKES || timeLeft <= 0)
  const finished = slots.length > 0 && slots.every((s) => s.status !== 'active' && s.status !== 'sending')
  /**
   * How the round ended. Strikes and time come first: a third mistake on the last module still
   * blows the bomb up. Testing a question type has no strikes, so it ends with a tally instead.
   */
  const outcome = exploded ? 'boom' : !finished ? null : testing ? 'test' : 'defused'
  const correct = slots.filter((s) => s.status === 'solved').length
  const running = load.status === 'ready' && slots.length > 0 && !exploded && !finished && !testing

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

  /** Sends by itself, without "Abschließen": single choice on its first pick, or modules that finish when complete. */
  function isImmediate(slot: Slot) {
    return (submitsImmediately(slot.task.primitive) && !slot.module.confirm) || slot.module.submitWhenComplete === true
  }

  function changeValue(index: number, value: AnyValue) {
    const slot = slots[index]
    if (isImmediate(slot) && isComplete(slot.task.primitive, value)) lockIn(index, value)
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
          heading={slot.heading === undefined ? slot.task.prompt : (slot.heading ?? undefined)}
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

  if (load.status === 'error') {
    return (
      <div className="bomb-screen">
        <div className="bomb-screen-message">
          <p>⚠️ {load.message}</p>
          <button className="mg-button" onClick={restart}>Erneut versuchen</button>
        </div>
      </div>
    )
  }

  if (load.status === 'loading') {
    return (
      <div className="bomb-screen">
        <p className="bomb-screen-message">Bombe wird scharf gemacht…</p>
      </div>
    )
  }

  // When it goes off, leave the module so the whole explosion is in view.
  const focused = exploded ? null : expanded
  const focusedOnBomb = focused !== null && slots[focused]?.module.component3d !== undefined
  const defuser = view === 'defuser'
  // 3D modules are worked on directly; 2D modules still need their controls in a card.
  const card =
    focused === null || (defuser && focusedOnBomb) ? null : renderModule(focused, focusedOnBomb, defuser)

  return (
    <div className="bomb-screen">
      <Bomb3D
        bare
        modules={slots.map((s, i) => ({ id: s.module.id, status: s.status, content3d: render3d(s, i) }))}
        focused={focused}
        overlay={focusedOnBomb ? 'side' : 'center'}
        onSelect={setExpanded}
        onBack={() => setExpanded(null)}
        timeLeft={timeLeft}
        strikes={strikes}
        exploded={exploded}
      >
        {card}
      </Bomb3D>
      {badge && <div className="bomb-badge">{badge}</div>}
      {testBar && (
        <TestBar
          mode={mode}
          playable={playableTypes(load.questions, MODULES)}
          shown={slots.length}
          planned={plannedCount}
          onMode={changeMode}
          onRestart={restart}
        />
      )}
      {slots.length === 0 && <p className="bomb-screen-message">Keine passenden Aufgaben für diese Module.</p>}
      {outcome && (
        <button className={`bomb-screen-result ${outcome === 'boom' ? 'is-bad' : 'is-good'}`} onClick={restart}>
          {outcome === 'boom' ? '💥 BOOM' : outcome === 'defused' ? '✅ Entschärft' : '🧪 Test fertig'}
          {outcome === 'test' && (
            <small>
              {correct} richtig · {strikes} falsch
            </small>
          )}
          {!fixedPlan && <small>{outcome === 'test' ? 'Nochmal' : 'Neue Bombe'}</small>}
        </button>
      )}
    </div>
  )
}

type TestBarProps = {
  mode: Mode
  /** Types at least one module can play. */
  playable: Set<QuestionType>
  /** Modules on the bomb, and how many the plan had (the bomb has only BOMB_SLOTS slots). */
  shown: number
  planned: number
  onMode: (mode: Mode) => void
  onRestart: () => void
}

/** Test environment: pick a question type (or step through them) and get one bomb full of its tasks. */
function TestBar({ mode, playable, shown, planned, onMode, onRestart }: TestBarProps) {
  const modes: Mode[] = ['random', ...QUESTION_TYPES.filter((type) => playable.has(type))]
  const step = (by: number) => onMode(modes[(modes.indexOf(mode) + by + modes.length) % modes.length])

  return (
    <div className="bomb-testbar">
      <button className="mg-button" onClick={() => step(-1)} aria-label="Vorheriger Fragetyp">◀</button>
      <select className="mg-select" value={mode} onChange={(e) => onMode(e.target.value as Mode)} aria-label="Fragetyp">
        <option value="random">Zufällige Bombe</option>
        {QUESTION_TYPES.map((type) => (
          <option key={type} value={type} disabled={!playable.has(type)}>
            {QUESTION_TYPE_LABELS[type]}
            {playable.has(type) ? '' : ' (kein Modul)'}
          </option>
        ))}
      </select>
      <button className="mg-button" onClick={() => step(1)} aria-label="Nächster Fragetyp">▶</button>
      <button className="mg-button" onClick={onRestart}>Neu</button>
      <span className="bomb-testbar-info">
        {shown} Module{planned > shown ? ` (von ${planned})` : ''}
        {mode !== 'random' && ' · ohne Timer'}
      </span>
    </div>
  )
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
