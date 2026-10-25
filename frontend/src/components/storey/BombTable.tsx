import { Suspense, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'

/** Built in Blender by scripts/blender/workbench.py; its top is at this height. */
const TABLE_URL = '/models/furniture/workbench.glb'
const TABLE_HEIGHT = 0.42
/** The model is sized like room furniture; scaled up so the bomb looks right on it. */
const TABLE_SCALE = 2
export const TABLE_TOP = TABLE_HEIGHT * TABLE_SCALE
/** Half the table top's size along x and z (from the model), for the bomb's pieces to land on. */
export const TABLE_HALF_SIZE: [number, number] = [0.55 * TABLE_SCALE, 0.3 * TABLE_SCALE]
/** Where the bomb lies on the table, relative to the table's centre. */
export const BOMB_SPOT: [number, number, number] = [-0.12, TABLE_TOP, 0]

function Table() {
  const { scene } = useGLTF(TABLE_URL)
  const table = useMemo(() => scene.clone(true), [scene])
  return (
    <group scale={TABLE_SCALE}>
      <primitive object={table} />

      {/* defusal manual lying next to the bomb */}
      <group position={[0.36, TABLE_HEIGHT + 0.009, 0.08]} rotation={[0, -0.35, 0]} scale={0.7}>
        <mesh>
          <boxGeometry args={[0.16, 0.024, 0.21]} />
          <meshStandardMaterial color="#c0392b" roughness={0.7} flatShading />
        </mesh>
        <mesh position={[0.004, 0, 0]}>
          <boxGeometry args={[0.15, 0.018, 0.2]} />
          <meshStandardMaterial color="#f2ead8" roughness={0.9} />
        </mesh>
      </group>
    </group>
  )
}

/** Workbench the bomb lies on (the bomb itself is RoomBomb, so it can be picked up). */
export default function BombTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Suspense fallback={null}>
        <Table />
      </Suspense>
    </group>
  )
}

useGLTF.preload(TABLE_URL)
