import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Mesh } from 'three'
import { BIRDS, PERCHED_BIRDS, type BirdSpec, type PerchedBird } from '../../data/life'

function BirdBody({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <group scale={scale}>
      <mesh position={[0, 0, 0]} raycast={() => null}>
        <sphereGeometry args={[0.07, 8, 6]} />
        <meshStandardMaterial color={color} roughness={1} flatShading />
      </mesh>
      <mesh position={[0.1, 0.03, 0]} raycast={() => null}>
        <sphereGeometry args={[0.045, 8, 6]} />
        <meshStandardMaterial color={color} roughness={1} flatShading />
      </mesh>
      <mesh position={[0.17, 0.02, 0]} rotation-z={-Math.PI / 2} raycast={() => null}>
        <coneGeometry args={[0.02, 0.06, 4]} />
        <meshStandardMaterial color="#c9a25a" roughness={1} flatShading />
      </mesh>
      <mesh position={[-0.09, 0.01, 0]} rotation-z={Math.PI / 2.4} raycast={() => null}>
        <boxGeometry args={[0.08, 0.015, 0.04]} />
        <meshStandardMaterial color={color} roughness={1} flatShading />
      </mesh>
    </group>
  )
}

function FlyingBird({ bird }: { bird: BirdSpec }) {
  const ref = useRef<Group>(null)
  const leftWing = useRef<Mesh>(null)
  const rightWing = useRef<Mesh>(null)
  const angle = useRef(bird.phase)

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    angle.current += bird.speed * delta
    const a = angle.current

    const x = bird.center[0] + Math.cos(a) * bird.radiusX
    const z = bird.center[1] + Math.sin(a) * bird.radiusZ
    const y = bird.height + Math.sin(a * 3) * bird.bob
    const tx = -Math.sin(a) * bird.radiusX
    const tz = Math.cos(a) * bird.radiusZ

    group.position.set(x, y, z)
    group.rotation.y = Math.atan2(-tz, tx)

    const flap = Math.sin(angle.current * 9) * 0.5
    if (leftWing.current) leftWing.current.rotation.x = flap
    if (rightWing.current) rightWing.current.rotation.x = -flap
  })

  return (
    <group ref={ref} scale={bird.scale}>
      <BirdBody color={bird.color} />
      <mesh ref={leftWing} position={[0, 0.01, 0.02]} raycast={() => null}>
        <boxGeometry args={[0.09, 0.012, 0.18]} />
        <meshStandardMaterial color={bird.color} roughness={1} flatShading />
      </mesh>
      <mesh ref={rightWing} position={[0, 0.01, -0.02]} raycast={() => null}>
        <boxGeometry args={[0.09, 0.012, 0.18]} />
        <meshStandardMaterial color={bird.color} roughness={1} flatShading />
      </mesh>
    </group>
  )
}

function Perched({ bird }: { bird: PerchedBird }) {
  return (
    <group position={bird.position} rotation-y={bird.rotation}>
      <BirdBody color={bird.color} scale={bird.scale} />
    </group>
  )
}

export default function Birds() {
  return (
    <group>
      {BIRDS.map((bird) => (
        <FlyingBird key={bird.id} bird={bird} />
      ))}
      {PERCHED_BIRDS.map((bird) => (
        <Perched key={bird.id} bird={bird} />
      ))}
    </group>
  )
}
