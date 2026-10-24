import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import type { MeshStandardMaterial } from 'three'
import type { RoomItem } from '../data/houses'
import ItemBox from './ItemBox'
import { createTiledMaterial, disposeMaterials, type SurfaceSpec } from './surfaces'
import { ROOM_MIN_ZOOM, ROOM_WALL_Z } from './cameras'

const WALL_THICKNESS = 0.08
const FLOOR_THICKNESS = 0.08

export type RoomStageProps = {
  wallColor: string
  floorColor: string
  wallSurface?: SurfaceSpec
  floorSurface?: SurfaceSpec
  items?: RoomItem[]
  selectedItemId?: string | null
  onSelectItem?: (id: string) => void
  interactiveItems?: boolean
}

type SlabProps = {
  material: MeshStandardMaterial | null
  position: [number, number, number]
  size: [number, number, number]
  color: string
  roughness?: number
}

function Slab({ material, position, size, color, roughness = 0.85 }: SlabProps) {
  return (
    <mesh position={position} material={material ?? undefined} raycast={() => null}>
      <boxGeometry args={size} />
      {!material && (
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.06}
          roughness={roughness}
        />
      )}
    </mesh>
  )
}

export default function RoomStage({
  wallColor,
  floorColor,
  wallSurface,
  floorSurface,
  items = [],
  selectedItemId = null,
  onSelectItem,
  interactiveItems = true,
}: RoomStageProps) {
  const size = useThree((state) => state.size)

  const dims = useMemo(() => {
    const visibleW = size.width / ROOM_MIN_ZOOM
    const visibleH = size.height / ROOM_MIN_ZOOM
    const wallW = visibleW * 1.6 + 4
    const wallH = visibleH * 2.4 + 4
    const floorD = visibleH * 8 + 16
    return { wallW, wallH, floorW: wallW, floorD }
  }, [size.width, size.height])

  const surfaces = useMemo(
    () => ({
      wall: wallSurface ? createTiledMaterial(wallSurface, dims.wallW, dims.wallH) : null,
      floor: floorSurface ? createTiledMaterial(floorSurface, dims.floorW, dims.floorD) : null,
    }),
    [wallSurface, floorSurface, dims],
  )

  useEffect(() => () => disposeMaterials([surfaces.wall, surfaces.floor]), [surfaces])

  const floorCenterZ = ROOM_WALL_Z + dims.floorD / 2

  return (
    <group>
      <Slab
        material={surfaces.wall}
        position={[0, dims.wallH / 2, ROOM_WALL_Z]}
        size={[dims.wallW, dims.wallH, WALL_THICKNESS]}
        color={wallColor}
      />

      <Slab
        material={surfaces.floor}
        position={[0, -FLOOR_THICKNESS / 2, floorCenterZ]}
        size={[dims.floorW, FLOOR_THICKNESS, dims.floorD]}
        color={floorColor}
        roughness={0.95}
      />

      {items.map((item) => (
        <ItemBox
          key={item.id}
          position={item.position}
          color={item.color}
          selected={item.id === selectedItemId}
          interactive={interactiveItems && Boolean(onSelectItem)}
          onClick={onSelectItem ? () => onSelectItem(item.id) : undefined}
        />
      ))}
    </group>
  )
}
