import { Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import { ROOM_CAMERA, roomZoom } from '../components/cameras'
import RoomStage from '../components/RoomStage'
import BombTable, { BOMB_SPOT } from '../components/storey/BombTable'
import RoomBomb from '../components/storey/RoomBomb'
import RoomDecor from '../components/storey/RoomDecor'
import Hud from '../components/Hud'
import { useWallTextures } from '../components/facade/useHouseTextures'
import type { SurfaceSpec } from '../components/surfaces'
import type { House, Storey } from '../data/houses'
import type { ResolvedIsland } from '../data/islands'
import { useIslandHouse } from '../data/useIslandHouse'
import { DEFAULT_WALL_ATLAS, resolveParts } from '../data/houseParts'
import { resolveDesign } from '../data/baseDesigns'
import { getModule } from '../game/modules'
import Celebration from '../game/Celebration'
import { useBombGame } from '../game/useBombGame'
import { playSfx } from '../audio/sfx'
import { useAmbience } from '../audio/useAmbience'

/** Front and centre of the room, in front of the furniture. */
const BOMB_TABLE_POSITION: [number, number, number] = [0, 0, 4]
const BOMB_REST: [number, number, number] = [
  BOMB_TABLE_POSITION[0] + BOMB_SPOT[0],
  BOMB_TABLE_POSITION[1] + BOMB_SPOT[1],
  BOMB_TABLE_POSITION[2] + BOMB_SPOT[2],
]

/** Module the room's bomb is built from (for now always the cable module). */
const ROOM_MODULE = getModule('cables')
const ROOM_MODULES = ROOM_MODULE ? [ROOM_MODULE] : []
/** Shown on the bomb until the questions are there. */
const PLACEHOLDER_MODULES = ROOM_MODULES.map((m) => ({ id: m.id, status: 'active' as const }))

function StoreyRoom({ island, house, storey }: { island: ResolvedIsland; house: House; storey: Storey }) {
  const [lifted, setLifted] = useState(false)
  const game = useBombGame({ modules: ROOM_MODULES, paused: !lifted })
  const ready = game.load.status === 'ready'
  const { focused, back } = game
  useAmbience('room', !lifted)
  useAmbience('bomb', lifted)

  const lift = () => {
    playSfx('pickup')
    setLifted(true)
  }

  const putDown = () => {
    playSfx('putdown')
    setLifted(false)
  }

  // Esc: close the open module first, then put the bomb back on the table.
  useEffect(() => {
    if (!lifted) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (focused !== null) back()
      else putDown()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lifted, focused, back])

  const design = resolveDesign(house.facade.design)
  const atlas = house.facade.atlas ?? DEFAULT_WALL_ATLAS
  const wall = useWallTextures(house.facade.textures, design, atlas)
  const parts = resolveParts({ ...house.parts, ...storey.parts }, design.material.tint)

  const wallSurface: SurfaceSpec = {
    textures: wall.inner,
    color: parts.inner,
    emissive: '#000000',
    emissiveIntensity: 0,
    roughness: design.material.roughness,
    metalness: design.material.metalness,
    tileWidth: design.tiling.tileWidth,
    tileHeight: design.tiling.tileHeight,
  }

  const over = game.exploded || game.finished

  return (
    <>
      <SceneCanvas
        camera={{
          position: ROOM_CAMERA.position,
          rotation: ROOM_CAMERA.rotation,
          zoom: roomZoom({ width: window.innerWidth, height: window.innerHeight }),
          // orthographic: zoomed out on narrow screens, the floor reaches below the camera
          near: -20,
          far: 200,
        }}
        controls={false}
        grid={false}
        responsiveZoom={false}
      >
        <RoomStage
          wallColor={storey.room.wallColor}
          floorColor={storey.room.floorColor}
          wallSurface={wallSurface}
        />
        <RoomDecor />
        <BombTable position={BOMB_TABLE_POSITION} />
        <Suspense fallback={null}>
          <RoomBomb
            rest={BOMB_REST}
            lifted={lifted}
            onLift={lift}
            onPutDown={putDown}
            modules={ready ? game.bombModules : PLACEHOLDER_MODULES}
            focused={focused}
            onSelect={(index) => ready && game.select(index)}
            timeLeft={game.timeLeft}
            strikes={game.strikes}
          />
        </Suspense>
      </SceneCanvas>

      {focused === null && (
        <Hud title={storey.label}>
          <div className="hud-breadcrumb">
            <Link to={`/islands/${island.island.id}`}>{island.island.name}</Link> /{' '}
            <Link to={`/islands/${island.island.id}/houses/${house.id}`}>{house.name}</Link> /{' '}
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
  const { islandId = '', houseId = '', storeyId = '' } = useParams()
  const state = useIslandHouse(islandId, houseId)

  if (state.status === 'loading') return null

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
              No storey <strong>{storeyId}</strong> in house <strong>{houseId}</strong> on island{' '}
              <strong>{islandId}</strong>.
            </>
          )}
        </div>
        <div className="hud-links">
          <Link to={state.status === 'ready' ? `/islands/${islandId}/houses/${houseId}` : '/islands'}>Back</Link>
        </div>
      </Hud>
    )
  }

  return <StoreyRoom island={state.island} house={state.placed.house} storey={storey} />
}
