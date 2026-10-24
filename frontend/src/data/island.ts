export const ISLAND_HALF = 10.5
export const ISLAND_JITTER = 0.07
export const SEABED_LEVEL = -3.4

export const ISLAND_TERRACES = [
  { y: 0, scale: 1 },
  { y: -0.55, scale: 1.03 },
  { y: -1.3, scale: 1.07 },
  { y: -2.4, scale: 1.1 },
  { y: SEABED_LEVEL, scale: 1.13 },
]

export type Vec2 = [number, number]

const TAU = Math.PI * 2

function angularNoise(theta: number): number {
  return (
    0.5 * Math.sin(theta * 3 + 1.1) +
    0.3 * Math.sin(theta * 5 - 0.4) +
    0.2 * Math.sin(theta * 8 + 2.2)
  )
}

function superellipse(theta: number): number {
  const c = Math.abs(Math.cos(theta))
  const s = Math.abs(Math.sin(theta))
  const n = 4
  return ISLAND_HALF / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n)
}

export function islandRadius(theta: number): number {
  return superellipse(theta) * (1 + ISLAND_JITTER * angularNoise(theta))
}

export const GRASS_PALETTE: [number, number, number][] = [
  [0x4f, 0x8f, 0x5a],
  [0x57, 0x9a, 0x61],
  [0x63, 0xa8, 0x6a],
  [0x4a, 0x8a, 0x54],
]

export const GRASS_CENTER: [number, number, number] = [0, 0, 0].map(
  (_, channel) => GRASS_PALETTE.reduce((sum, color) => sum + color[channel], 0) / GRASS_PALETTE.length / 255,
) as [number, number, number]

export function grassColorAt(theta: number): [number, number, number] {
  const turns = ((theta / TAU) % 1 + 1) % 1
  const scaled = turns * GRASS_PALETTE.length
  const index = Math.floor(scaled) % GRASS_PALETTE.length
  const f = scaled - Math.floor(scaled)
  const a = GRASS_PALETTE[index]
  const b = GRASS_PALETTE[(index + 1) % GRASS_PALETTE.length]
  return [
    (a[0] + (b[0] - a[0]) * f) / 255,
    (a[1] + (b[1] - a[1]) * f) / 255,
    (a[2] + (b[2] - a[2]) * f) / 255,
  ]
}

export function clampToShoreline(x: number, z: number): [number, number] {
  const r = Math.hypot(x, z)
  if (r < 1e-6) return [x, z]
  const maxR = islandRadius(Math.atan2(z, x)) * 0.96
  if (r <= maxR) return [x, z]
  const scale = maxR / r
  return [x * scale, z * scale]
}

export const RING_SEGMENTS = 36

export const ISLAND_RING: Vec2[] = Array.from({ length: RING_SEGMENTS }, (_, i) => {
  const theta = (i / RING_SEGMENTS) * TAU
  const r = islandRadius(theta)
  return [Math.cos(theta) * r, Math.sin(theta) * r] as Vec2
})

export function shorePoint(theta: number, terraceIndex: number): [number, number] {
  const wrapped = ((theta % TAU) + TAU) % TAU
  const seg = (wrapped / TAU) * RING_SEGMENTS
  const base = Math.floor(seg)
  const i0 = base % RING_SEGMENTS
  const i1 = (i0 + 1) % RING_SEGMENTS
  const f = seg - base
  const p0 = ISLAND_RING[i0]
  const p1 = ISLAND_RING[i1]
  const x = p0[0] + (p1[0] - p0[0]) * f
  const z = p0[1] + (p1[1] - p0[1]) * f
  const jitter = 1 + 0.045 * Math.sin((i0 + f) * 2.3 + terraceIndex * 1.7)
  const scale = ISLAND_TERRACES[terraceIndex].scale
  return [x * scale * jitter, z * scale * jitter]
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const RIVER_LEVEL = 0.05
export const WATERFALL_BOTTOM = -11
export const RIVER_EXIT_THETA = (72 * Math.PI) / 180
export const RIVER_END_WIDTH = 1.3

export const LAKE_LEVEL = 0.04
export const LAKE_CENTER: Vec2 = [3.1, 8.3]
export const LAKE_BASE = 1.2
export const LAKE_STRETCH_X = 1.35
export const LAKE_STRETCH_Z = 0.95
export const LAKE_RIM_SEGMENTS = RING_SEGMENTS

export function lakeRadiusAt(angle: number): number {
  const ellipse = Math.hypot(
    Math.cos(angle) / LAKE_STRETCH_X,
    Math.sin(angle) / LAKE_STRETCH_Z,
  )
  const lobes =
    0.09 * Math.sin(angle * 2 + 0.7) +
    0.06 * Math.sin(angle * 3 + 2.2) +
    0.04 * Math.sin(angle * 5 - 1.1)
  return (LAKE_BASE * (1 + lobes)) / ellipse
}

export type Boulder = {
  position: [number, number, number]
  scale: [number, number, number]
  rotation: [number, number, number]
  color: string
}

const ROCK_COLORS = ['#6b7078', '#7c818a', '#5d6169', '#8b919a', '#6f6a5e']

function buildBoulders(): Boulder[] {
  const rocks: Boulder[] = []
  const random = mulberry32(7331)

  const count = 130
  for (let i = 0; i < count; i += 1) {
    const theta = random() * TAU
    const edge = 0.82 + random() * 0.3
    const r = islandRadius(theta) * edge
    const x = Math.cos(theta) * r
    const z = Math.sin(theta) * r
    const y = -0.1 - random() * 0.7
    const s = 0.28 + random() * 0.85
    const scale: [number, number, number] = [
      s * (0.8 + random() * 0.5),
      s * (0.7 + random() * 0.6),
      s * (0.8 + random() * 0.5),
    ]
    const rotation: [number, number, number] = [
      random() * TAU,
      random() * TAU,
      random() * TAU,
    ]
    const color = ROCK_COLORS[Math.floor(random() * ROCK_COLORS.length)]

    const delta = Math.atan2(Math.sin(theta - RIVER_EXIT_THETA), Math.cos(theta - RIVER_EXIT_THETA))
    const nearRiver = Math.abs(delta) < 0.3
    const nearLake = Math.hypot(x - LAKE_CENTER[0], z - LAKE_CENTER[1]) < 2.2
    if (nearRiver || nearLake) continue

    rocks.push({ position: [x, y, z], scale, rotation, color })
  }

  return rocks
}

export const ISLAND_ROCKS: Boulder[] = buildBoulders()

export type RiverNode = {
  x: number
  z: number
  width: number
}

const RIVER_SOURCE_RADIUS = 9.5
const RIVER_NODE_COUNT = 6
const RIVER_MEANDER = 0.06

export const RIVER_PATH: RiverNode[] = Array.from({ length: RIVER_NODE_COUNT }, (_, i) => {
  const f = i / (RIVER_NODE_COUNT - 1)
  const edgeRadius = islandRadius(RIVER_EXIT_THETA) * 0.985
  const r = RIVER_SOURCE_RADIUS + (edgeRadius - RIVER_SOURCE_RADIUS) * f
  const theta = RIVER_EXIT_THETA + RIVER_MEANDER * Math.sin(f * Math.PI)
  return {
    x: Math.cos(theta) * r,
    z: Math.sin(theta) * r,
    width: 0.5 + (RIVER_END_WIDTH - 0.5) * f,
  }
})
