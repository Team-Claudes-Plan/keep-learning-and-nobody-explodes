import { useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { isDrag } from './interaction'

export type ItemBoxProps = {
  position: [number, number, number]
  color: string
  size?: [number, number, number]
  selected?: boolean
  interactive?: boolean
  onClick?: () => void
}

export default function ItemBox({
  position,
  color,
  size = [0.5, 0.5, 0.5],
  selected = false,
  interactive = true,
  onClick,
}: ItemBoxProps) {
  const [hovered, setHovered] = useState(false)

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (!interactive || !onClick || isDrag(event)) return
    event.stopPropagation()
    onClick()
  }

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    if (!interactive) return
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }

  const handlePointerOut = () => {
    if (!interactive) return
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <mesh
      position={position}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={selected ? 0.6 : hovered ? 0.25 : 0.05}
        roughness={0.4}
        metalness={0.1}
      />
    </mesh>
  )
}
