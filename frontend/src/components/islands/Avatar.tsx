import { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { PresenceStatus } from '../../api/types'
import { SIDEWALK_HEIGHT } from '../../data/islandGrid'
import type { Vec2 } from '../../data/life'
import { buildPath, samplePath } from './motion'

const SKIN = '#e8c39e'
const WALK_SPEED = 0.45
/** Sleepers lie along the sidewalk: tipped onto their side, lifted so the torso rests on the ground and centered on their spot. */
const LYING_TILT = Math.PI / 2
const LYING_LIFT = 0.08
const LYING_SHIFT = 0.24
/** Where the head ends up once lying down; the zzz rises from here. */
const SLEEP_HEAD: [number, number, number] = [LYING_SHIFT - 0.44, LYING_LIFT + 0.1, 0]
/** A sleeper's name tag hangs over their feet, out of the way of the zzz. */
const SLEEP_TAG: [number, number, number] = [LYING_SHIFT, 0.36, 0]

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

/** A learning-group member on their island: walks the sidewalk while online, sleeps on it with a floating zzz while offline. */
export default function Avatar({ name, color, status, isSelf, loop, phase }: AvatarProps) {
  const ref = useRef<Group>(null)
  const body = useRef<Group>(null)
  const metrics = useMemo(() => buildPath(loop), [loop])
  const distance = useRef(phase * metrics.total)
  const elapsed = useRef(0)
  const online = status === 'online'

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    elapsed.current += delta
    if (online) {
      distance.current = (distance.current + WALK_SPEED * delta) % metrics.total
    }
    const { x, z, heading } = samplePath(metrics, distance.current)
    group.position.set(x, SIDEWALK_HEIGHT, z)
    group.rotation.y = heading
    const pose = body.current
    if (!pose) return
    if (online) {
      pose.position.set(0, Math.abs(Math.sin(elapsed.current * 8)) * 0.02, 0)
      pose.rotation.z = 0
      pose.scale.setScalar(1)
    } else {
      pose.position.set(LYING_SHIFT, LYING_LIFT, 0)
      pose.rotation.z = LYING_TILT
      // Slow breathing: the chest rises and falls a little.
      const breath = 1 + Math.sin(elapsed.current * 1.8) * 0.04
      pose.scale.set(1, 1, breath)
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
          <meshStandardMaterial color={color} roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0, 0.44, 0]} raycast={() => null}>
          <icosahedronGeometry args={[0.08, 0]} />
          <meshStandardMaterial color={SKIN} roughness={1} flatShading />
        </mesh>
      </group>

      {!online && (
        <Html position={SLEEP_HEAD} zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
          <div className="avatar-zzz" aria-hidden="true">
            <span>z</span>
            <span>z</span>
            <span>z</span>
          </div>
        </Html>
      )}

      <Html position={online ? [0, 0.72, 0] : SLEEP_TAG} center zIndexRange={[0, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`avatar-tag is-${status}`}>
          <span className="avatar-dot" />
          {isSelf ? `${name} (you)` : name}
        </div>
      </Html>
    </group>
  )
}
