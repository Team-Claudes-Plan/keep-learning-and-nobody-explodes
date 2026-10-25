import type { Island, IslandHouse } from '../api/types'
import { ISLAND_TERRACES, SCREEN_RIGHT, cliffReach, type Vec2 } from './island'
import { GRID_BLOCKS, blockCenter, freeBlocks, type GridBlock, type GridCell } from './islandGrid'
import { HOUSES, houseAtLevel, maxLevel, type House } from './houses'

/** Open water a bridge crosses between two islands. */
const BRIDGE_SPAN = 14
/** How far a bridge reaches onto the grass at each end. */
const BRIDGE_LANDING = 1

const [RIGHT_X, RIGHT_Z] = SCREEN_RIGHT
const REACH_RIGHT = cliffReach(0, 0, RIGHT_X, RIGHT_Z, 0)
const REACH_LEFT = cliffReach(0, 0, -RIGHT_X, -RIGHT_Z, 0)

/** Distance between the centers of neighbouring islands. */
export const ISLAND_SPACING = REACH_RIGHT + REACH_LEFT + BRIDGE_SPAN

/** How much of a neighbouring island may show at the screen edge before crossing the bridge. */
const NEIGHBOUR_PEEK = 2

/** Furthest an island's cliffs stick out sideways on screen; the lowest terraces flare out the most. */
const widestReach = (dx: number, dz: number) =>
  Math.max(...ISLAND_TERRACES.map((terrace) => cliffReach(0, 0, dx, dz, terrace.y)))

/**
 * How far to the side of the active island's center the view may reach, so only the near edge of
 * a neighbour shows. The same on both sides, using the tighter one.
 */
export const VIEW_SIDE_REACH =
  ISLAND_SPACING - Math.max(widestReach(-RIGHT_X, -RIGHT_Z), widestReach(RIGHT_X, RIGHT_Z)) + NEIGHBOUR_PEEK

/** World position of the island at this index; index 0 is the leftmost. */
export function islandCenter(index: number): Vec2 {
  return [index * ISLAND_SPACING * RIGHT_X, index * ISLAND_SPACING * RIGHT_Z]
}

export type BridgeSpan = {
  /** On the right shore of the island at `leftIndex`. */
  start: Vec2
  /** On the left shore of the next island. */
  end: Vec2
  leftIndex: number
}

export function bridgeBetween(leftIndex: number): BridgeSpan {
  const [lx, lz] = islandCenter(leftIndex)
  const [rx, rz] = islandCenter(leftIndex + 1)
  const out = REACH_RIGHT - BRIDGE_LANDING
  const back = REACH_LEFT - BRIDGE_LANDING
  return {
    start: [lx + RIGHT_X * out, lz + RIGHT_Z * out],
    end: [rx - RIGHT_X * back, rz - RIGHT_Z * back],
    leftIndex,
  }
}

/** Highest house level the backend reports (`knowledge::MAX_LEVEL`). */
export const MAX_HOUSE_LEVEL = 4

/** A topic of the island, standing as a house on one cell of its grid. */
export type PlacedHouse = {
  topicId: string
  /** The topic's name. */
  name: string
  /** 0 to MAX_HOUSE_LEVEL, how far every member knows the topic. */
  level: number
  unlocked: boolean
  /** The design the topic is drawn with, named after the topic and cut down to its level. */
  house: House
  cell: GridCell
  position: Vec2
}

export type ResolvedIsland = {
  island: Island
  houses: PlacedHouse[]
  /** Topics without a free cell left; they are only listed. */
  unplaced: IslandHouse[]
  fieldBlocks: GridBlock[]
}

/**
 * Cells houses are built on: the middle first, the front corner last. One cell always stays free
 * for the members to walk around, and the front one keeps them in view.
 */
const HOUSE_CELLS: GridCell[] = [...GRID_BLOCKS]
  .sort((a, b) => Math.hypot(a.i, a.j) - Math.hypot(b.i, b.j) || a.i + a.j - (b.i + b.j) || a.i - b.i)
  .slice(0, GRID_BLOCKS.length - 1)
  .map(({ i, j }) => ({ i, j }))

/** A stable number for a topic id, so a topic keeps its design across reloads. */
function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  }
  return value >>> 0
}

/** The topic's design, preferring one not used on this island yet. */
function pickDesign(topicId: string, used: Set<string>): House {
  const start = hash(topicId) % HOUSES.length
  for (let offset = 0; offset < HOUSES.length; offset += 1) {
    const design = HOUSES[(start + offset) % HOUSES.length]
    if (!used.has(design.id)) return design
  }
  return HOUSES[start]
}

/** Storeys a design shows at a level: the share of its storeys, but always the ground floor to play in. */
export function storeysAtLevel(design: House, level: number): number {
  return Math.max(1, Math.ceil((Math.min(level, MAX_HOUSE_LEVEL) / MAX_HOUSE_LEVEL) * maxLevel(design)))
}

/** Places an island's topics as houses on its grid, in the order the backend lists them. */
export function resolveIsland(island: Island): ResolvedIsland {
  const used = new Set<string>()
  const houses = island.houses.slice(0, HOUSE_CELLS.length).map((topic, index): PlacedHouse => {
    const design = pickDesign(topic.topic_id, used)
    used.add(design.id)
    const cell = HOUSE_CELLS[index]
    return {
      topicId: topic.topic_id,
      name: topic.name,
      level: topic.level,
      unlocked: topic.unlocked,
      house: { ...houseAtLevel(design, storeysAtLevel(design, topic.level)), name: topic.name },
      cell,
      position: blockCenter(cell.i, cell.j),
    }
  })
  return {
    island,
    houses,
    unplaced: island.houses.slice(HOUSE_CELLS.length),
    fieldBlocks: freeBlocks(houses.map((placed) => placed.cell)),
  }
}
