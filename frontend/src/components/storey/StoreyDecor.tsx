import type { DecorKind } from '../../data/houseParts'

type StoreyDecorProps = {
  kind: DecorKind
  color: string
  glow: number
}

export default function StoreyDecor({ kind, color, glow }: StoreyDecorProps) {
  if (kind === 'flowerPot') {
    return (
      <group>
        <mesh position={[0, -0.07, 0]}>
          <boxGeometry args={[0.22, 0.14, 0.18]} />
          <meshStandardMaterial color="#5a4a38" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <icosahedronGeometry args={[0.14, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2 + glow * 0.5} flatShading roughness={0.8} />
        </mesh>
        <mesh position={[0.07, 0.12, 0.03]}>
          <sphereGeometry args={[0.05, 10, 10]} />
          <meshStandardMaterial color="#ffe6a3" emissive="#ffe6a3" emissiveIntensity={0.3 + glow * 0.4} />
        </mesh>
      </group>
    )
  }

  if (kind === 'lamp') {
    return (
      <group>
        <mesh position={[0, -0.09, 0]}>
          <cylinderGeometry args={[0.03, 0.04, 0.12, 8]} />
          <meshStandardMaterial color="#c9d4e6" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.03, 0]}>
          <sphereGeometry args={[0.1, 14, 14]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7 + glow} roughness={0.4} />
        </mesh>
      </group>
    )
  }

  if (kind === 'bench') {
    return (
      <group>
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.42, 0.06, 0.18]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.1 + glow * 0.3} roughness={0.7} />
        </mesh>
        {[-0.16, 0.16].map((x) => (
          <mesh key={x} position={[x, -0.08, 0]}>
            <boxGeometry args={[0.05, 0.14, 0.16]} />
            <meshStandardMaterial color="#4a4a52" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
      </group>
    )
  }

  return (
    <group>
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index} position={[Math.sin(index) * 0.06, -0.05 + index * 0.09, Math.cos(index) * 0.04]}>
          <icosahedronGeometry args={[0.07, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.15 + glow * 0.4} flatShading roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}
