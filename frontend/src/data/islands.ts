import type { Island, IslandHouse } from '../api/types'
import { ISLAND_TERRACES, SCREEN_RIGHT, cliffReach, type Vec2 } from './island'
import { blockCenter, cellKey, freeBlocks, isGridCell, type GridBlock } from './islandGrid'
import { getHouse, houseAtLevel, maxLevel, type House } from './houses'

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

export type PlacedHouse = {
  /** The design cut down to this island's level. */
  house: House
  level: number
  maxLevel: number
  cell: IslandHouse['cell']
  position: Vec2
}

export type ResolvedIsland = {
  island: Island
  houses: PlacedHouse[]
  fieldBlocks: GridBlock[]
}

/** Matches an island's houses to their designs; unknown designs, cells off the grid and doubled cells are dropped. */
export function resolveIsland(island: Island): ResolvedIsland {
  const taken = new Set<string>()
  const houses: PlacedHouse[] = []
  for (const entry of island.houses) {
    const design = getHouse(entry.houseId)
    const key = cellKey(entry.cell)
    if (!design || !isGridCell(entry.cell) || taken.has(key)) continue
    taken.add(key)
    const house = houseAtLevel(design, entry.level)
    houses.push({
      house,
      level: house.storeys.length,
      maxLevel: maxLevel(design),
      cell: entry.cell,
      position: blockCenter(entry.cell.i, entry.cell.j),
    })
  }
  return { island, houses, fieldBlocks: freeBlocks(houses.map((placed) => placed.cell)) }
}
