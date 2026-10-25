import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import ArBombExperience, { type ArExperienceCallbacks } from '../ar/ArBombExperience'
import { preloadXr8 } from '../ar/eighthWall'
import { AR_LEVELS, getModuleInfo } from '../ar/levels'

type Mode = 'preview' | 'ar'
type ArState = 'idle' | 'starting' | 'scanning' | 'placed' | 'error'

const STATUS_TEXT: Record<ArState, string> = {
  idle: '',
  starting: '8th Wall startet · Kamera wird geöffnet …',
  scanning: 'Boden suchen · bewege das Handy langsam und tippe dann auf die Fläche',
  placed: 'Platziert · ziehen dreht die Bombe, Pinch ändert die Größe',
  error: 'AR konnte nicht gestartet werden',
}

/**
 * Mini AR demo for the bomb: pick one of the learning levels (or the all-modules bomb), look at it
 * on the turntable, then open it in the room with 8th Wall world tracking and tap to place it.
 */
export default function ArDemoPage() {
  const [levelIndex, setLevelIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('preview')
  const [arState, setArState] = useState<ArState>('idle')
  const [previewReady, setPreviewReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const experienceRef = useRef<ArBombExperience | null>(null)
  const activeLevelRef = useRef<HTMLButtonElement>(null)
  const hintTimer = useRef<number | null>(null)
  const level = AR_LEVELS[levelIndex]

  function showHint(message: string) {
    setHint(message)
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(null), 3600)
  }

  // The experience owns the canvas, so it is created once and then only told about level changes.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const callbacks: ArExperienceCallbacks = {
      onPreviewReady: () => {
        setPreviewReady(true)
        setArState('idle')
      },
      onArReady: () => setArState('scanning'),
      onPlaced: (placed) => setArState(placed ? 'placed' : 'scanning'),
      onHint: showHint,
      onError: showHint,
      onFatal: (message) => {
        setMode('preview')
        setArState('error')
        setPreviewReady(false)
        setError(message)
      },
    }

    const experience = new ArBombExperience(stage, AR_LEVELS[0], callbacks)
    experienceRef.current = experience
    void experience.showPreview(AR_LEVELS[0])

    // Warm up the engine while the visitor looks at the 3D preview, so "AR starten" feels instant.
    const warmup = window.setTimeout(() => preloadXr8(), 1800)

    return () => {
      window.clearTimeout(warmup)
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
      experienceRef.current = null
      void experience.dispose()
    }
  }, [])

  useEffect(() => {
    if (!experienceRef.current) return
    experienceRef.current.setLevel(level)
  }, [level])

  // Keep the selected level visible in the horizontal strip (it can start off-screen).
  useEffect(() => {
    activeLevelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [levelIndex])

  function startAr() {
    setError(null)
    setMode('ar')
    setArState('starting')
    void experienceRef.current?.startAr(level)
  }

  function backToPreview() {
    setError(null)
    setMode('preview')
    setArState('idle')
    setPreviewReady(false)
    void experienceRef.current?.showPreview(level)
  }

  const statusText = STATUS_TEXT[arState]

  return (
    <div className={`ar-page is-${mode}`} style={{ '--ar-accent': level.accent } as CSSProperties}>
      <div ref={stageRef} className="ar-stage" />

      <header className="ar-topbar">
        <Link to="/minigames" className="ar-back" aria-label="Zurück zu den Minigames">
          <span aria-hidden>←</span> Minigames
        </Link>
        <div className="ar-brand">
          <span className="ar-brand-mark" aria-hidden>
            💣
          </span>
          <span>
            <strong>Bombe in AR</strong>
            <small>8th Wall · World Tracking</small>
          </span>
        </div>
        {mode === 'preview' ? (
          <button className="ar-cta" onClick={startAr}>
            AR starten
          </button>
        ) : (
          <button className="ar-cta is-ghost" onClick={backToPreview}>
            AR beenden
          </button>
        )}
      </header>

      {mode === 'preview' && (
        <>
          {!previewReady && !error && (
            <div className="ar-loading">
              <span className="ar-spinner" aria-hidden />
              <p>Bombe wird aufgebaut …</p>
            </div>
          )}

          <section className="ar-info">
            <p className="ar-kicker">
              {level.number !== null ? `Level ${level.number}` : 'Finale'} · {level.subtitle}
            </p>
            <h1>{level.label}</h1>
            <p className="ar-description">{level.description}</p>
            <div className="ar-module-list">
              {level.modules.map((id) => {
                const info = getModuleInfo(id)
                if (!info) return null
                return (
                  <span key={id} className="ar-module" title={info.name}>
                    <span aria-hidden>{info.icon}</span>
                    {info.name}
                  </span>
                )
              })}
            </div>
            <p className="ar-note">
              {level.modules.length} Modularten · alle 11 Slots belegt · mit 8th Wall im Raum platzierbar
            </p>
            <p className="ar-note is-faint">Für AR: Kamera erlauben und die Seite über HTTPS öffnen.</p>
          </section>
        </>
      )}

      {mode === 'ar' && (
        <div className="ar-ar-ui">
          <div className={`ar-status is-${arState}`} role="status" aria-live="polite">
            <span className="ar-status-dot" aria-hidden />
            {statusText}
          </div>

          {arState === 'starting' && (
            <div className="ar-starting-card">
              <span className="ar-spinner" aria-hidden />
              <p>8th Wall öffnet die Kamera …</p>
              <small>Bitte den Kamerazugriff erlauben.</small>
            </div>
          )}

          {arState === 'placed' && (
            <div className="ar-controls">
              <button onClick={() => experienceRef.current?.scaleBy(0.82)} aria-label="Bombe verkleinern">
                −
              </button>
              <button onClick={() => experienceRef.current?.rotateBy(-Math.PI / 12)} aria-label="Bombe nach links drehen">
                ⟲
              </button>
              <button onClick={() => experienceRef.current?.rotateBy(Math.PI / 12)} aria-label="Bombe nach rechts drehen">
                ⟳
              </button>
              <button onClick={() => experienceRef.current?.scaleBy(1.22)} aria-label="Bombe vergrößern">
                +
              </button>
              <button className="is-wide" onClick={() => experienceRef.current?.placeAgain()}>
                Neu platzieren
              </button>
            </div>
          )}
        </div>
      )}

      {hint && <div className="ar-hint">{hint}</div>}

      {error && (
        <div className="ar-error" role="alert">
          <strong>Das hat nicht geklappt</strong>
          <p>{error}</p>
          <div className="ar-error-actions">
            <button onClick={mode === 'ar' ? backToPreview : () => setError(null)}>
              {mode === 'ar' ? 'Zur Vorschau' : 'Schließen'}
            </button>
            {mode === 'preview' && (
              <button className="is-primary" onClick={startAr}>
                Nochmal versuchen
              </button>
            )}
          </div>
        </div>
      )}

      <nav className={`ar-levels is-${mode}`} aria-label="Level auswählen">
        <span className="ar-levels-label">Level</span>
        <div className="ar-level-track">
          {AR_LEVELS.map((entry, index) => (
            <button
              key={entry.id}
              ref={index === levelIndex ? activeLevelRef : undefined}
              className={`ar-level ${index === levelIndex ? 'is-active' : ''}`}
              style={{ '--level-accent': entry.accent } as CSSProperties}
              onClick={() => setLevelIndex(index)}
              aria-pressed={index === levelIndex}
            >
              <span className="ar-level-number" aria-hidden>
                {entry.number ?? '★'}
              </span>
              <span className="ar-level-copy">
                <strong>{entry.label}</strong>
                <small>{entry.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
