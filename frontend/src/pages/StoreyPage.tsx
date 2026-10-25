import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { StoreyBombRoom } from '../components/storey/BombRoom'
import Hud from '../components/Hud'
import type { Storey } from '../data/houses'
import type { PlacedHouse, ResolvedIsland } from '../data/islands'
import { useIslandHouse } from '../data/useIslandHouse'
import { getModule } from '../game/modules'
import Celebration from '../game/Celebration'
import { useBombGame } from '../game/useBombGame'

/** Module the room's bomb is built from (for now always the cable module). */
const ROOM_MODULE = getModule('cables')
const ROOM_MODULES = ROOM_MODULE ? [ROOM_MODULE] : []
/** Shown on the bomb until the questions are there. */
const PLACEHOLDER_MODULES = ROOM_MODULES.map((m) => ({ id: m.id, status: 'active' as const }))

function StoreyRoom({ island, placed, storey }: { island: ResolvedIsland; placed: PlacedHouse; storey: Storey }) {
  const { house } = placed
  const [lifted, setLifted] = useState(false)
  const game = useBombGame({ modules: ROOM_MODULES, paused: !lifted })
  const ready = game.load.status === 'ready'
  const { focused, back } = game

  // Esc: close the open module first, then put the bomb back on the table.
  useEffect(() => {
    if (!lifted) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (focused !== null) back()
      else setLifted(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lifted, focused, back])

  const over = game.exploded || game.finished

  return (
    <>
      <StoreyBombRoom
        house={house}
        storey={storey}
        lifted={lifted}
        onLift={() => setLifted(true)}
        onPutDown={() => setLifted(false)}
        modules={ready ? game.bombModules : PLACEHOLDER_MODULES}
        focused={focused}
        onSelect={(index) => ready && game.select(index)}
        timeLeft={game.timeLeft}
        strikes={game.strikes}
      />

      {focused === null && (
        <Hud title={storey.label}>
          <div className="hud-breadcrumb">
            <Link to={`/islands/${island.island.id}`}>{island.island.name}</Link> /{' '}
            <Link to={`/islands/${island.island.id}/houses/${placed.topicId}`}>{placed.name}</Link> /{' '}
            <span>{storey.label}</span>
          </div>
          <div>
            {lifted ? 'Drag to turn the bomb · click a module · Esc puts it back' : 'Click the bomb to pick it up'}
          </div>
          {game.load.status === 'error' && <div>⚠️ {game.load.message}</div>}
        </Hud>
      )}

      <div className="room-bomb-ui">
        {focused !== null && game.card && (
          <div className={`bomb-zoom is-${game.focusedOnBomb ? 'side' : 'center'}`}>
            <div className="bomb-zoom-panel">{game.card}</div>
          </div>
        )}
        {lifted && game.outcome === 'defused' && <Celebration />}
        {lifted && over && (
          <button className={`bomb-screen-result ${game.exploded ? 'is-bad' : 'is-good'}`} onClick={game.restart}>
            {game.exploded ? '💥 BOOM' : '✅ Entschärft'}
            <small>Neue Bombe</small>
          </button>
        )}
      </div>
    </>
  )
}

export default function StoreyPage() {
  const { islandId = '', topicId = '', storeyId = '' } = useParams()
  const state = useIslandHouse(islandId, topicId)

  if (state.status === 'loading') return null
  if (state.status === 'signed-out') return <Navigate to="/islands" replace />

  // Only storeys up to the house's level on this island can be entered.
  const storey = state.status === 'ready' ? state.placed.house.storeys.find((entry) => entry.id === storeyId) : undefined

  if (state.status !== 'ready' || !storey) {
    return (
      <Hud title="Storey not found">
        <div>
          {state.status === 'error' ? (
            <>⚠️ {state.message}</>
          ) : (
            <>
              No storey <strong>{storeyId}</strong> in house <strong>{topicId}</strong> on island{' '}
              <strong>{islandId}</strong>.
            </>
          )}
        </div>
        <div className="hud-links">
          <Link to={state.status === 'ready' ? `/islands/${islandId}/houses/${topicId}` : '/islands'}>Back</Link>
        </div>
      </Hud>
    )
  }

  return <StoreyRoom island={state.island} placed={state.placed} storey={storey} />
}
