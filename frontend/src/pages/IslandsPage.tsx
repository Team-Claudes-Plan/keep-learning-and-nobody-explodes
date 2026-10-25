import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import Skyscraper from '../components/Skyscraper'
import Streets from '../components/city/Streets'
import Island from '../components/city/Island'
import River from '../components/city/River'
import Traffic from '../components/city/Traffic'
import Animals from '../components/city/Animals'
import Birds from '../components/city/Birds'
import Hud from '../components/Hud'
import { HOUSES } from '../data/houses'
import { clampToShoreline } from '../data/island'

export default function CityPage() {
  const navigate = useNavigate()
  const [storeyDelta, setStoreyDelta] = useState(0)

  return (
    <>
      <SceneCanvas
        grid={false}
        controls={{ minZoom: 30, maxZoom: 300 }}
        panBounds={{ clamp: clampToShoreline }}
        onPointerMissed={() => undefined}
      >
        <Island />
        <Streets />
        <River />
        <Traffic />
        <Animals />
        <Birds />
        {HOUSES.map((house) => (
          <Skyscraper
            key={house.id}
            house={house}
            storeyDelta={storeyDelta}
            onClick={(id) => navigate(`/houses/${id}`)}
          />
        ))}
      </SceneCanvas>

      <Hud title="City">
        <div>Drag to pan &middot; Scroll to zoom</div>
        <div>The rocky shore is the edge of the world</div>
        <div>Click a building to enter</div>

        <div className="hud-section">Preview storeys</div>
        <div className="hud-buttons">
          {[-2, -1, 0, 1, 2, 4].map((delta) => (
            <button
              key={delta}
              type="button"
              className={storeyDelta === delta ? 'active' : ''}
              onClick={() => setStoreyDelta(delta)}
            >
              {delta === 0 ? 'Actual' : delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>

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
