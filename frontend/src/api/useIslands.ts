import { useEffect, useMemo, useState } from 'react'
import { fetchIslands, subscribePresence } from './client'
import type { IslandsResponse, PresenceStatus } from './types'

type IslandsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: IslandsResponse }

// Shared across pages so going from the islands into a house and back doesn't refetch.
let cached: Promise<IslandsResponse> | null = null

function loadIslands(): Promise<IslandsResponse> {
  cached ??= fetchIslands().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}

export function useIslands(): IslandsState {
  const [state, setState] = useState<IslandsState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    loadIslands().then(
      (data) => alive && setState({ status: 'ready', data }),
      (error: unknown) =>
        alive && setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
    return () => {
      alive = false
    }
  }, [])

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
