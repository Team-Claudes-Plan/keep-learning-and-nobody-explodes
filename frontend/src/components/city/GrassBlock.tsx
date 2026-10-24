import { BLOCK_SIZE, SIDEWALK_HEIGHT, SIDEWALK_WIDTH } from '../../data/city'

const SIDEWALK_COLOR = '#5b6270'

export default function GrassBlock({
  center,
  color,
  size = BLOCK_SIZE,
}: {
  center: [number, number]
  color: string
  size?: number
}) {
  const [x, z] = center
  const baseSize = size + 2 * SIDEWALK_WIDTH
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, SIDEWALK_HEIGHT / 2, 0]} castShadow receiveShadow raycast={() => null}>
        <boxGeometry args={[baseSize, SIDEWALK_HEIGHT, baseSize]} />
        <meshStandardMaterial color={SIDEWALK_COLOR} roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, SIDEWALK_HEIGHT + 0.003, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
    </group>
  )
}
