import { useState } from 'react'
import { Link, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import { ROOM_CAMERA, ROOM_PAN_LIMIT } from '../components/cameras'
import RoomStage from '../components/RoomStage'
import Hud from '../components/Hud'
import { getHouse, getStorey } from '../data/houses'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default function StoreyPage() {
  const { houseId = '', storeyId = '' } = useParams()
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

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

  const selectedItem = storey.room.items.find((item) => item.id === selectedItemId)

  return (
    <>
      <SceneCanvas
        camera={{ position: ROOM_CAMERA.position, zoom: ROOM_CAMERA.zoom, near: 0.1, far: 200 }}
        controls={{
          target: ROOM_CAMERA.target,
          enableZoom: false,
        }}
        panBounds={{ clamp: (x, _z) => [clamp(x, -ROOM_PAN_LIMIT, ROOM_PAN_LIMIT), 0] }}
        onPointerMissed={() => setSelectedItemId(null)}
        grid={false}
        responsiveZoom={false}
      >
        <RoomStage
          wallColor={storey.room.wallColor}
          floorColor={storey.room.floorColor}
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
        <div>Drag left or right to look around &middot; click an item to select</div>
        <div>
          Selected: <strong>{selectedItem ? selectedItem.label : 'none'}</strong>
        </div>
      </Hud>
    </>
  )
}
