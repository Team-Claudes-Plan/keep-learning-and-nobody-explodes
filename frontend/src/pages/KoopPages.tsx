import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { fetchQuestions } from '../api/client'
import type { Question, QuestionType } from '../api/types'
import Bomb from '../game/Bomb'
import type { Briefed } from '../game/briefing'
import { newSeed, planKoop } from '../game/koop'
import { MODULES } from '../game/modules'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../game/questionTypes'
import ManualBook from './ManualBook'
import NotFoundPage from './NotFoundPage'

function useSeed() {
  const { seed } = useParams()
  const value = Number(seed)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** Question type to practise (?typ=…), or null for a normal random bomb. */
function useType(): QuestionType | null {
  const [params] = useSearchParams()
  const type = params.get('typ')
  return type && (QUESTION_TYPES as string[]).includes(type) ? (type as QuestionType) : null
}

const typeQuery = (type: QuestionType | null) => (type ? `?typ=${type}` : '')

const typeLabel = (type: QuestionType | null) => (type ? `Üben: ${QUESTION_TYPE_LABELS[type]}` : 'Zufällige Bombe')

/** Copies a link and briefly says so. */
export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="koop-link">
      <code>{url}</code>
      <button
        className="mg-button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Kopiert ✓' : 'Kopieren'}
      </button>
    </span>
  )
}

/**
 * /koop: one player sets up the bomb (code + question type) and sends the other the link for their
 * role; the other can also type in the code. Both roles must use the same code and type.
 */
export function KoopStartPage() {
  const [seed, setSeed] = useState(newSeed)
  const [type, setType] = useState<QuestionType | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const origin = window.location.origin
  const bombPath = `/koop/${seed}/bombe${typeQuery(type)}`
  const manualPath = `/koop/${seed}/handbuch${typeQuery(type)}`

  function join(code: string) {
    const value = Number(code.trim())
    if (Number.isInteger(value) && value > 0) setSeed(value)
  }

  return (
    <div className="mg-page">
      <header className="mg-header">
        <h1>🤝 Koop</h1>
        <Link to="/minigames">← Minigames</Link>
      </header>
      <p className="mg-muted">
        Einer richtet die Bombe ein und schickt dem anderen seinen Link. Beide müssen denselben Code und dieselbe
        Auswahl haben: Bombe und Handbuch zeigen beides oben an, vergleicht das kurz.
      </p>

      <div className="koop-seed">
        Bomben-Code <strong>{seed}</strong>
        <button className="mg-button" onClick={() => setSeed(newSeed())}>Neuer Code</button>
        <select
          className="mg-select"
          value={type ?? 'random'}
          onChange={(e) => setType(e.target.value === 'random' ? null : (e.target.value as QuestionType))}
          aria-label="Fragetyp"
        >
          <option value="random">Zufällige Bombe (mit Timer)</option>
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              Üben: {QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <form
        className="koop-seed"
        onSubmit={(e) => {
          e.preventDefault()
          join(joinCode)
        }}
      >
        Code vom Mitspieler:
        <input
          className="mg-select"
          inputMode="numeric"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          placeholder="z. B. 482913"
          aria-label="Code vom Mitspieler"
        />
        <button className="mg-button" type="submit">Übernehmen</button>
      </form>

      <div className="mg-grid">
        <Link to={bombPath} className="mg-tile mg-tile-main">
          <span className="mg-tile-icon">💣</span>
          <span className="mg-tile-name">Entschärfer</span>
          <span className="mg-muted">Sieht die Bombe: Fragen und Symbole, aber nicht, wofür sie stehen.</span>
        </Link>
        <Link to={manualPath} className="mg-tile mg-tile-main">
          <span className="mg-tile-icon">📖</span>
          <span className="mg-tile-name">Experte</span>
          <span className="mg-muted">Sieht das Handbuch: was die Symbole bedeuten und die übrigen Fragen.</span>
        </Link>
      </div>

      <div className="koop-links">
        <p className="mg-muted">Links zum Weiterschicken ({typeLabel(type)}):</p>
        <p>
          💣 Entschärfer: <CopyLink url={origin + bombPath} />
        </p>
        <p>
          📖 Experte: <CopyLink url={origin + manualPath} />
        </p>
      </div>
    </div>
  )
}

/** /koop/:seed/bombe — the defuser: the bomb with questions and symbols. */
export function KoopBombPage() {
  const seed = useSeed()
  const type = useType()
  const plan = useCallback((questions: Question[]) => planKoop(questions, seed ?? 1, type), [seed, type])
  if (seed === null) return <NotFoundPage />
  return (
    <Bomb
      key={`${seed}-${type}`}
      modules={MODULES}
      plan={plan}
      view="defuser"
      practice={type !== null}
      badge={`Code ${seed} · ${typeLabel(type)}`}
    />
  )
}

/** /koop/:seed/handbuch — the expert: what the symbols stand for and the questions the bomb does not show. */
export function KoopManualPage() {
  const seed = useSeed()
  const type = useType()
  const [plan, setPlan] = useState<Briefed[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (seed === null) return
    const controller = new AbortController()
    fetchQuestions(controller.signal)
      .then((questions) => setPlan(planKoop(questions, seed, type)))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [seed, type])

  if (seed === null) return <NotFoundPage />
  if (error || !plan) {
    return (
      <div className="book-screen">
        <p className="book-loading">{error ? `⚠️ ${error}` : 'Handbuch wird geladen…'}</p>
      </div>
    )
  }
  return <ManualBook key={`${seed}-${type}`} seed={seed} typeLabel={typeLabel(type)} plan={plan} />
}
