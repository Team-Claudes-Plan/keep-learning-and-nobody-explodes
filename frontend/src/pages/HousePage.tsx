import { Link, useNavigate, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import Room from '../components/Room'
import { NO_FRONT } from '../components/roomWalls'
import Hud from '../components/Hud'
import { getHouse, houseHeight } from '../data/houses'

export default function HousePage() {
  const { houseId = '' } = useParams()
  const navigate = useNavigate()
  const house = getHouse(houseId)

  if (!house) {
    return (
      <Hud title="House not found">
        <div>
          No house with id <strong>{houseId}</strong>.
        </div>
        <div className="hud-links">
          <Link to="/city">Back to city</Link>
        </div>
      </Hud>
    )
  }

  const totalHeight = houseHeight(house)
  const [w, d] = house.footprint
  const offsets = house.storeys.map((_, index) =>
    house.storeys
      .slice(0, index)
      .reduce((sum, storey) => sum + storey.height, 0),
  )

  const focusIndex = Math.floor((house.storeys.length - 1) / 2)
  const focusY = offsets[focusIndex] + house.storeys[focusIndex].height / 2

  return (
    <>
      <SceneCanvas
        camera={{ position: [1.8, focusY + 1.8, 16], zoom: 340, near: 0.1, far: 1000 }}
        controls={{ target: [0, focusY, 0] }}
        verticalScroll={{ min: 0.6, max: totalHeight - 0.6, step: 0.4 }}
      >
        {house.storeys.map((storey, index) => {
          return (
            <Room
              key={storey.id}
              position={[0, offsets[index], 0]}
              size={[w, storey.height, d]}
              floorColor={storey.room.floorColor}
              wallColor={storey.room.wallColor}
              walls={NO_FRONT}
              items={storey.room.items}
              interactiveItems={false}
              onClick={() => navigate(`/houses/${house.id}/storeys/${storey.id}`)}
            />
          )
        })}
      </SceneCanvas>

      <Hud title={house.name}>
        <div className="hud-breadcrumb">
          <Link to="/city">City</Link> / <span>{house.name}</span>
        </div>
        <div>Scroll or drag to move between storeys &middot; click a storey to open its room</div>
        <ul className="hud-links">
          {house.storeys.map((storey) => (
            <li key={storey.id}>
              <Link to={`/houses/${house.id}/storeys/${storey.id}`}>{storey.label}</Link>
            </li>
          ))}
        </ul>
      </Hud>
    </>
  )
}
