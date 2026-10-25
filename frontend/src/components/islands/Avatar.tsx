import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { PresenceStatus } from '../../api/types'
import { SIDEWALK_HEIGHT } from '../../data/islandGrid'
import type { Vec2 } from '../../data/life'
import { buildPath, samplePath } from './motion'

const SKIN = '#e8c39e'
const OFFLINE_COLOR = '#9aa0a8'
const WALK_SPEED = 0.45

type AvatarProps = {
  name: string
  color: string
  status: PresenceStatus
  isSelf: boolean
  /** Sidewalk loop the avatar walks while online. */
  loop: Vec2[]
  /** Start along the loop, 0..1. */
  phase: number
}

/** A learning-group member standing on their island: walks around while online, stands still and greyed out while offline. */
export default function Avatar({ name, color, status, isSelf, loop, phase }: AvatarProps) {
  const ref = useRef<Group>(null)
  const body = useRef<Group>(null)
  const metrics = useMemo(() => buildPath(loop), [loop])
  const distance = useRef(phase * metrics.total)
  const elapsed = useRef(0)
  const online = status === 'online'
  const tint = online ? color : OFFLINE_COLOR

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    if (online) {
      elapsed.current += delta
      distance.current = (distance.current + WALK_SPEED * delta) % metrics.total
    }
    const { x, z, heading } = samplePath(metrics, distance.current)
    group.position.set(x, SIDEWALK_HEIGHT, z)
    group.rotation.y = heading
    if (body.current) {
      const stride = online ? Math.sin(elapsed.current * 8) : 0
      body.current.position.y = Math.abs(stride) * 0.02
      body.current.rotation.z = online ? 0 : -0.08
    }
  })

  return (
    <group ref={ref}>
      <group ref={body}>
        {[-0.045, 0.045].map((z) => (
          <mesh key={z} position={[0, 0.07, z]} raycast={() => null}>
            <boxGeometry args={[0.05, 0.14, 0.05]} />
            <meshStandardMaterial color="#3b3f47" roughness={1} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 0.25, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.07, 0.1, 0.24, 6]} />
          <meshStandardMaterial color={tint} roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 0.44, 0]} raycast={() => null}>
          <icosahedronGeometry args={[0.08, 0]} />
          <meshStandardMaterial color={online ? SKIN : OFFLINE_COLOR} roughness={1} flatShading />
        </mesh>
      </group>

      <Html position={[0, 0.72, 0]} center zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`avatar-tag is-${status}`}>
          <span className="avatar-dot" />
          {isSelf ? `${name} (you)` : name}
        </div>
      </Html>
    </group>
  )
}
