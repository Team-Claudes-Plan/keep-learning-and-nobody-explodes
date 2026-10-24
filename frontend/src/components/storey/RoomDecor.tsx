import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { ROOM_WALL_Z } from '../cameras'

/** Built in Blender by scripts/blender/decor.py. */
const PLANT_URL = '/models/furniture/plant.glb'
const LAMP_URL = '/models/furniture/floor_lamp.glb'

/** Just in front of the back wall. */
const BACK_Z = ROOM_WALL_Z + 0.35

type ModelProps = { url: string; position: [number, number, number]; rotation?: number; scale?: number }

function Model({ url, position, rotation = 0, scale = 1 }: ModelProps) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => scene.clone(true), [scene])
  return <primitive object={model} position={position} rotation={[0, rotation, 0]} scale={scale} />
}

/** Quiet background props along the back wall. */
export default function RoomDecor() {
  return (
    <Suspense fallback={null}>
      <Model url={LAMP_URL} position={[-1.55, 0, BACK_Z]} scale={0.85} />
      {/* warm glow from the lampshade */}
      <pointLight position={[-1.55, 1.05, BACK_Z + 0.15]} color="#ffd9a0" intensity={0.8} distance={2.5} decay={1.5} />
      <Model url={PLANT_URL} position={[1.6, 0, BACK_Z]} rotation={0.4} scale={0.85} />
    </Suspense>
  )
}

useGLTF.preload(PLANT_URL)
useGLTF.preload(LAMP_URL)
