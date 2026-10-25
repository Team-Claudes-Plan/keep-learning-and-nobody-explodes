import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import ArBombExperience, { type ArExperienceCallbacks } from '../ar/ArBombExperience'
import { BOMB_SLOTS } from '../ar/bombModel'
import { preloadXr8 } from '../ar/eighthWall'
import { AR_LEVELS, getModuleInfo } from '../ar/levels'
import Celebration from '../game/Celebration'
import { MODULES } from '../game/modules'
import { useBombGame } from '../game/useBombGame'

type Mode = 'preview' | 'ar'
type ArState = 'idle' | 'starting' | 'scanning' | 'placed' | 'error'

const BOMB_SIZE = 5
const MAX_STRIKES = 3

const STATUS_TEXT: Record<ArState, string> = {
  idle: '',
  starting: '8th Wall startet · Kamera wird geöffnet …',
  scanning: 'Boden suchen · bewege das Handy langsam und tippe dann auf die Fläche',
  placed: '',
  error: 'AR konnte nicht gestartet werden',
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Eleven slot ids: the planned modules first, the rest are open empty bays. */
function padSlots(ids: string[]) {
  return Array.from({ length: BOMB_SLOTS }, (_, index) => ids[index] ?? 'blank')
}

function placeholderSlots(level: (typeof AR_LEVELS)[number]) {
  return padSlots(level.slots.slice(0, BOMB_SIZE))
}

/**
 * Playable AR bomb: pick a level (module pool), look at the bomb, open it in the room and tap a
 * module. The bomb pulls that module in front of you while its 2D task opens below it.
 */
export default function ArDemoPage() {
  const [levelIndex, setLevelIndex] = useState(0)
  const [mode, setMode] = useState<Mode>('preview')
  const [arState, setArState] = useState<ArState>('idle')
  const [arPlaced, setArPlaced] = useState(false)
  const [previewReady, setPreviewReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const experienceRef = useRef<ArBombExperience | null>(null)
  const activeLevelRef = useRef<HTMLButtonElement>(null)
  const hintTimer = useRef<number | null>(null)
  const level = AR_LEVELS[levelIndex]
  const gameRef = useRef<ReturnType<typeof useBombGame> | null>(null)
  const modulePool = useMemo(() => MODULES.filter((module) => level.modules.includes(module.id)), [level])

  const game = useBombGame({
    modules: modulePool,
    size: BOMB_SIZE,
    flatControls: true,
    paused: mode !== 'ar' || !arPlaced,
  })

  const planIds = game.bombModules.map((module) => module.id)
  const slotKey = planIds.join(',')
  const statuses = game.bombModules.map((module) => module.status)
  const statusKey = statuses.join(',')
  // While the questions are loading, show a plausible bomb from the level instead of empty bays.
  const slots = padSlots(planIds.length > 0 ? planIds : level.slots.slice(0, BOMB_SIZE))

  gameRef.current = game

  const showHint = useCallback((message: string) => {
    setHint(message)
    if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(null), 3600)
  }, [])

  // The experience owns the canvas; React only tells it which bomb to show and what is focused.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const callbacks: ArExperienceCallbacks = {
      onPreviewReady: () => {
        setPreviewReady(true)
        setArState('idle')
      },
      onArReady: () => setArState('scanning'),
      onPlaced: (placed) => {
        setArPlaced(placed)
        setArState(placed ? 'placed' : 'scanning')
      },
      onHint: showHint,
      onError: showHint,
      onFatal: (message) => {
        setMode('preview')
        setArPlaced(false)
        setArState('error')
        setPreviewReady(false)
        setError(message)
        gameRef.current?.back()
      },
      onModuleTap: (index) => gameRef.current?.select(index),
      onBackgroundTap: () => gameRef.current?.back(),
    }

    const experience = new ArBombExperience(stage, AR_LEVELS[0], callbacks)
    experienceRef.current = experience
    void experience.showPreview(AR_LEVELS[0], placeholderSlots(AR_LEVELS[0]))

    // Warm up the engine while the visitor looks at the 3D preview, so "AR starten" feels instant.
    const warmup = window.setTimeout(() => preloadXr8(), 1800)

    return () => {
      window.clearTimeout(warmup)
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
      experienceRef.current = null
      void experience.dispose()
    }
  }, [showHint])

  // New plan or level: rebuild the bomb, keeping its position in AR.
  useEffect(() => {
    experienceRef.current?.setBomb(level, slots)
    // `slots` is derived from `slotKey`; the array identity is not meaningful here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, level.id])

  useEffect(() => {
    experienceRef.current?.setFocused(game.focused)
  }, [game.focused])

  useEffect(() => {
    experienceRef.current?.setGameStatus(statuses, game.timeLeft, game.strikes)
    // `statuses` is covered by `statusKey`; using the array would fire on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey, game.timeLeft, game.strikes])

  // Keep the selected level visible in the horizontal strip (it can start off-screen).
  useEffect(() => {
    activeLevelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [levelIndex])

  function startAr() {
    game.back()
    setError(null)
    setMode('ar')
    setArState('starting')
    setArPlaced(false)
    void experienceRef.current?.startAr(level, slots)
  }

  function backToPreview() {
    game.back()
    setError(null)
    setMode('preview')
    setArState('idle')
    setArPlaced(false)
    setPreviewReady(false)
    void experienceRef.current?.showPreview(level, slots)
  }

  function restartGame() {
    game.back()
    game.restart()
  }

  const statusText = STATUS_TEXT[arState]
  const gameReady = game.load.status === 'ready'
  const showHud = mode === 'ar' && arState === 'placed' && gameReady && !game.outcome
  const showScanStatus =
    mode === 'ar' && (arState === 'starting' || arState === 'scanning' || (arState === 'placed' && !gameReady))
  const showInfo = mode === 'preview' && game.focused === null

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

      {showInfo && (
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
              {level.modules.length} Modularten im Pool · {gameReady ? game.shown : BOMB_SIZE} Module auf der Bombe
            </p>
            <p className="ar-note">
              Tippe ein Modul an: Es kommt zu dir und öffnet sich als 2D-Aufgabe.
            </p>
            <p className="ar-note is-faint">In AR starten, Bombe platzieren, losspielen.</p>
          </section>
        </>
      )}

      {mode === 'ar' && (
        <div className="ar-ar-ui">
          {showScanStatus && (
            <div className={`ar-status is-${arState}`} role="status" aria-live="polite">
              <span className="ar-status-dot" aria-hidden />
              {arState === 'placed' ? 'Bombe wird scharf gemacht …' : statusText}
            </div>
          )}

          {showHud && (
            <div
              className="ar-hud"
              aria-label={`${formatTime(game.timeLeft)}, ${game.strikes} von ${MAX_STRIKES} Strikes, ${game.correct} von ${game.shown} entschärft`}
            >
              <span className={`ar-hud-timer ${game.timeLeft <= 30 ? 'is-low' : ''}`}>
                {formatTime(game.timeLeft)}
              </span>
              <span className="ar-hud-strikes" aria-label={`${game.strikes} von ${MAX_STRIKES} Strikes`}>
                {Array.from({ length: MAX_STRIKES }, (_, index) => (
                  <span key={index} className={index < game.strikes ? 'is-hit' : ''} />
                ))}
              </span>
              <span className="ar-hud-progress">
                {game.correct}/{game.shown}
              </span>
            </div>
          )}

          {arState === 'starting' && (
            <div className="ar-starting-card">
              <span className="ar-spinner" aria-hidden />
              <p>8th Wall öffnet die Kamera …</p>
              <small>Bitte den Kamerazugriff erlauben.</small>
            </div>
          )}

          {arState === 'placed' && game.focused === null && !game.outcome && (
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

      {game.focused !== null && game.card && (
        <div className="ar-game-card" role="dialog" aria-label="Modul entschärfen">
          <div className="ar-game-card-head">
            <button className="ar-game-card-back" onClick={() => game.back()}>
              ← Zurück zur Bombe
            </button>
            <span>
              {game.correct}/{game.shown} entschärft · {game.strikes}/{MAX_STRIKES} Strikes
            </span>
          </div>
          <div className="ar-game-card-body">{game.card}</div>
        </div>
      )}

      {hint && game.focused === null && <div className="ar-hint">{hint}</div>}

      {game.load.status === 'error' && !error && (
        <div className="ar-error" role="alert">
          <strong>Fragen konnten nicht geladen werden</strong>
          <p>{game.load.message}</p>
          <div className="ar-error-actions">
            <button className="is-primary" onClick={restartGame}>
              Erneut versuchen
            </button>
          </div>
        </div>
      )}

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

      {game.outcome && (
        <div className={`ar-outcome is-${game.outcome}`} role="status" aria-live="assertive">
          {game.outcome === 'boom' && <div className="ar-boom-flash" aria-hidden />}
          {game.outcome === 'defused' && <Celebration />}
          <div className="ar-outcome-card">
            <strong>{game.outcome === 'boom' ? '💥 BOOM' : '✅ Entschärft'}</strong>
            <p>
              {game.outcome === 'boom'
                ? 'Die Bombe ist hochgegangen. Neuer Versuch?'
                : `${game.correct} von ${game.shown} Modulen entschärft.`}
            </p>
            <button onClick={restartGame}>Neue Bombe</button>
          </div>
        </div>
      )}

      {game.focused === null && !game.outcome && (
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
      )}
    </div>
  )
}
