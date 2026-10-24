import { useMemo } from 'react'
import * as THREE from 'three'
import {
  ISLAND_TERRACES,
  LAKE_CENTER,
  LAKE_LEVEL,
  LAKE_RIM_SEGMENTS,
  RIVER_EXIT_THETA,
  RIVER_LEVEL,
  RIVER_PATH,
  WATERFALL_BOTTOM,
  grassColorAt,
  lakeRadiusAt,
  shorePoint,
} from '../../data/island'

const TAU = Math.PI * 2

const FALL_TOP = new THREE.Color('#6fb6e0')
const FALL_BOTTOM = new THREE.Color('#3a83ba')
const FOAM = new THREE.Color('#d3ecfa')
const LAKE_DEEP = new THREE.Color('#2f7fc0')
const LAKE_EDGE = new THREE.Color('#57b6e4')
const SHORE = new THREE.Color('#c6b184')

const OUTSET = 0.26
const SHORE_WIDTH = 0.34
const CHANNEL_STATIONS = 64

function buildLakeGeometry(): THREE.BufferGeometry {
  const [cx, cz] = LAKE_CENTER
  const segments = LAKE_RIM_SEGMENTS

  type RingKind = 'water' | 'wet' | 'sand' | 'blend' | 'grass'
  type Ring = { factor: number; extra: number; y: number; kind: RingKind; depth: number }

  const rings: Ring[] = [
    { factor: 0, extra: 0, y: LAKE_LEVEL, kind: 'water', depth: 0 },
    { factor: 0.55, extra: 0, y: LAKE_LEVEL, kind: 'water', depth: 0.4 },
    { factor: 0.85, extra: 0, y: LAKE_LEVEL, kind: 'water', depth: 0.75 },
    { factor: 1, extra: 0, y: LAKE_LEVEL, kind: 'water', depth: 1 },
    { factor: 1, extra: SHORE_WIDTH * 0.3, y: LAKE_LEVEL - 0.016, kind: 'wet', depth: 1 },
    { factor: 1, extra: SHORE_WIDTH * 0.9, y: 0.014, kind: 'sand', depth: 1 },
    { factor: 1, extra: SHORE_WIDTH * 1.45, y: 0.005, kind: 'blend', depth: 1 },
    { factor: 1, extra: SHORE_WIDTH * 1.9, y: 0.001, kind: 'grass', depth: 1 },
  ]

  const wetSand = new THREE.Color('#a8946b')
  const sand = SHORE.clone()

  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  positions.push(cx, LAKE_LEVEL, cz)
  colors.push(LAKE_DEEP.r, LAKE_DEEP.g, LAKE_DEEP.b)

  for (let r = 1; r < rings.length; r += 1) {
    const ring = rings[r]
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU
      const widthScale = 1 + 0.4 * Math.sin(angle * 3 + 1.4)
      const radius =
        lakeRadiusAt(angle) * ring.factor +
        (ring.kind === 'water' ? 0 : ring.extra * widthScale)
      const x = cx + Math.cos(angle) * radius
      const z = cz + Math.sin(angle) * radius
      positions.push(x, ring.y, z)

      let color: THREE.Color
      if (ring.kind === 'water') {
        const t = ring.depth * (0.7 + 0.3 * Math.sin(angle * 1.5 + 0.5))
        color = LAKE_DEEP.clone().lerp(LAKE_EDGE, t)
      } else if (ring.kind === 'wet') {
        color = wetSand.clone()
      } else if (ring.kind === 'sand') {
        color = sand.clone()
      } else {
        const [gr, gg, gb] = grassColorAt(Math.atan2(z, x))
        const grass = new THREE.Color().setRGB(gr, gg, gb, THREE.SRGBColorSpace)
        color = ring.kind === 'blend' ? sand.clone().lerp(grass, 0.5) : grass
      }
      colors.push(color.r, color.g, color.b)
    }
  }

  const ringVertex = (r: number, i: number) => 1 + (r - 1) * segments + (i % segments)

  for (let i = 0; i < segments; i += 1) {
    indices.push(0, ringVertex(1, i + 1), ringVertex(1, i))
  }

  for (let r = 1; r < rings.length - 1; r += 1) {
    for (let i = 0; i < segments; i += 1) {
      const a = ringVertex(r, i)
      const b = ringVertex(r, i + 1)
      const c = ringVertex(r + 1, i)
      const d = ringVertex(r + 1, i + 1)
      indices.push(a, b, d, a, d, c)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function buildRiverGeometry(): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const pushVertex = (p: THREE.Vector3, color: THREE.Color) => {
    const index = positions.length / 3
    positions.push(p.x, p.y, p.z)
    colors.push(color.r, color.g, color.b)
    return index
  }
  const pushQuad = (a: number, b: number, c: number, d: number) => {
    indices.push(a, b, d, a, d, c)
  }

  const [lipX, lipZ] = shorePoint(RIVER_EXIT_THETA, 0)
  const centers = [
    ...RIVER_PATH.map((node) => new THREE.Vector3(node.x, RIVER_LEVEL, node.z)),
    new THREE.Vector3(lipX, RIVER_LEVEL, lipZ),
  ]
  const widths = [
    ...RIVER_PATH.map((node) => node.width),
    RIVER_PATH[RIVER_PATH.length - 1].width,
  ]

  const curve = new THREE.CatmullRomCurve3(centers)

  const widthAt = (t: number) => {
    const s = t * (widths.length - 1)
    const i = Math.min(widths.length - 2, Math.floor(s))
    const f = s - i
    return widths[i] * (1 - f) + widths[i + 1] * f
  }

  const rows = 3
  const rowIndices: number[][] = []
  for (let k = 0; k <= CHANNEL_STATIONS; k += 1) {
    const t = k / CHANNEL_STATIONS
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t)
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const half = widthAt(t) / 2
    const row: number[] = []
    for (let j = 0; j < rows; j += 1) {
      const offset = half * (1 - (2 * j) / (rows - 1))
      const p = point.clone().addScaledVector(perp, offset)
      const color = LAKE_DEEP.clone().lerp(LAKE_EDGE, Math.abs(offset) / half)
      row.push(pushVertex(p, color))
    }
    rowIndices.push(row)
  }

  for (let k = 0; k < CHANNEL_STATIONS; k += 1) {
    for (let j = 0; j < rows - 1; j += 1) {
      pushQuad(rowIndices[k][j], rowIndices[k][j + 1], rowIndices[k + 1][j], rowIndices[k + 1][j + 1])
    }
  }

  const endTangent = curve.getTangentAt(1)
  const perp = new THREE.Vector3(-endTangent.z, 0, endTangent.x).normalize()
  const halfW = RIVER_PATH[RIVER_PATH.length - 1].width / 2

  const band = (terraceIndex: number) => {
    const y = ISLAND_TERRACES[terraceIndex].y
    const [cx, cz] = shorePoint(RIVER_EXIT_THETA, terraceIndex)
    const radial = new THREE.Vector3(cx, 0, cz).normalize()
    const ox = cx + radial.x * OUTSET
    const oz = cz + radial.z * OUTSET
    const half = halfW * (1 + terraceIndex * 0.05)
    return {
      center: new THREE.Vector3(ox, y, oz),
      left: new THREE.Vector3(ox + perp.x * half, y, oz + perp.z * half),
      right: new THREE.Vector3(ox - perp.x * half, y, oz - perp.z * half),
    }
  }

  const bands = ISLAND_TERRACES.map((_, i) => band(i))
  const bandVertices = bands.map((b, i) => {
    const color = FALL_TOP.clone().lerp(FALL_BOTTOM, i / (bands.length - 1))
    color.offsetHSL(0, 0, i % 2 === 0 ? 0.02 : -0.015)
    return [pushVertex(b.left, color), pushVertex(b.right, color)] as const
  })

  for (let i = 0; i < bandVertices.length - 1; i += 1) {
    const [topLeft, topRight] = bandVertices[i]
    const [bottomLeft, bottomRight] = bandVertices[i + 1]
    pushQuad(topLeft, topRight, bottomLeft, bottomRight)
  }

  const lowest = bands[bands.length - 1]
  const outward = new THREE.Vector3(lowest.center.x, 0, lowest.center.z).normalize()
  const toVoid = (edge: THREE.Vector3) =>
    new THREE.Vector3(
      edge.x + outward.x * 0.22,
      WATERFALL_BOTTOM,
      edge.z + outward.z * 0.22,
    )
  const bottomColor = FALL_BOTTOM.clone().lerp(FOAM, 0.25)
  const [lowLeft, lowRight] = bandVertices[bandVertices.length - 1]
  const voidLeft = pushVertex(toVoid(lowest.left), bottomColor)
  const voidRight = pushVertex(toVoid(lowest.right), bottomColor)
  pushQuad(lowLeft, lowRight, voidLeft, voidRight)

  const foamBack = new THREE.Vector3(lipX, RIVER_LEVEL + 0.012, lipZ).addScaledVector(
    endTangent,
    -0.5,
  )
  const foamLeft = pushVertex(foamBack.clone().addScaledVector(perp, halfW), FOAM)
  const foamRight = pushVertex(foamBack.clone().addScaledVector(perp, -halfW), FOAM)
  const [lipLeft, lipRight] = bandVertices[0]
  pushQuad(foamLeft, foamRight, lipLeft, lipRight)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

export default function River() {
  const riverGeometry = useMemo(() => buildRiverGeometry(), [])
  const lakeGeometry = useMemo(() => buildLakeGeometry(), [])

  return (
    <>
      <mesh geometry={lakeGeometry} raycast={() => null}>
        <meshStandardMaterial
          vertexColors
          roughness={0.32}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={riverGeometry} raycast={() => null}>
        <meshStandardMaterial
          vertexColors
          roughness={0.35}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  )
}
