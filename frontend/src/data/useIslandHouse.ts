import { useMemo } from 'react'
import { useIslands } from '../api/useIslands'
import { resolveIsland, type PlacedHouse, type ResolvedIsland } from './islands'

export type IslandHouseState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'missing' }
  | { status: 'ready'; island: ResolvedIsland; placed: PlacedHouse }

/** A house as it stands on one island: its level there decides how many storeys it has. */
export function useIslandHouse(islandId: string, houseId: string): IslandHouseState {
  const state = useIslands()
  return useMemo(() => {
    if (state.status !== 'ready') return state
    const island = state.data.islands.find((entry) => entry.id === islandId)
    if (!island) return { status: 'missing' }
    const resolved = resolveIsland(island)
    const placed = resolved.houses.find((entry) => entry.house.id === houseId)
    return placed ? { status: 'ready', island: resolved, placed } : { status: 'missing' }
  }, [state, islandId, houseId])
}
