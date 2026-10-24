import { useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { RoomItem } from '../data/houses'
import ItemBox from './ItemBox'
import { isDrag } from './interaction'
import { ALL_WALLS, type Walls } from './roomWalls'

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
}

const WALL_THICKNESS = 0.08

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
}: RoomProps) {
  const [hovered, setHovered] = useState(false)
  const [w, h, d] = size
  const t = WALL_THICKNESS
  const clickable = Boolean(onClick)
  const active = highlighted || (clickable && hovered)

  const shellIntensity = active ? 0.35 : 0.02

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
      <mesh position={[0, -t / 2, 0]}>
        <boxGeometry args={[w, t, d]} />
        <meshStandardMaterial
          color={floorColor}
          emissive={floorColor}
          emissiveIntensity={shellIntensity}
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {walls.back && (
        <mesh position={[0, h / 2, -d / 2]}>
          <boxGeometry args={[w, h, t]} />
          <meshStandardMaterial
            color={wallColor}
            emissive={wallColor}
            emissiveIntensity={shellIntensity}
            roughness={0.8}
          />
        </mesh>
      )}

      {walls.front && (
        <mesh position={[0, h / 2, d / 2]}>
          <boxGeometry args={[w, h, t]} />
          <meshStandardMaterial
            color={wallColor}
            emissive={wallColor}
            emissiveIntensity={shellIntensity}
            roughness={0.8}
          />
        </mesh>
      )}

      {walls.left && (
        <mesh position={[-w / 2, h / 2, 0]}>
          <boxGeometry args={[t, h, d]} />
          <meshStandardMaterial
            color={wallColor}
            emissive={wallColor}
            emissiveIntensity={shellIntensity}
            roughness={0.8}
          />
        </mesh>
      )}

      {walls.right && (
        <mesh position={[w / 2, h / 2, 0]}>
          <boxGeometry args={[t, h, d]} />
          <meshStandardMaterial
            color={wallColor}
            emissive={wallColor}
            emissiveIntensity={shellIntensity}
            roughness={0.8}
          />
        </mesh>
      )}

      {walls.ceiling && (
        <mesh position={[0, h, 0]}>
          <boxGeometry args={[w, t, d]} />
          <meshStandardMaterial
            color={wallColor}
            emissive={wallColor}
            emissiveIntensity={shellIntensity}
            roughness={0.8}
          />
        </mesh>
      )}

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
