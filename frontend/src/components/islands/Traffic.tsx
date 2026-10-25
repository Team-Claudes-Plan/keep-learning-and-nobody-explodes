import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import {
  CAR_ROUTES,
  PARKED_CARS,
  ROAD_SURFACE_Y,
  type CarRoute,
  type ParkedCar,
} from '../../data/life'
import { buildPath, samplePath } from './motion'

const WHEEL_COLOR = '#2b2e33'
const GLASS_COLOR = '#9fc4d8'

function CarBody({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.11, 0]} raycast={() => null}>
        <boxGeometry args={[0.62, 0.16, 0.3]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.15} flatShading />
      </mesh>
      <mesh position={[0.03, 0.23, 0]} raycast={() => null}>
        <boxGeometry args={[0.3, 0.12, 0.26]} />
        <meshStandardMaterial color={GLASS_COLOR} roughness={0.35} metalness={0.1} flatShading />
      </mesh>
      {[-0.2, 0.2].map((x) =>
        [-0.16, 0.16].map((z) => (
          <mesh
            key={`${x}-${z}`}
            position={[x, 0.07, z]}
            rotation-x={Math.PI / 2}
            raycast={() => null}
          >
            <cylinderGeometry args={[0.07, 0.07, 0.05, 8]} />
            <meshStandardMaterial color={WHEEL_COLOR} roughness={1} flatShading />
          </mesh>
        )),
      )}
    </group>
  )
}

function DrivingCar({ route }: { route: CarRoute }) {
  const ref = useRef<Group>(null)
  const metrics = useMemo(() => buildPath(route.points), [route])
  const distance = useRef(route.phase * metrics.total)

  useFrame((_, delta) => {
    const group = ref.current
    if (!group) return
    distance.current = (distance.current + route.speed * delta) % metrics.total
    const { x, z, heading } = samplePath(metrics, distance.current)
    group.position.set(x, ROAD_SURFACE_Y, z)
    group.rotation.y = heading
  })

  return (
    <group ref={ref}>
      <CarBody color={route.color} />
    </group>
  )
}

function Parked({ car }: { car: ParkedCar }) {
  return (
    <group position={car.position} rotation-y={car.rotation}>
      <CarBody color={car.color} />
    </group>
  )
}

export default function Traffic() {
  return (
    <group>
      {CAR_ROUTES.map((route) => (
        <DrivingCar key={route.id} route={route} />
      ))}
      {PARKED_CARS.map((car) => (
        <Parked key={car.id} car={car} />
      ))}
    </group>
  )
}
