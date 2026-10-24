import { Suspense, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { House } from '../data/houses'
import { houseHeight } from '../data/houses'
import Facade from './facade/Facade'

type SkyscraperProps = {
  house: House
  onClick: (id: string) => void
  overrideShape?: string | null
  overrideDesign?: string | null
}

export default function Skyscraper({ house, onClick, overrideShape, overrideDesign }: SkyscraperProps) {
  const [hovered, setHovered] = useState(false)
  const [w, d] = house.footprint
  const height = houseHeight(house)
  const [x, z] = house.position

  const shapeId = overrideShape ?? house.facade.shape
  const designId = overrideDesign ?? house.facade.design

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onClick(house.id)
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
      position={[x, 0, z]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <Suspense
        fallback={
          <mesh position={[0, height / 2, 0]}>
            <boxGeometry args={[w, height, d]} />
            <meshStandardMaterial color={house.facadeColor} roughness={0.5} metalness={0.15} />
          </mesh>
        }
      >
        <Facade
          house={house}
          shapeId={shapeId}
          designId={designId}
          hovered={hovered}
          roofColor={house.facade.roofColor}
        />
      </Suspense>

      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w, height, d]} />
        <meshStandardMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}
