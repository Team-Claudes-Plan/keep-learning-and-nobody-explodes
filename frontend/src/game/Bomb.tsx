import type { Question, QuestionType } from '../api/types'
import Bomb3D from './Bomb3D'
import type { ModuleDef } from './modules/types'
import type { PlannedModule } from './plan'
import { QUESTION_TYPE_LABELS, QUESTION_TYPES } from './questionTypes'
import { useBombGame, type Mode } from './useBombGame'

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
}

/** Full-screen 3D bomb, nothing else: click a module to zoom in and work on it. */
export default function Bomb({ modules, plan: fixedPlan, view = 'solo', testBar = false, practice = false }: BombProps) {
  const game = useBombGame({ modules, plan: fixedPlan, view, testBar, practice })

  if (game.load.status === 'error') {
    return (
      <div className="bomb-screen">
        <div className="bomb-screen-message">
          <p>⚠️ {game.load.message}</p>
          <button className="mg-button" onClick={game.restart}>Erneut versuchen</button>
        </div>
      </div>
    )
  }

  if (game.load.status === 'loading') {
    return (
      <div className="bomb-screen">
        <p className="bomb-screen-message">Bombe wird scharf gemacht…</p>
      </div>
    )
  }

  return (
    <div className="bomb-screen">
      <Bomb3D
        bare
        modules={game.bombModules}
        focused={game.focused}
        overlay={game.focusedOnBomb ? 'side' : 'center'}
        onSelect={game.select}
        onBack={game.back}
        timeLeft={game.timeLeft}
        strikes={game.strikes}
        exploded={game.exploded}
      >
        {game.card}
      </Bomb3D>
      {testBar && (
        <TestBar
          mode={game.mode}
          playable={game.playable}
          shown={game.shown}
          planned={game.planned}
          onMode={game.changeMode}
          onRestart={game.restart}
        />
      )}
      {game.shown === 0 && <p className="bomb-screen-message">Keine passenden Aufgaben für diese Module.</p>}
      {game.outcome && (
        <button className={`bomb-screen-result ${game.outcome === 'boom' ? 'is-bad' : 'is-good'}`} onClick={game.restart}>
          {game.outcome === 'boom' ? '💥 BOOM' : game.outcome === 'defused' ? '✅ Entschärft' : '🧪 Test fertig'}
          {game.outcome === 'test' && (
            <small>
              {game.correct} richtig · {game.strikes} falsch
            </small>
          )}
          {!fixedPlan && <small>{game.outcome === 'test' ? 'Nochmal' : 'Neue Bombe'}</small>}
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
