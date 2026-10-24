import type { RoofShape } from '../../data/facadeTypes'

type RoofProps = {
  kind: RoofShape
  width: number
  depth: number
  y: number
  color: string
  glow: number
}

export default function Roof({ kind, width, depth, y, color, glow }: RoofProps) {
  const cap = (
    <mesh position={[0, y + 0.06, 0]}>
      <boxGeometry args={[width * 0.98, 0.12, depth * 0.98]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={glow * 0.3}
        roughness={0.5}
        metalness={0.4}
      />
    </mesh>
  )

  if (kind === 'flat') return cap

  if (kind === 'antenna') {
    return (
      <group>
        {cap}
        <mesh position={[0, y + 0.7, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 1.2, 8]} />
          <meshStandardMaterial color="#c9d4e6" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, y + 1.35, 0]}>
          <sphereGeometry args={[0.09, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1 + glow} />
        </mesh>
        <mesh position={[0, y + 0.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.22, 0.03, 8, 20]} />
          <meshStandardMaterial color="#ff8f4f" emissive="#ff8f4f" emissiveIntensity={0.5 + glow} />
        </mesh>
      </group>
    )
  }

  if (kind === 'dome') {
    return (
      <mesh position={[0, y, 0]}>
        <sphereGeometry args={[Math.min(width, depth) * 0.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={glow * 0.4}
          roughness={0.4}
          metalness={0.3}
        />
      </mesh>
    )
  }

  if (kind === 'canopy') {
    return (
      <group>
        {cap}
        <mesh position={[0, y + 0.3, 0]}>
          <boxGeometry args={[width * 1.15, 0.1, depth * 1.15]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow * 0.3} metalness={0.5} />
        </mesh>
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}-${sz}`} position={[sx * width * 0.5, y + 0.16, sz * depth * 0.5]}>
              <cylinderGeometry args={[0.03, 0.03, 0.32, 6]} />
              <meshStandardMaterial color="#6ea8fe" emissive="#6ea8fe" emissiveIntensity={glow * 0.5} />
            </mesh>
          )),
        )}
      </group>
    )
  }

  const foliage = [
    { p: [0, y + 0.5, 0] as const, r: Math.max(width, depth) * 0.5 },
    { p: [width * 0.28, y + 0.3, depth * 0.2] as const, r: Math.max(width, depth) * 0.32 },
    { p: [-width * 0.26, y + 0.36, -depth * 0.18] as const, r: Math.max(width, depth) * 0.3 },
  ]
  return (
    <group>
      <mesh position={[0, y + 0.25, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.6, 8]} />
        <meshStandardMaterial color="#5a4a38" roughness={0.9} />
      </mesh>
      {foliage.map((leaf, index) => (
        <mesh key={index} position={[leaf.p[0], leaf.p[1], leaf.p[2]]}>
          <icosahedronGeometry args={[leaf.r, 0]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={glow * 0.5}
            roughness={0.85}
            flatShading
          />
        </mesh>
      ))}
    </group>
  )
}
