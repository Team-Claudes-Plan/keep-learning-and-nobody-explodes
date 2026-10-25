import {
  BLOCK_SIZE,
  ROAD_LINES,
  SIDEWALK_HEIGHT,
  SIDEWALK_WIDTH,
  type GridBlock,
} from './islandGrid'

export const ROAD_SURFACE_Y = 0.012
export const LANE_OFFSET = 0.26

export type Vec2 = [number, number]

export type CarRoute = {
  id: string
  points: Vec2[]
  speed: number
  phase: number
  color: string
}

export type ParkedCar = {
  id: string
  position: [number, number, number]
  rotation: number
  color: string
}

export type AnimalSpec = {
  id: string
  kind: 'dog' | 'cat'
  points: Vec2[]
  speed: number
  phase: number
  color: string
  scale: number
}

export type BirdSpec = {
  id: string
  center: Vec2
  radiusX: number
  radiusZ: number
  height: number
  speed: number
  phase: number
  bob: number
  color: string
  scale: number
}

export type PerchedBird = {
  id: string
  position: [number, number, number]
  rotation: number
  color: string
  scale: number
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

const CAR_COLORS = ['#8b939e', '#7c3f3f', '#3f4f6b']
const DOG_COLORS = ['#8a6a4a', '#5f5347', '#a9855c']
const CAT_COLORS = ['#8d8f93', '#b0793f', '#6f7074']
const BIRD_COLORS = ['#3f4753', '#514741', '#2f3742', '#5a4b3d']

function buildRoute(a: number, b: number, inset: number): Vec2[] {
  const xa = a + inset
  const xb = b - inset
  return [
    [xa, xa],
    [xb, xa],
    [xb, xb],
    [xa, xb],
  ]
}

function buildCarRoutes(): CarRoute[] {
  const random = mulberry32(2024)
  const a = ROAD_LINES[1]
  const b = ROAD_LINES[2]

  return [0, 1, 2].map((index) => ({
    id: `car-${index}`,
    points: buildRoute(a, b, LANE_OFFSET),
    speed: 1.4 + random() * 0.6,
    phase: random(),
    color: CAR_COLORS[index % CAR_COLORS.length],
  }))
}

export const CAR_ROUTES: CarRoute[] = buildCarRoutes()

export const PARKED_CARS: ParkedCar[] = [
  {
    id: 'parked-0',
    position: [ROAD_LINES[1] - LANE_OFFSET - 0.16, ROAD_SURFACE_Y, 0.9],
    rotation: Math.PI / 2,
    color: '#6f7885',
  },
  {
    id: 'parked-1',
    position: [ROAD_LINES[2] + LANE_OFFSET + 0.16, ROAD_SURFACE_Y, -0.9],
    rotation: Math.PI / 2,
    color: '#7c3f3f',
  },
]

function sidewalkLoop(center: Vec2): Vec2[] {
  const half = BLOCK_SIZE / 2 + SIDEWALK_WIDTH / 2
  const [cx, cz] = center
  return [
    [cx - half, cz - half],
    [cx + half, cz - half],
    [cx + half, cz + half],
    [cx - half, cz + half],
  ]
}

function byDistance(fieldBlocks: GridBlock[]): GridBlock[] {
  return [...fieldBlocks].sort(
    (left, right) =>
      Math.hypot(left.center[0], left.center[1]) - Math.hypot(right.center[0], right.center[1]),
  )
}

export function buildAnimals(fieldBlocks: GridBlock[]): AnimalSpec[] {
  const fieldBlocksByDistance = byDistance(fieldBlocks)
  const random = mulberry32(7341)
  return fieldBlocksByDistance.slice(0, 4).map((block, index) => {
    const kind = index % 2 === 0 ? 'dog' : 'cat'
    const palette = kind === 'dog' ? DOG_COLORS : CAT_COLORS
    return {
      id: `animal-${block.i}-${block.j}`,
      kind,
      points: sidewalkLoop(block.center),
      speed: 0.32 + random() * 0.18,
      phase: random(),
      color: palette[Math.floor(random() * palette.length)],
      scale: kind === 'dog' ? 0.68 : 0.6,
    }
  })
}

function buildBirds(): BirdSpec[] {
  const random = mulberry32(5510)
  return Array.from({ length: 4 }, (_, index) => ({
    id: `bird-${index}`,
    center: [(random() * 2 - 1) * 3.5, (random() * 2 - 1) * 3.5],
    radiusX: 1.8 + random() * 1.6,
    radiusZ: 1.8 + random() * 1.6,
    height: 6.8 + random() * 2.4,
    speed: 0.22 + random() * 0.14,
    phase: random() * Math.PI * 2,
    bob: 0.2 + random() * 0.25,
    color: BIRD_COLORS[index % BIRD_COLORS.length],
    scale: 0.85 + random() * 0.3,
  }))
}

export const BIRDS: BirdSpec[] = buildBirds()

export function buildPerchedBirds(fieldBlocks: GridBlock[]): PerchedBird[] {
  const fieldBlocksByDistance = byDistance(fieldBlocks)
  const random = mulberry32(9182)
  const half = BLOCK_SIZE / 2 + SIDEWALK_WIDTH / 2
  return fieldBlocksByDistance.slice(-2).map((block, index) => {
    const [cx, cz] = block.center
    const signX = cx === 0 ? 1 : -Math.sign(cx)
    const signZ = cz === 0 ? 1 : -Math.sign(cz)
    return {
      id: `perch-${block.i}-${block.j}`,
      position: [cx + signX * half, SIDEWALK_HEIGHT, cz + signZ * half],
      rotation: index % 2 === 0 ? Math.PI : 0,
      color: BIRD_COLORS[Math.floor(random() * BIRD_COLORS.length)],
      scale: 0.9,
    }
  })
}

export type SquirrelSpec = {
  id: string
  /** Base of the tree the squirrel circles. */
  center: Vec2
  radius: number
  color: string
  scale: number
}

/** One squirrel scampering around the first tree of the free cell nearest the island's middle. */
export function buildSquirrel(fieldBlocks: GridBlock[], trees: { position: [number, number, number] }[]): SquirrelSpec | null {
  const block = byDistance(fieldBlocks)[0]
  if (!block) return null
  const [cx, cz] = block.center
  const tree = [...trees].sort(
    (a, b) =>
      Math.hypot(a.position[0] - cx, a.position[2] - cz) - Math.hypot(b.position[0] - cx, b.position[2] - cz),
  )[0]
  const center: Vec2 = tree ? [tree.position[0], tree.position[2]] : [cx, cz]
  return { id: `squirrel-${block.i}-${block.j}`, center, radius: 0.45, color: '#b5652e', scale: 0.55 }
}

/** A building birds must fly over: its footprint on the ground and the height of its roof. */
export type Obstacle = {
  center: Vec2
  size: Vec2
  top: number
}

/** Room left for the roof crown and landmark above the top storey. */
const CROWN_ALLOWANCE = 2
/** Space birds keep from footprints and roofs. */
const FLIGHT_MARGIN = 0.5
const FLIGHT_CLEARANCE = 0.8
/** Height birds gain per unit flown when climbing over (or sinking after) a building. */
const CLIMB_SLOPE = 0.6
const PROFILE_SAMPLES = 180

export function birdPosition(bird: BirdSpec, angle: number): Vec2 {
  return [bird.center[0] + Math.cos(angle) * bird.radiusX, bird.center[1] + Math.sin(angle) * bird.radiusZ]
}

/**
 * Cruising height of a bird around its loop, sampled evenly over one turn. Above a building it
 * flies clear of the roof, climbing early enough to get there and sinking back afterwards.
 */
export function buildFlightProfile(bird: BirdSpec, obstacles: Obstacle[]): number[] {
  const step = (Math.PI * 2) / PROFILE_SAMPLES
  const points = Array.from({ length: PROFILE_SAMPLES }, (_, index) => birdPosition(bird, index * step))
  const needed = points.map(([x, z]) =>
    obstacles.reduce((height, obstacle) => {
      const inside =
        Math.abs(x - obstacle.center[0]) < obstacle.size[0] / 2 + FLIGHT_MARGIN &&
        Math.abs(z - obstacle.center[1]) < obstacle.size[1] / 2 + FLIGHT_MARGIN
      return inside ? Math.max(height, obstacle.top + CROWN_ALLOWANCE + FLIGHT_CLEARANCE + bird.bob) : height
    }, bird.height),
  )

  // Path length between neighbouring samples, then a ramp from every point that needs height.
  const segment = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    return Math.hypot(next[0] - point[0], next[1] - point[1])
  })
  const total = segment.reduce((sum, length) => sum + length, 0)
  const along = segment.reduce<number[]>((acc, length, index) => [...acc, acc[index] + length], [0])

  return needed.map((_, i) =>
    needed.reduce((height, need, j) => {
      if (need <= height) return height
      const gap = Math.abs(along[i] - along[j])
      const distance = Math.min(gap, total - gap)
      return Math.max(height, need - CLIMB_SLOPE * distance)
    }, needed[i]),
  )
}

export function sampleFlightProfile(profile: number[], angle: number): number {
  const turn = Math.PI * 2
  const position = ((((angle % turn) + turn) % turn) / turn) * profile.length
  const index = Math.floor(position)
  const t = position - index
  return profile[index % profile.length] * (1 - t) + profile[(index + 1) % profile.length] * t
}
