import { Link, useNavigate } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import Skyscraper from '../components/Skyscraper'
import Hud from '../components/Hud'
import { HOUSES } from '../data/houses'

export default function CityPage() {
  const navigate = useNavigate()

  return (
    <>
      <SceneCanvas onPointerMissed={() => undefined}>
        {HOUSES.map((house) => (
          <Skyscraper
            key={house.id}
            house={house}
            onClick={(id) => navigate(`/houses/${id}`)}
          />
        ))}
      </SceneCanvas>

      <Hud title="City">
        <div>Drag to pan &middot; Scroll to zoom</div>
        <div>Click a building to enter</div>
        <ul className="hud-links">
          {HOUSES.map((house) => (
            <li key={house.id}>
              <Link to={`/houses/${house.id}`}>{house.name}</Link>
            </li>
          ))}
        </ul>
      </Hud>
    </>
  )
}
