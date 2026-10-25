import { useMemo } from 'react'
import * as THREE from 'three'
import {
  ISLAND_TERRACES,
  LAKE_CENTER,
  LAKE_LEVEL,
  LAKE_RIM_SEGMENTS,
  RIVER_LEVEL,
  RIVER_PATH,
  WATERFALL_BOTTOM,
  cliffReach,
  grassColorAt,
  lakeRadiusAt,
} from '../../data/island'
import { GRID_EXTENT } from '../../data/islandGrid'

const TAU = Math.PI * 2

const FALL_TOP = new THREE.Color('#6fb6e0')
const FALL_BOTTOM = new THREE.Color('#3a83ba')
const FOAM = new THREE.Color('#d3ecfa')
const LAKE_DEEP = new THREE.Color('#2f7fc0')
const LAKE_EDGE = new THREE.Color('#57b6e4')
const SHORE = new THREE.Color('#c6b184')

const SHORE_WIDTH = 0.34
/** The lake shore stops this far before the cliff edge. */
const SHORE_EDGE_MARGIN = 0.08
/** The lake shore stops this far before the grid's sidewalks and roads. */
const GRID_EDGE_MARGIN = 0.1
/** Narrowest sand strip kept where the lake is squeezed. */
const MIN_SHORE = 0.32
const MIN_LAKE_RADIUS = 0.5
const CHANNEL_STATIONS = 64
/** Vertices across the river; enough that cliff corners can't poke between them. */
const COLUMNS = 5
/** Rows per terrace step, so the sheet follows the cliff's bends. */
const FALL_SUBSTEPS = 3
/** How far the water sheet floats in front of the rock. */
const LIP_OUTSET = 0.04
const FALL_OUTSET = 0.06
/** Cliff samples per side of each water grid cell when checking clearance. */
const CELL_SAMPLES = 6
/** How much wider the fall gets towards the bottom of the island. */
const FALL_SPREAD = 0.15
/** Outward drift of the free fall below the island. */
const VOID_DRIFT = 0.3

/** Distance from (ox, oz) along (dx, dz) to the grid's square footprint. */
function gridReach(ox: number, oz: number, dx: number, dz: number): number {
  const e = GRID_EXTENT
  let near = -Infinity
  let far = Infinity
  for (const [o, d] of [
    [ox, dx],
    [oz, dz],
  ]) {
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(o) > e) return Infinity
      continue
    }
    const t1 = (-e - o) / d
    const t2 = (e - o) / d
    near = Math.max(near, Math.min(t1, t2))
    far = Math.min(far, Math.max(t1, t2))
  }
  return near <= far && far > 0 ? Math.max(0, near) : Infinity
}

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

  const outerExtra = rings[rings.length - 1].extra

  for (let r = 1; r < rings.length; r += 1) {
    const ring = rings[r]
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * TAU
      const dx = Math.cos(angle)
      const dz = Math.sin(angle)
      const widthScale = 1 + 0.4 * Math.sin(angle * 3 + 1.4)
      const lakeRadius = lakeRadiusAt(angle)
      const shoreWidth = outerExtra * widthScale

      // Fit water + shore inside the room left by the cliff and the grid.
      const room = Math.min(
        cliffReach(cx, cz, dx, dz, 0) - SHORE_EDGE_MARGIN,
        gridReach(cx, cz, dx, dz) - GRID_EDGE_MARGIN,
      )
      const fitted = lakeRadius + shoreWidth > room
      const waterEdge = fitted ? Math.max(MIN_LAKE_RADIUS, Math.min(lakeRadius, room - MIN_SHORE)) : lakeRadius
      const shoreSpan = fitted ? Math.max(0, room - waterEdge) : shoreWidth

      const radius =
        ring.kind === 'water'
          ? waterEdge * ring.factor
          : waterEdge + shoreSpan * (ring.extra / outerExtra)
      const x = cx + dx * radius
      const z = cz + dz * radius
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
  const pushGrid = (rows: number[][]) => {
    for (let k = 0; k < rows.length - 1; k += 1) {
      for (let j = 0; j < COLUMNS - 1; j += 1) {
        pushQuad(rows[k][j], rows[k][j + 1], rows[k + 1][j], rows[k + 1][j + 1])
      }
    }
  }

  const curve = new THREE.CatmullRomCurve3(
    RIVER_PATH.map((node) => new THREE.Vector3(node.x, RIVER_LEVEL, node.z)),
  )
  const widths = RIVER_PATH.map((node) => node.width)
  const widthAt = (t: number) => {
    const s = t * (widths.length - 1)
    const i = Math.min(widths.length - 2, Math.floor(s))
    const f = s - i
    return widths[i] * (1 - f) + widths[i + 1] * f
  }
  const offsetFactor = (j: number) => 1 - (2 * j) / (COLUMNS - 1)

  // Channel across the island top.
  const channel: number[][] = []
  for (let k = 0; k <= CHANNEL_STATIONS; k += 1) {
    const t = k / CHANNEL_STATIONS
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t)
    const perp = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
    const half = widthAt(t) / 2
    const row: number[] = []
    for (let j = 0; j < COLUMNS; j += 1) {
      const factor = offsetFactor(j)
      const color = LAKE_DEEP.clone().lerp(LAKE_EDGE, Math.abs(factor))
      row.push(pushVertex(point.clone().addScaledVector(perp, half * factor), color))
    }
    channel.push(row)
  }

  // Waterfall: each column runs straight on from the channel and hugs the
  // measured cliff surface, so no rock can poke through the water.
  const end = curve.getPointAt(1)
  const dir = curve.getTangentAt(1).setY(0).normalize()
  const perp = new THREE.Vector3(-dir.z, 0, dir.x)
  const halfW = widths[widths.length - 1] / 2
  const depth = RIVER_LEVEL - ISLAND_TERRACES[ISLAND_TERRACES.length - 1].y

  const columnOrigin = (lateral: number) => end.clone().addScaledVector(perp, halfW * lateral)
  const spreadAt = (y: number) =>
    1 + Math.min(1, Math.max(0, (RIVER_LEVEL - y) / depth)) * FALL_SPREAD

  const rows: { y: number; color: THREE.Color; outset: number }[] = [
    { y: RIVER_LEVEL, color: FOAM.clone().lerp(FALL_TOP, 0.4), outset: LIP_OUTSET },
  ]
  for (let ti = 0; ti < ISLAND_TERRACES.length - 1; ti += 1) {
    const yTop = ISLAND_TERRACES[ti].y
    const yBottom = ISLAND_TERRACES[ti + 1].y
    for (let s = 1; s <= FALL_SUBSTEPS; s += 1) {
      const y = yTop + ((yBottom - yTop) * s) / FALL_SUBSTEPS
      const color = FALL_TOP.clone().lerp(FALL_BOTTOM, (RIVER_LEVEL - y) / depth)
      color.offsetHSL(0, 0, ti % 2 === 0 ? 0.02 : -0.015)
      // A little white water where the fall hits each ledge.
      if (s === FALL_SUBSTEPS) color.lerp(FOAM, 0.3)
      rows.push({ y, color, outset: FALL_OUTSET })
    }
  }
  rows.push({ y: WATERFALL_BOTTOM, color: FALL_BOTTOM.clone().lerp(FOAM, 0.25), outset: FALL_OUTSET + VOID_DRIFT })

  // How far out the rock reaches anywhere inside each cell of the water grid.
  // A vertex that clears every cell around it keeps the whole sheet in front
  // of the rock, since the sheet between vertices is just a blend of them.
  const lateralAt = (k: number, j: number) => offsetFactor(j) * spreadAt(rows[k].y)
  const cellReach = (k: number, j: number) => {
    let best = 0
    for (let a = 0; a <= CELL_SAMPLES; a += 1) {
      const v = a / CELL_SAMPLES
      const y = rows[k].y + (rows[k + 1].y - rows[k].y) * v
      for (let b = 0; b <= CELL_SAMPLES; b += 1) {
        const u = b / CELL_SAMPLES
        const lateral =
          (lateralAt(k, j) * (1 - v) + lateralAt(k + 1, j) * v) * (1 - u) +
          (lateralAt(k, j + 1) * (1 - v) + lateralAt(k + 1, j + 1) * v) * u
        const origin = columnOrigin(lateral)
        best = Math.max(best, cliffReach(origin.x, origin.z, dir.x, dir.z, y))
      }
    }
    return best
  }
  const cells = Array.from({ length: rows.length - 1 }, (_, k) =>
    Array.from({ length: COLUMNS - 1 }, (_, j) => cellReach(k, j)),
  )
  const reach = rows.map((row, k) =>
    Array.from({ length: COLUMNS }, (_, j) => {
      let best = 0
      for (const ck of [k - 1, k]) {
        for (const cj of [j - 1, j]) {
          if (cells[ck]?.[cj] !== undefined) best = Math.max(best, cells[ck][cj])
        }
      }
      return best + row.outset
    }),
  )

  // Water only falls outward: never let a column tuck back under an overhang.
  for (let k = 1; k < reach.length; k += 1) {
    reach[k] = reach[k].map((r, j) => Math.max(r, reach[k - 1][j]))
  }

  const fall: number[][] = [
    channel[channel.length - 1],
    ...rows.map((row, k) =>
      reach[k].map((r, j) => {
        const p = columnOrigin(lateralAt(k, j)).addScaledVector(dir, r).setY(row.y)
        return pushVertex(p, row.color)
      }),
    ),
  ]

  pushGrid(channel)
  pushGrid(fall)

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
