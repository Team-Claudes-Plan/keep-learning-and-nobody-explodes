import { DoubleSide } from 'three'
import type { FacadeDetailKind } from '../../data/facadeTypes'

type DetailPropProps = {
  kind: FacadeDetailKind
  color: string
  scale?: number
  glow: number
}

export default function DetailProp({ kind, color, scale = 1, glow }: DetailPropProps) {
  const material = (
    <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4 + glow * 0.8} roughness={0.4} metalness={0.3} />
  )

  if (kind === 'robotArm') {
    return (
      <group scale={scale}>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.36, 8]} />
          {material}
        </mesh>
        <mesh position={[0.12, 0.38, 0]} rotation={[0, 0, -0.7]}>
          <boxGeometry args={[0.28, 0.06, 0.06]} />
          {material}
        </mesh>
        <mesh position={[0.26, 0.46, 0]}>
          <sphereGeometry args={[0.05, 10, 10]} />
          {material}
        </mesh>
      </group>
    )
  }

  if (kind === 'solarFin') {
    return (
      <group scale={scale}>
        {[0, 1, 2].map((index) => (
          <mesh key={index} position={[0.06 + index * 0.02, index * 0.14, 0]} rotation={[0, 0, -0.35]}>
            <boxGeometry args={[0.42, 0.04, 0.3]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3 + glow * 0.6} metalness={0.7} roughness={0.25} />
          </mesh>
        ))}
      </group>
    )
  }

  if (kind === 'coil') {
    return (
      <group scale={scale}>
        {[0, 1, 2, 3].map((index) => (
          <mesh key={index} position={[0, index * 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.11, 0.022, 8, 16]} />
            {material}
          </mesh>
        ))}
      </group>
    )
  }

  if (kind === 'dish') {
    return (
      <group scale={scale}>
        <mesh position={[0, 0.12, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.24, 8]} />
          {material}
        </mesh>
        <mesh position={[0, 0.26, 0]} rotation={[0.6, 0, 0]}>
          <sphereGeometry args={[0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#c9d4e6" side={DoubleSide} metalness={0.6} roughness={0.3} />
        </mesh>
      </group>
    )
  }

  if (kind === 'planter') {
    return (
      <group scale={scale}>
        <mesh>
          <boxGeometry args={[0.24, 0.14, 0.24]} />
          <meshStandardMaterial color="#5a4a38" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.16, 0]}>
          <icosahedronGeometry args={[0.14, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2 + glow * 0.5} flatShading />
        </mesh>
      </group>
    )
  }

  return (
    <group scale={scale}>
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index} position={[Math.sin(index) * 0.06, index * 0.16, Math.cos(index) * 0.04]}>
          <icosahedronGeometry args={[0.07, 0]} />
          {material}
        </mesh>
      ))}
    </group>
  )
}
