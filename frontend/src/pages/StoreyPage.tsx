import { useState } from 'react'
import { Link, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import { ISO_CAMERA } from '../components/cameras'
import Room from '../components/Room'
import { NO_FRONT_RIGHT } from '../components/roomWalls'
import Hud from '../components/Hud'
import { getHouse, getStorey } from '../data/houses'

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

  const [w, d] = house.footprint
  const selectedItem = storey.room.items.find((item) => item.id === selectedItemId)

  return (
    <>
      <SceneCanvas
        camera={{ position: ISO_CAMERA.position, zoom: 320, near: 0.1, far: 1000 }}
        controls={{ target: [0, 0.5, 0], minZoom: 60, maxZoom: 500 }}
        onPointerMissed={() => setSelectedItemId(null)}
      >
        <Room
          size={[w, storey.height, d]}
          floorColor={storey.room.floorColor}
          wallColor={storey.room.wallColor}
          walls={NO_FRONT_RIGHT}
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
        <div>Click an item to select &middot; click empty space to clear</div>
        <div>
          Selected: <strong>{selectedItem ? selectedItem.label : 'none'}</strong>
        </div>
      </Hud>
    </>
  )
}
