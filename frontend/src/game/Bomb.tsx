import type { Question } from '../api/types'
import Bomb3D from './Bomb3D'
import type { ModuleDef } from './modules/types'
import type { PlannedModule } from './plan'
import { useBombGame } from './useBombGame'

type BombProps = {
  /** Modules the bomb may use. */
  modules: ModuleDef[]
  /** Fixed plan (e.g. seeded for koop) instead of a random one. */
  plan?: (questions: Question[]) => PlannedModule[]
  /** 'defuser': no prompts on the bomb (the expert has those); 'solo': prompt shown next to the zoomed module. */
  view?: 'solo' | 'defuser'
}

/** Full-screen 3D bomb, nothing else: click a module to zoom in and work on it. */
export default function Bomb({ modules, plan, view = 'solo' }: BombProps) {
  const game = useBombGame({ modules, plan, view })

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
      >
        {game.card}
      </Bomb3D>
      {(game.exploded || game.finished) && (
        <button className={`bomb-screen-result ${game.exploded ? 'is-bad' : 'is-good'}`} onClick={game.restart}>
          {game.exploded ? '💥 BOOM' : '✅ Entschärft'}
          {!plan && <small>Neue Bombe</small>}
        </button>
      )}
    </div>
  )
}
