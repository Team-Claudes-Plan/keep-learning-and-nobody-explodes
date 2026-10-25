import { Suspense, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { previewHeights, type House } from '../data/houses'
import Facade from './facade/Facade'
import KitFacade from './facade/KitFacade'
import { isDrag } from './interaction'

type SkyscraperProps = {
  /** The house as built on its island (see houseAtLevel). */
  house: House
  position: [number, number]
  onClick: (id: string) => void
  /** Preview only: show this many more (or fewer) storeys than the house has. */
  storeyDelta?: number
}

export default function Skyscraper({ house, position, onClick, storeyDelta = 0 }: SkyscraperProps) {
  const [hovered, setHovered] = useState(false)
  const [w, d] = house.footprint
  const storeyHeights = useMemo(() => previewHeights(house, storeyDelta), [house, storeyDelta])
  const height = storeyHeights.reduce((sum, h) => sum + h, 0)
  const [x, z] = position

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (isDrag(event)) return
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
        {house.kit ? (
          <KitFacade kit={house.kit} footprint={house.footprint} storeyHeights={storeyHeights} hovered={hovered} />
        ) : (
          <Facade
            house={house}
            shapeId={house.facade.shape}
            designId={house.facade.design}
            hovered={hovered}
            roofColor={house.facade.roofColor}
          />
        )}
      </Suspense>

      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[w, height, d]} />
        <meshStandardMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </group>
  )
}
