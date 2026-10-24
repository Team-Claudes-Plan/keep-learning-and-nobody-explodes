import { useMemo } from 'react'
import * as THREE from 'three'
import { ISLAND_RING, ISLAND_ROCKS, ISLAND_TERRACES } from '../../data/island'

const GRASS_COLORS = ['#4f8f5a', '#579a61', '#63a86a', '#4a8a54']
const ROCK_COLORS = ['#6b7078', '#7c818a', '#5d6169', '#8b919a', '#6f6a5e']

const colorFrom = (hex: string) => new THREE.Color(hex)

function buildIslandGeometry(): THREE.BufferGeometry {
  const ring = ISLAND_RING
  const count = ring.length

  const rings = ISLAND_TERRACES.map((terrace, ti) =>
    ring.map((point, pi) => {
      const jitter = 1 + 0.045 * Math.sin(pi * 2.3 + ti * 1.7)
      const r = Math.hypot(point[0], point[1]) * terrace.scale * jitter
      const theta = Math.atan2(point[1], point[0])
      return new THREE.Vector3(Math.cos(theta) * r, terrace.y, Math.sin(theta) * r)
    }),
  )

  const positions: number[] = []
  const colors: number[] = []

  const pushFace = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    color: THREE.Color,
  ) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    for (let i = 0; i < 3; i += 1) colors.push(color.r, color.g, color.b)
  }

  const top = rings[0]
  const center = new THREE.Vector3(0, 0, 0)
  for (let i = 0; i < count; i += 1) {
    pushFace(center, top[i], top[(i + 1) % count], colorFrom(GRASS_COLORS[i % GRASS_COLORS.length]))
  }

  for (let ti = 0; ti < rings.length - 1; ti += 1) {
    const upper = rings[ti]
    const lower = rings[ti + 1]
    for (let i = 0; i < count; i += 1) {
      const j = (i + 1) % count
      const color = colorFrom(ROCK_COLORS[(i + ti * 2) % ROCK_COLORS.length])
      pushFace(upper[i], lower[i], lower[j], color)
      pushFace(upper[i], lower[j], upper[j], color)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

export default function Island() {
  const islandGeometry = useMemo(() => buildIslandGeometry(), [])

  return (
    <group>
      <mesh geometry={islandGeometry} receiveShadow raycast={() => null}>
        <meshStandardMaterial vertexColors flatShading roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {ISLAND_ROCKS.map((rock, index) => (
        <mesh
          key={`rock-${index}`}
          position={rock.position}
          rotation={rock.rotation}
          scale={rock.scale}
          raycast={() => null}
        >
          <icosahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color={rock.color} flatShading roughness={1} />
        </mesh>
      ))}
    </group>
  )
}
