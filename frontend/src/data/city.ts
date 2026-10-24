export const BLOCK_SIZE = 3.4
export const SIDEWALK_WIDTH = 0.26
export const SIDEWALK_HEIGHT = 0.09
export const ROAD_WIDTH = 1.2
export const GRID_RADIUS = 1

export const BLOCK_SPACING = BLOCK_SIZE + 2 * SIDEWALK_WIDTH + ROAD_WIDTH

export const GRASS_COLORS = ['#4f8f5a', '#579a61', '#63a86a', '#4a8a54']

export function blockCenter(i: number, j: number): [number, number] {
  return [i * BLOCK_SPACING, j * BLOCK_SPACING]
}

export type CityBlock = {
  i: number
  j: number
  center: [number, number]
  color: string
}

export const HOUSE_BLOCKS = [
  { id: 'house-a', i: -1, j: -1 },
  { id: 'house-b', i: 1, j: -1 },
  { id: 'house-c', i: 0, j: 0 },
] as const

const occupiedKeys = new Set(HOUSE_BLOCKS.map((block) => `${block.i}:${block.j}`))

export function houseBlockCenter(houseId: string): [number, number] {
  const block = HOUSE_BLOCKS.find((entry) => entry.id === houseId)
  return block ? blockCenter(block.i, block.j) : [0, 0]
}

export const CITY_BLOCKS: CityBlock[] = []
export const FIELD_BLOCKS: CityBlock[] = []

let blockIndex = 0
for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i += 1) {
  for (let j = -GRID_RADIUS; j <= GRID_RADIUS; j += 1) {
    const block: CityBlock = {
      i,
      j,
      center: blockCenter(i, j),
      color: GRASS_COLORS[Math.abs(i * 3 + j * 5 + blockIndex) % GRASS_COLORS.length],
    }
    CITY_BLOCKS.push(block)
    if (!occupiedKeys.has(`${i}:${j}`)) FIELD_BLOCKS.push(block)
    blockIndex += 1
  }
}

const FRONT_FACING_ROAD_LINE = (GRID_RADIUS + 0.5) * BLOCK_SPACING

export const ROAD_LINES: number[] = []
for (let i = -GRID_RADIUS - 1; i <= GRID_RADIUS; i += 1) {
  const line = (i + 0.5) * BLOCK_SPACING
  if (Math.abs(line - FRONT_FACING_ROAD_LINE) < 1e-6) continue
  ROAD_LINES.push(line)
}

export const CITY_EXTENT = GRID_RADIUS * BLOCK_SPACING + BLOCK_SIZE / 2 + SIDEWALK_WIDTH

export type FieldProp = {
  id: string
  kind: 'tree' | 'bush' | 'lamp'
  position: [number, number, number]
  rotation: number
  scale: number
  color: string
}

const FOLIAGE_COLORS = ['#3d7a4a', '#4f9a58', '#356b41', '#5aa864']
const BUSH_COLORS = ['#4c8f54', '#3f7d49', '#5aa15f']

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

function buildFieldProps(): FieldProp[] {
  const props: FieldProp[] = []
  const half = BLOCK_SIZE / 2 - 0.45
  const y = SIDEWALK_HEIGHT

  FIELD_BLOCKS.forEach((block, index) => {
    const random = mulberry32(1000 + index * 97 + block.i * 13 + block.j * 29)
    const [cx, cz] = block.center

    const treeCount = 2 + Math.floor(random() * 2)
    for (let t = 0; t < treeCount; t += 1) {
      props.push({
        id: `${block.i}-${block.j}-tree-${t}`,
        kind: 'tree',
        position: [cx + (random() * 2 - 1) * half, y, cz + (random() * 2 - 1) * half],
        rotation: random() * Math.PI * 2,
        scale: 0.8 + random() * 0.5,
        color: FOLIAGE_COLORS[Math.floor(random() * FOLIAGE_COLORS.length)],
      })
    }

    props.push({
      id: `${block.i}-${block.j}-bush-0`,
      kind: 'bush',
      position: [cx + (random() * 2 - 1) * half, y, cz + (random() * 2 - 1) * half],
      rotation: random() * Math.PI,
      scale: 0.75 + random() * 0.5,
      color: BUSH_COLORS[Math.floor(random() * BUSH_COLORS.length)],
    })

    const corner = random() > 0.5 ? 1 : -1
    props.push({
      id: `${block.i}-${block.j}-lamp-0`,
      kind: 'lamp',
      position: [cx + corner * (half + 0.1), y, cz - corner * (half + 0.1)],
      rotation: 0,
      scale: 1,
      color: '#ffe6a8',
    })
  })

  return props
}

export const FIELD_PROPS: FieldProp[] = buildFieldProps()
