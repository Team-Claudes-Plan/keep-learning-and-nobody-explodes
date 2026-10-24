import { Suspense, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import { ROOM_CAMERA } from '../components/cameras'
import RoomStage from '../components/RoomStage'
import BombTable, { BOMB_SPOT } from '../components/storey/BombTable'
import RoomBomb from '../components/storey/RoomBomb'
import RoomDecor from '../components/storey/RoomDecor'
import Hud from '../components/Hud'
import { useWallTextures } from '../components/facade/useHouseTextures'
import type { SurfaceSpec } from '../components/surfaces'
import { getHouse, getStorey, type House, type Storey } from '../data/houses'
import { DEFAULT_WALL_ATLAS, resolveParts } from '../data/houseParts'
import { resolveDesign } from '../data/baseDesigns'
import { getModule } from '../game/modules'
import { useBombGame } from '../game/useBombGame'

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

function StoreyRoom({ house, storey }: { house: House; storey: Storey }) {
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
          zoom: ROOM_CAMERA.zoom,
          near: 0.1,
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
            onLift={() => setLifted(true)}
            onPutDown={() => setLifted(false)}
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
            <Link to="/city">City</Link> / <Link to={`/houses/${house.id}`}>{house.name}</Link> /{' '}
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
  const { houseId = '', storeyId = '' } = useParams()

  const house = getHouse(houseId)
  const storey = getStorey(houseId, storeyId)

  if (!house || !storey) {
    return (
      <Hud title="Storey not found">
        <div>
          No storey <strong>{storeyId}</strong> in house <strong>{houseId}</strong>.
        </div>
        <div className="hud-links">
          <Link to="/city">Back to city</Link>
        </div>
      </Hud>
    )
  }

  return <StoreyRoom house={house} storey={storey} />
}
