import { useState } from 'react'
import { Link, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import { ROOM_CAMERA, ROOM_MAX_ZOOM, ROOM_MIN_ZOOM } from '../components/cameras'
import RoomStage from '../components/RoomStage'
import Hud from '../components/Hud'
import { useWallTextures } from '../components/facade/useHouseTextures'
import type { SurfaceSpec } from '../components/surfaces'
import { getHouse, getStorey, type House, type Storey } from '../data/houses'
import { DEFAULT_WALL_ATLAS, resolveParts } from '../data/houseParts'
import { resolveDesign } from '../data/baseDesigns'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function StoreyRoom({ house, storey }: { house: House; storey: Storey }) {
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

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

  const [w, d] = house.footprint
  const selectedItem = storey.room.items.find((item) => item.id === selectedItemId)

  return (
    <>
      <SceneCanvas
        camera={{ position: ROOM_CAMERA.position, zoom: ROOM_CAMERA.zoom, near: 0.1, far: 200 }}
        controls={{
          target: ROOM_CAMERA.target,
          minZoom: ROOM_MIN_ZOOM,
          maxZoom: ROOM_MAX_ZOOM,
        }}
        panBounds={{ clamp: (x, z) => [clamp(x, -w / 2, w / 2), clamp(z, -d / 2, d / 2)] }}
        onPointerMissed={() => setSelectedItemId(null)}
        grid={false}
        responsiveZoom={false}
      >
        <RoomStage
          wallColor={storey.room.wallColor}
          floorColor={storey.room.floorColor}
          wallSurface={wallSurface}
          items={storey.room.items}
          selectedItemId={selectedItemId}
          onSelectItem={setSelectedItemId}
        />
      </SceneCanvas>

      <Hud title={storey.label}>
        <div className="hud-breadcrumb">
          <Link to="/city">City</Link> / <Link to={`/houses/${house.id}`}>{house.name}</Link> /{' '}
          <span>{storey.label}</span>
        </div>
        <div>Drag to look around the room &middot; click an item to select</div>
        <div>
          Selected: <strong>{selectedItem ? selectedItem.label : 'none'}</strong>
        </div>
      </Hud>
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
