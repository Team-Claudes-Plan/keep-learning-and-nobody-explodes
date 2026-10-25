import { useEffect, useMemo, useState } from 'react'
import { SignedOutError, fetchIslands, subscribePresence } from './client'
import type { IslandsResponse, PresenceStatus } from './types'

type IslandsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** The backend does not know who is asking; see `createUser`. */
  | { status: 'signed-out' }
  | { status: 'ready'; data: IslandsResponse }

// Shared across pages so going from the islands into a house and back doesn't refetch.
let cached: Promise<IslandsResponse> | null = null
const listeners = new Set<() => void>()

function loadIslands(): Promise<IslandsResponse> {
  cached ??= fetchIslands().catch((error: unknown) => {
    cached = null
    throw error
  })
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
        if (error instanceof SignedOutError) setState({ status: 'signed-out' })
        else setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
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
