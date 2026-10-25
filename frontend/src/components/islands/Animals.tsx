import { useMemo, useRef, type Ref } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { SIDEWALK_HEIGHT, buildFieldProps, type GridBlock } from '../../data/islandGrid'
import { buildAnimals, buildSquirrel, type AnimalSpec, type SquirrelSpec } from '../../data/life'
import { buildPath, samplePath } from './motion'

function Leg({ x, z, width, height }: { x: number; z: number; width: number; height: number }) {
  return (
    <mesh position={[x, height / 2, z]} raycast={() => null}>
      <boxGeometry args={[width, height, width]} />
      <meshStandardMaterial color="#4a4238" roughness={1} flatShading />
    </mesh>
  )
}

function Dog({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.2, 0]} raycast={() => null}>
        <boxGeometry args={[0.34, 0.14, 0.14]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.22, 0.25, 0]} raycast={() => null}>
        <boxGeometry args={[0.14, 0.13, 0.13]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.32, 0.22, 0]} raycast={() => null}>
        <boxGeometry args={[0.08, 0.07, 0.09]} />
        <meshStandardMaterial color="#3c352c" roughness={1} flatShading />
      </mesh>
      {[-0.06, 0.06].map((z) => (
        <mesh key={z} position={[0.2, 0.33, z]} raycast={() => null}>
          <coneGeometry args={[0.04, 0.07, 4]} />
          <meshStandardMaterial color="#3c352c" roughness={1} flatShading />
        </mesh>
      ))}
      <mesh position={[-0.2, 0.28, 0]} rotation-z={0.6} raycast={() => null}>
        <boxGeometry args={[0.12, 0.04, 0.04]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <Leg x={0.12} z={-0.05} width={0.045} height={0.16} />
      <Leg x={0.12} z={0.05} width={0.045} height={0.16} />
      <Leg x={-0.12} z={-0.05} width={0.045} height={0.16} />
      <Leg x={-0.12} z={0.05} width={0.045} height={0.16} />
    </group>
  )
}

function Cat({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.16, 0]} raycast={() => null}>
        <boxGeometry args={[0.26, 0.11, 0.11]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.17, 0.2, 0]} raycast={() => null}>
        <boxGeometry args={[0.12, 0.12, 0.11]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.25, 0.18, 0]} raycast={() => null}>
        <boxGeometry args={[0.06, 0.05, 0.07]} />
        <meshStandardMaterial color="#37312a" roughness={1} flatShading />
      </mesh>
      {[-0.05, 0.05].map((z) => (
        <mesh key={z} position={[0.16, 0.27, z]} raycast={() => null}>
          <coneGeometry args={[0.035, 0.06, 4]} />
          <meshStandardMaterial color="#37312a" roughness={1} flatShading />
        </mesh>
      ))}
      <mesh position={[-0.16, 0.24, 0]} rotation-z={0.9} raycast={() => null}>
        <boxGeometry args={[0.16, 0.03, 0.03]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <Leg x={0.09} z={-0.04} width={0.035} height={0.1} />
      <Leg x={0.09} z={0.04} width={0.035} height={0.1} />
      <Leg x={-0.09} z={-0.04} width={0.035} height={0.1} />
      <Leg x={-0.09} z={0.04} width={0.035} height={0.1} />
    </group>
  )
}

function SquirrelBody({ color, tail }: { color: string; tail: Ref<Group> }) {
  return (
    <group>
      <mesh position={[0, 0.11, 0]} rotation-z={0.35} raycast={() => null}>
        <boxGeometry args={[0.16, 0.1, 0.09]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.02, 0.1, 0]} rotation-z={0.35} raycast={() => null}>
        <boxGeometry args={[0.12, 0.08, 0.095]} />
        <meshStandardMaterial color="#e8cfa6" roughness={1} flatShading />
      </mesh>
      <mesh position={[0.1, 0.19, 0]} raycast={() => null}>
        <boxGeometry args={[0.09, 0.08, 0.08]} />
        <meshStandardMaterial color={color} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0.15, 0.18, 0]} raycast={() => null}>
        <boxGeometry args={[0.03, 0.03, 0.04]} />
        <meshStandardMaterial color="#2f2620" roughness={1} flatShading />
      </mesh>
      {[-0.025, 0.025].map((z) => (
        <mesh key={z} position={[0.08, 0.25, z]} raycast={() => null}>
          <coneGeometry args={[0.018, 0.045, 4]} />
          <meshStandardMaterial color={color} roughness={1} flatShading />
        </mesh>
      ))}
      <group ref={tail} position={[-0.08, 0.08, 0]}>
        <mesh position={[-0.05, 0.08, 0]} rotation-z={-0.35} raycast={() => null}>
          <boxGeometry args={[0.08, 0.18, 0.08]} />
          <meshStandardMaterial color={color} roughness={0.9} flatShading />
        </mesh>
        <mesh position={[-0.01, 0.2, 0]} rotation-z={0.6} raycast={() => null}>
          <boxGeometry args={[0.1, 0.08, 0.08]} />
          <meshStandardMaterial color={color} roughness={0.9} flatShading />
        </mesh>
      </group>
      <Leg x={0.05} z={-0.03} width={0.025} height={0.06} />
      <Leg x={0.05} z={0.03} width={0.025} height={0.06} />
      <Leg x={-0.05} z={-0.035} width={0.03} height={0.07} />
      <Leg x={-0.05} z={0.035} width={0.03} height={0.07} />
    </group>
  )
}

const SQUIRREL_RUN = 2.2
const SQUIRREL_REST = 1.6

/** Scampers around a tree in short hopping bursts, then sits and flicks its tail. */
function Squirrel({ squirrel }: { squirrel: SquirrelSpec }) {
  const ref = useRef<Group>(null)
  const inner = useRef<Group>(null)
  const tail = useRef<Group>(null)
  const angle = useRef(0)
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    elapsed.current += delta
    const cycle = elapsed.current % (SQUIRREL_RUN + SQUIRREL_REST)
    const running = cycle < SQUIRREL_RUN
    if (running) angle.current += (1.6 / squirrel.radius) * 0.35 * delta

    const a = angle.current
    const [cx, cz] = squirrel.center
    group.position.set(cx + Math.cos(a) * squirrel.radius, SIDEWALK_HEIGHT, cz + Math.sin(a) * squirrel.radius)
    group.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a))

    const innerGroup = inner.current
    if (innerGroup) innerGroup.position.y = running ? Math.abs(Math.sin(elapsed.current * 14)) * 0.05 : 0
    const tailGroup = tail.current
    if (tailGroup) tailGroup.rotation.z = running ? 0.15 : Math.sin(elapsed.current * 18) * 0.12
  })

  return (
    <group ref={ref} scale={squirrel.scale}>
      <group ref={inner}>
        <SquirrelBody color={squirrel.color} tail={tail} />
      </group>
    </group>
  )
}

function Walker({ animal }: { animal: AnimalSpec }) {
  const ref = useRef<Group>(null)
  const inner = useRef<Group>(null)
  const metrics = useMemo(() => buildPath(animal.points), [animal])
  const distance = useRef(animal.phase * metrics.total)
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    elapsed.current += delta
    distance.current = (distance.current + animal.speed * delta) % metrics.total
    const { x, z, heading } = samplePath(metrics, distance.current)
    group.position.set(x, SIDEWALK_HEIGHT, z)
    group.rotation.y = heading

    const innerGroup = inner.current
    if (innerGroup) {
      const stride = Math.sin(elapsed.current * 7)
      innerGroup.position.y = Math.abs(stride) * 0.018
      innerGroup.rotation.z = stride * 0.04
    }
  })

  return (
    <group ref={ref} scale={animal.scale}>
      <group ref={inner}>
        {animal.kind === 'dog' ? <Dog color={animal.color} /> : <Cat color={animal.color} />}
      </group>
    </group>
  )
}

export default function Animals({ fieldBlocks }: { fieldBlocks: GridBlock[] }) {
  const animals = useMemo(() => buildAnimals(fieldBlocks), [fieldBlocks])
  const squirrel = useMemo(
    () => buildSquirrel(fieldBlocks, buildFieldProps(fieldBlocks).filter((prop) => prop.kind === 'tree')),
    [fieldBlocks],
  )
  return (
    <group>
      {squirrel && <Squirrel squirrel={squirrel} />}
      {animals.map((animal) => (
        <Walker key={animal.id} animal={animal} />
      ))}
    </group>
  )
}
