import { useState } from 'react'
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { House } from '../data/houses'
import { houseHeight } from '../data/houses'

type SkyscraperProps = {
  house: House
  onClick: (id: string) => void
}

export default function Skyscraper({ house, onClick }: SkyscraperProps) {
  const [hovered, setHovered] = useState(false)
  const [w, d] = house.footprint
  const height = houseHeight(house)
  const [x, z] = house.position

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
    <mesh
      position={[x, height / 2, z]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <boxGeometry args={[w, height, d]} />
      <meshStandardMaterial
        color={house.facadeColor}
        emissive={house.facadeColor}
        emissiveIntensity={hovered ? 0.35 : 0.05}
        roughness={0.5}
        metalness={0.15}
      />
      <Edges color="#e8ecf3" threshold={15} />
    </mesh>
  )
}
