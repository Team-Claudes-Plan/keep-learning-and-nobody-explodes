import { useEffect, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { MeshStandardMaterial, type Material } from 'three'
import type { RoomItem } from '../data/houses'
import ItemBox from './ItemBox'
import { isDrag } from './interaction'
import { ALL_WALLS, type Walls } from './roomWalls'
import { createTiledMaterial, disposeMaterials, type SurfaceSpec } from './surfaces'

export type RoomProps = {
  size: [number, number, number]
  floorColor: string
  wallColor: string
  walls?: Walls
  items?: RoomItem[]
  selectedItemId?: string | null
  onSelectItem?: (id: string) => void
  interactiveItems?: boolean
  position?: [number, number, number]
  highlighted?: boolean
  onClick?: () => void
  wallSurface?: SurfaceSpec
  outerSurface?: SurfaceSpec
  innerSurface?: SurfaceSpec
  floorSurface?: SurfaceSpec
  ceilingSurface?: SurfaceSpec
  edgeColor?: string
}

const WALL_THICKNESS = 0.08

type SlabProps = {
  position: [number, number, number]
  size: [number, number, number]
  material: Material[]
}

// Box face material order is [+X, -X, +Y, -Y, +Z, -Z].
function Slab({ position, size, material }: SlabProps) {
  return (
    <mesh position={position} material={material}>
      <boxGeometry args={size} />
    </mesh>
  )
}

export default function Room({
  size,
  floorColor,
  wallColor,
  walls = ALL_WALLS,
  items = [],
  selectedItemId = null,
  onSelectItem,
  interactiveItems = true,
  position = [0, 0, 0],
  highlighted = false,
  onClick,
  wallSurface,
  outerSurface,
  innerSurface,
  floorSurface,
  ceilingSurface,
  edgeColor,
}: RoomProps) {
  const [hovered, setHovered] = useState(false)
  const [w, h, d] = size
  const t = WALL_THICKNESS
  const clickable = Boolean(onClick)
  const active = highlighted || (clickable && hovered)

  const textured = useMemo(() => {
    const part = (spec: SurfaceSpec | undefined, color: string, faceWidth: number, faceHeight: number) =>
      spec
        ? createTiledMaterial(spec, faceWidth, faceHeight)
        : new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.02, roughness: 0.8 })

    const outer = outerSurface ?? wallSurface
    const inner = innerSurface ?? wallSurface
    const ceiling = ceilingSurface ?? wallSurface

    return {
      backOuter: part(outer, wallColor, w, h),
      backInner: part(inner, wallColor, w, h),
      frontOuter: part(outer, wallColor, w, h),
      frontInner: part(inner, wallColor, w, h),
      leftOuter: part(outer, wallColor, d, h),
      leftInner: part(inner, wallColor, d, h),
      rightOuter: part(outer, wallColor, d, h),
      rightInner: part(inner, wallColor, d, h),
      floor: floorSurface
        ? createTiledMaterial(floorSurface, w, d)
        : new MeshStandardMaterial({ color: floorColor, emissive: floorColor, emissiveIntensity: 0.02, roughness: 0.9 }),
      ceiling: part(ceiling, wallColor, w, d),
    }
  }, [
    outerSurface,
    innerSurface,
    wallSurface,
    floorSurface,
    ceilingSurface,
    wallColor,
    floorColor,
    w,
    h,
    d,
  ])

  useEffect(() => () => disposeMaterials(Object.values(textured)), [textured])

  const edge = useMemo(
    () =>
      new MeshStandardMaterial({
        color: edgeColor ?? wallColor,
        emissive: edgeColor ?? wallColor,
        emissiveIntensity: active ? 0.16 : 0.02,
        roughness: 0.8,
        metalness: 0.1,
      }),
    [edgeColor, wallColor, active],
  )

  useEffect(() => () => edge.dispose(), [edge])

  const surfaces = useMemo(
    () => ({
      // [+X, -X, +Y, -Y, +Z, -Z]
      back: [edge, edge, edge, edge, textured.backInner, textured.backOuter],
      front: [edge, edge, edge, edge, textured.frontOuter, textured.frontInner],
      left: [textured.leftInner, textured.leftOuter, edge, edge, edge, edge],
      right: [textured.rightOuter, textured.rightInner, edge, edge, edge, edge],
      floor: [edge, edge, textured.floor, edge, edge, edge],
      ceiling: [edge, edge, edge, textured.ceiling, edge, edge],
    }),
    [textured, edge],
  )

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!onClick || isDrag(event)) return
    event.stopPropagation()
    onClick()
  }

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (!clickable) return
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    if (!clickable) return
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <group
      position={position}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <Slab position={[0, -t / 2, 0]} size={[w, t, d]} material={surfaces.floor} />

      {walls.back && <Slab position={[0, h / 2, -d / 2]} size={[w, h, t]} material={surfaces.back} />}

      {walls.front && <Slab position={[0, h / 2, d / 2]} size={[w, h, t]} material={surfaces.front} />}

      {walls.left && <Slab position={[-w / 2, h / 2, 0]} size={[t, h, d]} material={surfaces.left} />}

      {walls.right && <Slab position={[w / 2, h / 2, 0]} size={[t, h, d]} material={surfaces.right} />}

      {walls.ceiling && <Slab position={[0, h, 0]} size={[w, t, d]} material={surfaces.ceiling} />}

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
