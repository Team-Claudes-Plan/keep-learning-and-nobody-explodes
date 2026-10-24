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
import { FACADE_SHAPES } from '../data/facadeShapes'
import { BASE_DESIGNS } from '../data/baseDesigns'
import { clampToShoreline } from '../data/island'

export default function CityPage() {
  const navigate = useNavigate()
  const [overrideShape, setOverrideShape] = useState<string | null>(null)
  const [overrideDesign, setOverrideDesign] = useState<string | null>(null)

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
            overrideShape={overrideShape}
            overrideDesign={overrideDesign}
            onClick={(id) => navigate(`/houses/${id}`)}
          />
        ))}
      </SceneCanvas>

      <Hud title="City">
        <div>Drag to pan &middot; Scroll to zoom</div>
        <div>The rocky shore is the edge of the world</div>
        <div>Click a building to enter</div>

        <div className="hud-section">Preview shape</div>
        <div className="hud-buttons">
          <button
            type="button"
            className={overrideShape === null ? 'active' : ''}
            onClick={() => setOverrideShape(null)}
          >
            Per house
          </button>
          {Object.values(FACADE_SHAPES).map((shape) => (
            <button
              key={shape.id}
              type="button"
              className={overrideShape === shape.id ? 'active' : ''}
              onClick={() => setOverrideShape(shape.id)}
            >
              {shape.label}
            </button>
          ))}
        </div>

        <div className="hud-section">Preview design</div>
        <div className="hud-buttons">
          <button
            type="button"
            className={overrideDesign === null ? 'active' : ''}
            onClick={() => setOverrideDesign(null)}
          >
            Per house
          </button>
          {Object.values(BASE_DESIGNS).map((design) => (
            <button
              key={design.id}
              type="button"
              className={overrideDesign === design.id ? 'active' : ''}
              onClick={() => setOverrideDesign(design.id)}
            >
              {design.label}
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
