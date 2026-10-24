import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { fetchQuestions } from '../api/client'
import Bomb from '../game/Bomb'
import { newSeed, planKoop, SLOT_LABELS } from '../game/koop'
import { MODULES } from '../game/modules'
import type { PlannedModule } from '../game/plan'
import type { Question } from '../api/types'
import NotFoundPage from './NotFoundPage'

function useSeed() {
  const { seed } = useParams()
  const value = Number(seed)
  return Number.isInteger(value) && value > 0 ? value : null
}

/** /koop: pick a seed and open one role per player. */
export function KoopStartPage() {
  const [seed, setSeed] = useState(newSeed)

  return (
    <div className="mg-page">
      <header className="mg-header">
        <h1>🤝 Koop-Test</h1>
        <Link to="/minigames">← Minigames</Link>
      </header>
      <p className="mg-muted">
        Beide öffnen denselben Code. Der Entschärfer sieht nur die Bombe, der Experte nur die Fragen. Lösen geht nur,
        wenn ihr redet.
      </p>
      <p className="koop-seed">
        Bomben-Code <strong>{seed}</strong>{' '}
        <button className="mg-button" onClick={() => setSeed(newSeed())}>Neue Bombe</button>
      </p>
      <div className="mg-grid">
        <Link to={`/koop/${seed}/bombe`} className="mg-tile mg-tile-main">
          <span className="mg-tile-icon">💣</span>
          <span className="mg-tile-name">Entschärfer</span>
          <span className="mg-muted">Sieht nur die Bombe mit den Antworten.</span>
        </Link>
        <Link to={`/koop/${seed}/handbuch`} className="mg-tile mg-tile-main">
          <span className="mg-tile-icon">📖</span>
          <span className="mg-tile-name">Experte</span>
          <span className="mg-muted">Sieht nur die Fragen und wo das Modul sitzt.</span>
        </Link>
      </div>
    </div>
  )
}

/** /koop/:seed/bombe — the defuser: nothing but the bomb. */
export function KoopBombPage() {
  const seed = useSeed()
  const plan = useCallback((questions: Question[]) => planKoop(questions, seed ?? 1), [seed])
  if (seed === null) return <NotFoundPage />
  return <Bomb modules={MODULES} plan={plan} view="defuser" />
}

/** /koop/:seed/handbuch — the expert: the questions for the same bomb, but not the answers. */
export function KoopManualPage() {
  const seed = useSeed()
  const [plan, setPlan] = useState<PlannedModule[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (seed === null) return
    const controller = new AbortController()
    fetchQuestions(controller.signal)
      .then((questions) => setPlan(planKoop(questions, seed)))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [seed])

  if (seed === null) return <NotFoundPage />

  return (
    <div className="mg-page">
      <header className="mg-header">
        <h1>📖 Handbuch · Bombe {seed}</h1>
      </header>
      <p className="mg-muted">
        Lass dir vom Entschärfer beschreiben, was auf dem Modul steht, und sag ihm, was er tun soll. Links und rechts
        gelten von der Timer-Seite aus gesehen.
      </p>
      {error && <p>⚠️ {error}</p>}
      {!plan && !error && <p className="mg-muted">Handbuch wird geladen…</p>}
      <ol className="koop-manual">
        {plan?.map((p, i) => (
          <li key={i} className="bomb-module">
            <span className="bomb-module-head">
              <span>{p.module.icon} {p.module.name}</span>
              <span>{SLOT_LABELS[i] ?? 'Nicht auf der Bombe'}</span>
            </span>
            <p className="mg-question">{p.task.prompt}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
