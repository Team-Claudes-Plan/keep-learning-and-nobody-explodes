import { useEffect, useMemo, useState } from 'react'
import { SignedOutError, fetchIslands, subscribePresence } from './client'
import { channelState, onAddedToIsland, onIslandUpdated, subscribeUserChannel } from './invites'
import type { Island, IslandsResponse, PresenceStatus } from './types'

type IslandsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** The backend does not know who is asking; see `createUser`. */
  | { status: 'signed-out' }
  | { status: 'ready'; data: IslandsResponse }

/** The island that owns the documents and houses: the island itself, or the origin of a fork. */
export const contentIslandId = (island: Island) => island.origin_id ?? island.id

// Shared across pages so going from the islands into a house and back doesn't refetch.
let cached: Promise<IslandsResponse> | null = null
/** The last islands that loaded, to check pushes against. */
let latest: IslandsResponse | null = null
const listeners = new Set<() => void>()
let watching = false

const refresh = () => void reloadIslands().catch(() => undefined)

/**
 * Keeps the islands fresh from the user channel while the app runs, on every page: refetches when
 * an upload finished processing, when someone added me to an island, and after a reconnect (pushes
 * sent while offline are lost).
 */
function watchIslands() {
  if (watching) return
  watching = true
  onIslandUpdated((rootId) => {
    if (latest?.islands.some((island) => contentIslandId(island) === rootId)) refresh()
  })
  onAddedToIsland(refresh)
  let wasOffline = false
  subscribeUserChannel(() => {
    const { connection } = channelState()
    if (connection === 'offline') wasOffline = true
    else if (connection === 'open' && wasOffline) {
      wasOffline = false
      refresh()
    }
  })
}

function loadIslands(): Promise<IslandsResponse> {
  cached ??= fetchIslands().then(
    (data) => {
      latest = data
      return data
    },
    (error: unknown) => {
      cached = null
      throw error
    },
  )
  return cached
}

/** Fetches the islands again, e.g. after creating one, and updates every page showing them. */
export function reloadIslands(): Promise<IslandsResponse> {
  cached = null
  const loading = loadIslands()
  for (const listener of listeners) listener()
  return loading
}

export function useIslands(): IslandsState {
  const [state, setState] = useState<IslandsState>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    watchIslands()
    const listener = () => setVersion((current) => current + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    let alive = true
    loadIslands().then(
      (data) => alive && setState({ status: 'ready', data }),
      (error: unknown) => {
        if (!alive) return
        // A failed refetch in the background keeps the islands on screen.
        setState((current) => {
          if (current.status === 'ready') return current
          if (error instanceof SignedOutError) return { status: 'signed-out' }
          return { status: 'error', message: error instanceof Error ? error.message : String(error) }
        })
      },
    )
    return () => {
      alive = false
    }
  }, [version])

  return state
}

/** Live online status per user id. Users without news yet count as offline; `selfId` is always online. */
export function usePresence(userIds: string[], selfId?: string): Record<string, PresenceStatus> {
  const [statuses, setStatuses] = useState<Record<string, PresenceStatus>>({})
  const key = useMemo(() => [...new Set(userIds)].sort().join(','), [userIds])

  useEffect(() => {
    if (!key) return
    return subscribePresence(key.split(','), ({ userId, status }) =>
      setStatuses((current) => (current[userId] === status ? current : { ...current, [userId]: status })),
    )
  }, [key])

  return useMemo(() => (selfId ? { ...statuses, [selfId]: 'online' } : statuses), [statuses, selfId])
}
