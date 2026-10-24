import { Suspense, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Link, useNavigate, useParams } from 'react-router'
import SceneCanvas from '../components/SceneCanvas'
import Room from '../components/Room'
import StoreyWallDressing from '../components/storey/StoreyWallDressing'
import Streets from '../components/city/Streets'
import Island from '../components/city/Island'
import { NO_FRONT } from '../components/roomWalls'
import Hud from '../components/Hud'
import { useWallTextures } from '../components/facade/useHouseTextures'
import { useInteriorTextures } from '../components/interior/useInteriorTextures'
import type { SurfaceSpec } from '../components/surfaces'
import { getHouse, houseHeight, type House, type Storey } from '../data/houses'
import {
  DEFAULT_WALL_ATLAS,
  decorForHouse,
  resolveParts,
  type Decor,
  type HouseParts,
} from '../data/houseParts'
import { resolveDesign } from '../data/baseDesigns'
import { resolveConcept } from '../data/storeyConcepts'
import type { InteriorDesign } from '../data/interiorTypes'
import { isDrag } from '../components/interaction'

const WALL_THICKNESS = 0.08

type StoreyRoomProps = {
  house: House
  storey: Storey
  index: number
  offset: number
  size: [number, number]
  outerSurface: SurfaceSpec
  innerSurface: SurfaceSpec
  parts: HouseParts
  decor: Decor
  ceiling?: boolean
  onClick: () => void
}

function StoreyRoom({
  house,
  storey,
  index,
  offset,
  size,
  outerSurface,
  innerSurface,
  parts,
  decor,
  ceiling = false,
  onClick,
}: StoreyRoomProps) {
  const [hovered, setHovered] = useState(false)
  const concept = resolveConcept(house.id, storey.id, index, storey.concept)
  const floorDesign = useMemo<InteriorDesign>(
    () => ({ motif: 'tiles', floor: house.storeys[0].room.floorColor, accent: house.facadeColor }),
    [house],
  )
  const interior = useInteriorTextures(house.id, floorDesign)

  const [w, d] = size
  const h = storey.height

  const floorSurface: SurfaceSpec = {
    textures: interior,
    color: floorDesign.floor,
    emissiveIntensity: 0.25,
    roughness: 0.7,
    metalness: 0,
    tileWidth: 2,
    tileHeight: 2,
  }

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (isDrag(event)) return
    event.stopPropagation()
    onClick()
  }

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <group
      position={[0, offset, 0]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <Room
        size={[w, h, d]}
        floorColor={storey.room.floorColor}
        wallColor={storey.room.wallColor}
        walls={ceiling ? { ...NO_FRONT, ceiling: true } : NO_FRONT}
        highlighted={hovered}
        outerSurface={outerSurface}
        innerSurface={innerSurface}
        floorSurface={floorSurface}
        ceilingSurface={innerSurface}
        edgeColor={parts.edge}
      />

      <group position={[0, h / 2, -d / 2 + WALL_THICKNESS / 2 + 0.005]}>
        <StoreyWallDressing
          width={w}
          height={h}
          parts={parts}
          decor={decor}
          label={concept.label}
          glow={hovered ? 1 : 0}
        />
      </group>
    </group>
  )
}

function HouseView({ house }: { house: House }) {
  const navigate = useNavigate()
  const design = resolveDesign(house.facade.design)
  const atlas = house.facade.atlas ?? DEFAULT_WALL_ATLAS
  const wall = useWallTextures(house.facade.textures, design, atlas)

  const totalHeight = houseHeight(house)
  const [w, d] = house.footprint
  const [blockX, blockZ] = house.position
  const offsets = house.storeys.map((_, index) =>
    house.storeys.slice(0, index).reduce((sum, storey) => sum + storey.height, 0),
  )

  const focusIndex = Math.floor((house.storeys.length - 1) / 2)
  const focusY = offsets[focusIndex] + house.storeys[focusIndex].height / 2

  const outerSurface: SurfaceSpec = {
    textures: wall.outer,
    color: design.material.tint,
    emissiveIntensity: design.material.emissiveIntensity,
    roughness: design.material.roughness,
    metalness: design.material.metalness,
    tileWidth: design.tiling.tileWidth,
    tileHeight: design.tiling.tileHeight,
  }

  const innerSurface: SurfaceSpec = {
    textures: wall.inner,
    color: design.material.tint,
    emissiveIntensity: design.material.emissiveIntensity,
    roughness: design.material.roughness,
    metalness: design.material.metalness,
    tileWidth: design.tiling.tileWidth,
    tileHeight: design.tiling.tileHeight,
  }

  return (
    <>
      <SceneCanvas
        camera={{ position: [1.8, focusY + 1.8, 16], zoom: 340, near: 0.1, far: 1000 }}
        controls={{ target: [0, focusY, 0] }}
        verticalScroll={{ min: 0.6, max: totalHeight - 0.6, step: 0.4 }}
        grid={false}
        fog={['#cfe8ff', 15, 26]}
      >
        <group position={[-blockX, -0.12, -blockZ]}>
          <Island />
          <Streets />
        </group>

        {house.storeys.map((storey, index) => {
          const parts = resolveParts({ ...house.parts, ...storey.parts }, design.material.tint)
          const decor = decorForHouse(house.decorColor ?? house.facadeColor, index)
          return (
            <StoreyRoom
              key={storey.id}
              house={house}
              storey={storey}
              index={index}
              offset={offsets[index]}
              size={[w, d / 2]}
              outerSurface={outerSurface}
              innerSurface={innerSurface}
              parts={parts}
              decor={decor}
              ceiling={index === house.storeys.length - 1}
              onClick={() => navigate(`/houses/${house.id}/storeys/${storey.id}`)}
            />
          )
        })}
      </SceneCanvas>

      <Hud title={house.name}>
        <div className="hud-breadcrumb">
          <Link to="/city">City</Link> / <span>{house.name}</span>
        </div>
        <div>Scroll or drag to move between storeys &middot; click a floor to open its room</div>
        <ul className="hud-links">
          {house.storeys.map((storey, index) => {
            const concept = resolveConcept(house.id, storey.id, index, storey.concept)
            return (
              <li key={storey.id}>
                <Link to={`/houses/${house.id}/storeys/${storey.id}`}>
                  {storey.label}
                  <span className="hud-concept">{concept.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Hud>
    </>
  )
}

export default function HousePage() {
  const { houseId = '' } = useParams()
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

  return (
    <Suspense fallback={null}>
      <HouseView house={house} />
    </Suspense>
  )
}
