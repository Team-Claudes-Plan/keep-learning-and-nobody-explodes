import type { Island, IslandsResponse, Presence, UserSummary } from './types'

const ME: UserSummary = { id: 'user-me', name: 'Alex' }
const MIA: UserSummary = { id: 'user-mia', name: 'Mia' }
const LEO: UserSummary = { id: 'user-leo', name: 'Leo' }

const ISLANDS: Island[] = [
  {
    id: 'solo',
    name: 'My island',
    group: { id: 'group-solo', members: [ME] },
    houses: [
      { houseId: 'house-math-tower', cell: { i: -1, j: 1 }, level: 1 },
      { houseId: 'house-a', cell: { i: -1, j: -1 }, level: 2 },
      { houseId: 'house-c', cell: { i: 0, j: 0 }, level: 3 },
    ],
  },
  {
    id: 'with-mia',
    name: 'Island with Mia',
    group: { id: 'group-mia', members: [ME, MIA] },
    houses: [
      { houseId: 'house-math-tower', cell: { i: 0, j: 0 }, level: 3 },
      { houseId: 'house-b', cell: { i: 1, j: -1 }, level: 2 },
    ],
  },
  {
    id: 'with-leo',
    name: 'Island with Leo',
    group: { id: 'group-leo', members: [ME, LEO] },
    houses: [
      { houseId: 'house-math-tower', cell: { i: 1, j: 1 }, level: 4 },
      { houseId: 'house-a', cell: { i: -1, j: 0 }, level: 1 },
      { houseId: 'house-c', cell: { i: 1, j: -1 }, level: 1 },
      { houseId: 'house-b', cell: { i: -1, j: -1 }, level: 1 },
    ],
  },
  // Not visible to the current user: they are not in this group.
  {
    id: 'mia-and-leo',
    name: 'Mia and Leo',
    group: { id: 'group-mia-leo', members: [MIA, LEO] },
    houses: [{ houseId: 'house-c', cell: { i: 0, j: 0 }, level: 2 }],
  },
]

const ONLINE = new Set([ME.id, MIA.id])

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function mockFetchIslands(): Promise<IslandsResponse> {
  await delay(150)
  // Stand-in for the backend's access check.
  const islands = ISLANDS.filter((island) => island.group.members.some((member) => member.id === ME.id))
  return structuredClone({ me: ME, islands })
}

/** Reports the current status of each user, then flips Mia now and then so the UI can be seen reacting. */
export function mockSubscribePresence(userIds: string[], onPresence: (presence: Presence) => void): () => void {
  for (const userId of userIds) {
    onPresence({ userId, status: ONLINE.has(userId) ? 'online' : 'offline' })
  }
  const timer = window.setInterval(() => {
    if (!userIds.includes(MIA.id)) return
    if (ONLINE.has(MIA.id)) ONLINE.delete(MIA.id)
    else ONLINE.add(MIA.id)
    onPresence({ userId: MIA.id, status: ONLINE.has(MIA.id) ? 'online' : 'offline' })
  }, 20000)
  return () => window.clearInterval(timer)
}
