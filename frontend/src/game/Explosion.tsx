import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// The blast when the bomb goes off: a white flash, a short fireball and sparks flying out, lit by a
// bright burst of light. Mount it to set it off; the bomb itself is torn apart in debris.ts.

const FIREBALLS = 7
const SPARKS = 90
const GRAVITY = -9

/** Same random layout for a given index, so re-renders do not reshuffle the explosion. */
function seeded(i: number, salt: number) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function randomDirection(i: number, salt: number) {
  const u = seeded(i, salt) * 2 - 1
  const phi = seeded(i, salt + 1) * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  return new THREE.Vector3(r * Math.cos(phi), u, r * Math.sin(phi))
}

function additive(color: string) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

export default function Explosion({ center }: { center: [number, number, number] }) {
  const start = useRef<number | null>(null)
  const flash = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const fireballs = useRef<(THREE.Mesh | null)[]>([])
  const sparks = useRef<THREE.InstancedMesh>(null)

  const sphere = useMemo(() => new THREE.SphereGeometry(1, 24, 16), [])
  const flashMaterial = useMemo(() => additive('#fff6e0'), [])
  const fireMaterials = useMemo(() => Array.from({ length: FIREBALLS }, () => additive('#ffb347')), [])
  const fireOffsets = useMemo(() => Array.from({ length: FIREBALLS }, (_, i) => randomDirection(i, 1).multiplyScalar(0.55)), [])
  const sparkVelocities = useMemo(
    () => Array.from({ length: SPARKS }, (_, i) => randomDirection(i, 5).multiplyScalar(4 + seeded(i, 9) * 6)),
    [],
  )
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const fireColor = useMemo(() => new THREE.Color(), [])

  useFrame(({ clock }) => {
    start.current ??= clock.elapsedTime
    const t = clock.elapsedTime - start.current

    // white flash: blows up within a few frames, gone after a third of a second
    if (flash.current) {
      flash.current.scale.setScalar(0.3 + 2.8 * (1 - Math.exp(-t * 25)))
      flashMaterial.opacity = Math.max(0, 1 - t / 0.35)
      flash.current.visible = flashMaterial.opacity > 0
    }

    // light burst lighting up the bomb and the room
    if (light.current) light.current.intensity = 120 * Math.exp(-t * 3.5)

    // fireball: puffs grow fast, cool from yellow to deep red and fade
    fireballs.current.forEach((mesh, i) => {
      if (!mesh) return
      const local = Math.max(0, t - i * 0.03)
      const size = (1.3 + seeded(i, 3) * 1.1) * (1 - Math.exp(-local * 10))
      mesh.scale.setScalar(Math.max(0.001, size))
      mesh.position.copy(fireOffsets[i]).multiplyScalar(1 + local * 1.5)
      mesh.position.y += local * 0.6
      const material = fireMaterials[i]
      fireColor.set('#fff1a8').lerp(new THREE.Color('#ff6a1a'), Math.min(1, local * 3)).lerp(new THREE.Color('#7a1405'), Math.max(0, Math.min(1, local * 1.5 - 0.5)))
      material.color.copy(fireColor)
      material.opacity = Math.max(0, 1 - local / 0.7)
      mesh.visible = material.opacity > 0
    })

    // sparks: fly out on ballistic paths and burn out
    const s = sparks.current
    if (s) {
      for (let i = 0; i < SPARKS; i++) {
        const life = 0.8 + seeded(i, 7) * 0.9
        const v = sparkVelocities[i]
        dummy.position.set(v.x * t, v.y * t + 0.5 * GRAVITY * t * t, v.z * t)
        dummy.scale.setScalar(t < life ? 0.035 * (1 - t / life) + 0.001 : 0.0001)
        dummy.updateMatrix()
        s.setMatrixAt(i, dummy.matrix)
      }
      s.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group position={center}>
      <pointLight ref={light} color="#ff9a3c" distance={25} decay={1.5} intensity={0} />
      <mesh ref={flash} geometry={sphere} material={flashMaterial} raycast={() => null} />
      {fireMaterials.map((material, i) => (
        <mesh
          key={i}
          ref={(m) => void (fireballs.current[i] = m)}
          geometry={sphere}
          material={material}
          scale={0.001}
          raycast={() => null}
        />
      ))}
      <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS]} raycast={() => null}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffd27a" toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
