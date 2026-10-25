import { Suspense, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { previewHeights, type House } from '../data/houses'
import type { HouseKitId } from '../data/houseKits'
import Facade from './facade/Facade'
import KitFacade, { useKitCrownHeight } from './facade/KitFacade'
import { isDrag } from './interaction'

type SkyscraperProps = {
  /** The house as built on its island (see houseAtLevel). */
  house: House
  position: [number, number]
  onClick: (id: string) => void
  /** Preview only: show this many more (or fewer) storeys than the house has. */
  storeyDelta?: number
}

type HitboxHandlers = {
  onClick: (event: ThreeEvent<MouseEvent>) => void
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void
  onPointerOut: () => void
}

/**
 * The one mesh a house is hovered and clicked through. Pointer handlers live here rather than on the
 * house's group: with several child meshes under the cursor (facade and hitbox share their outer
 * faces), the front-most hit keeps switching while the mouse moves, and R3F then drops and re-adds
 * the hover on every other move, which made the highlight flicker.
 */
function Hitbox({ size, handlers }: { size: [number, number, number]; handlers: HitboxHandlers }) {
  const [w, h, d] = size
  return (
    <mesh position={[0, h / 2, 0]} {...handlers}>
      <boxGeometry args={[w, h, d]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  )
}

/** Kit houses carry a roof crown above their storeys; the hitbox covers it too. */
function KitHitbox({ kit, size, handlers }: { kit: HouseKitId; size: [number, number, number]; handlers: HitboxHandlers }) {
  const crown = useKitCrownHeight(kit)
  return <Hitbox size={[size[0], size[1] + crown, size[2]]} handlers={handlers} />
}

export default function Skyscraper({ house, position, onClick, storeyDelta = 0 }: SkyscraperProps) {
  const [hovered, setHovered] = useState(false)
  const [w, d] = house.footprint
  const storeyHeights = useMemo(() => previewHeights(house, storeyDelta), [house, storeyDelta])
  const height = storeyHeights.reduce((sum, h) => sum + h, 0)
  const [x, z] = position
  const size: [number, number, number] = [w, height, d]

  const handlers: HitboxHandlers = {
    onClick: (event) => {
      if (isDrag(event)) return
      event.stopPropagation()
      onClick(house.id)
    },
    onPointerOver: (event) => {
      event.stopPropagation()
      setHovered(true)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      setHovered(false)
      document.body.style.cursor = 'auto'
    },
  }

  return (
    <group position={[x, 0, z]}>
      <Suspense
        fallback={
          <>
            <mesh position={[0, height / 2, 0]}>
              <boxGeometry args={[w, height, d]} />
              <meshStandardMaterial color={house.facadeColor} roughness={0.5} metalness={0.15} />
            </mesh>
            <Hitbox size={size} handlers={handlers} />
          </>
        }
      >
        {house.kit ? (
          <>
            <KitFacade kit={house.kit} footprint={house.footprint} storeyHeights={storeyHeights} hovered={hovered} />
            <KitHitbox kit={house.kit} size={size} handlers={handlers} />
          </>
        ) : (
          <>
            <Facade
              house={house}
              shapeId={house.facade.shape}
              designId={house.facade.design}
              hovered={hovered}
              roofColor={house.facade.roofColor}
            />
            <Hitbox size={size} handlers={handlers} />
          </>
        )}
      </Suspense>
    </group>
  )
}
