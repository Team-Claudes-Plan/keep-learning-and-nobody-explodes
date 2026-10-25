import type { Island, IslandHouse, IslandsResponse, Presence, UploadResponse, UserSummary } from './types'

// An in-memory stand-in for the backend's islands, following the same rules (backend/src/api/islands.rs):
// topics live on the original island and are shared with its forks, each topic has an ordered skill
// tree, a user passed the first n storeys of a topic, and a house is built as far as every member
// passed it, plus the next storey to play.

const ME: UserSummary = { id: 'user-me', name: 'Alex' }
const MIA: UserSummary = { id: 'user-mia', name: 'Mia' }
const LEO: UserSummary = { id: 'user-leo', name: 'Leo' }

const USERS = new Map([ME, MIA, LEO].map((user) => [user.id, user]))

type MockIsland = { id: string; name: string; originId: string | null; members: string[] }
type MockTopic = { id: string; islandId: string; name: string; skills: string[] }

const ISLANDS: MockIsland[] = [
  { id: 'solo', name: 'Semester 1', originId: null, members: [ME.id] },
  { id: 'with-mia', name: 'Semester 2', originId: null, members: [ME.id, MIA.id] },
  // Alex learns Semester 2 with Leo as well: a fork shares the houses of the original.
  { id: 'with-leo', name: 'Semester 2', originId: 'with-mia', members: [ME.id, LEO.id] },
  // Not visible to the current user: they are not a member.
  { id: 'mia-and-leo', name: 'Theatre play', originId: null, members: [MIA.id, LEO.id] },
]

const TOPICS: MockTopic[] = [
  { id: 'topic-algebra', islandId: 'solo', name: 'Algebra', skills: ['Terms', 'Equations', 'Inequalities'] },
  { id: 'topic-maps', islandId: 'solo', name: 'Maps and projections', skills: ['Scale', 'Coordinates', 'Projections'] },
  { id: 'topic-cells', islandId: 'solo', name: 'Cell structure', skills: ['Membrane', 'Organelles', 'Nucleus', 'Division'] },
  {
    id: 'topic-calculus',
    islandId: 'with-mia',
    name: 'Calculus',
    skills: ['Limits', 'Derivatives', 'Chain rule', 'Integrals', 'Series', 'Differential equations'],
  },
  { id: 'topic-sensors', islandId: 'with-mia', name: 'Sensors', skills: ['Signals', 'Calibration', 'Filtering'] },
  { id: 'topic-plants', islandId: 'with-mia', name: 'Photosynthesis', skills: ['Light reaction', 'Calvin cycle'] },
  { id: 'topic-lines', islandId: 'mia-and-leo', name: 'Act one', skills: ['Scene one'] },
]

/** Storeys passed in a row per user and topic; missing entries are 0. */
const KNOWLEDGE: Record<string, Record<string, number>> = {
  [ME.id]: { 'topic-algebra': 1, 'topic-maps': 2, 'topic-cells': 3, 'topic-calculus': 3, 'topic-sensors': 2 },
  [MIA.id]: { 'topic-calculus': 4, 'topic-sensors': 1, 'topic-plants': 2 },
  [LEO.id]: { 'topic-calculus': 2, 'topic-plants': 3 },
}

const ONLINE = new Set([ME.id, MIA.id])

let nextId = 1

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const root = (island: MockIsland) => island.originId ?? island.id

function memberIsland(islandId: string): MockIsland {
  const island = ISLANDS.find((entry) => entry.id === islandId)
  // The backend answers 404 for islands of others, too.
  if (!island?.members.includes(ME.id)) throw new Error(`island ${islandId} not found`)
  return island
}

function requireUser(userId: string): void {
  if (!USERS.has(userId)) throw new Error(`user ${userId} does not exist`)
  if (userId === ME.id) throw new Error('the partner must be someone else')
}

function house(topic: MockTopic, members: string[]): IslandHouse {
  const passed = Math.min(...members.map((member) => KNOWLEDGE[member]?.[topic.id] ?? 0))
  const level = Math.min(passed, topic.skills.length)
  const skills = topic.skills.map((name, position) => ({
    skill_id: `${topic.id}-skill-${position}`,
    name,
    position,
    tasks: 6,
    passed: position < level,
    unlocked: position <= level,
  }))
  return { topic_id: topic.id, name: topic.name, level, unlocked: skills.length > 0, skills }
}

function toIsland(island: MockIsland): Island {
  const members = island.members.map((id) => USERS.get(id) ?? { id, name: id })
  return {
    id: island.id,
    name: island.name,
    origin_id: island.originId,
    group: { id: island.id, members: members as Island['group']['members'] },
    houses: TOPICS.filter((topic) => topic.islandId === root(island)).map((topic) => house(topic, island.members)),
    building: 0,
  }
}

export async function mockFetchIslands(): Promise<IslandsResponse> {
  await delay(150)
  const islands = ISLANDS.filter((island) => island.members.includes(ME.id)).map(toIsland)
  return structuredClone({ me: ME, islands })
}

export async function mockCreateIsland(name: string, partnerId?: string): Promise<{ id: string }> {
  await delay(100)
  if (partnerId) requireUser(partnerId)
  const id = `island-${nextId++}`
  ISLANDS.push({ id, name, originId: null, members: partnerId ? [ME.id, partnerId] : [ME.id] })
  return { id }
}

export async function mockAddIslandMember(islandId: string, userId: string): Promise<void> {
  await delay(100)
  const island = memberIsland(islandId)
  requireUser(userId)
  if (island.members.length >= 2) throw new Error('island already has two members; fork it to learn with someone else')
  island.members.push(userId)
}

export async function mockForkIsland(islandId: string, partnerId: string, name?: string): Promise<{ id: string }> {
  await delay(100)
  const island = memberIsland(islandId)
  requireUser(partnerId)
  const id = `island-${nextId++}`
  ISLANDS.push({ id, name: name ?? island.name, originId: root(island), members: [ME.id, partnerId] })
  return { id }
}

/** Pretends Akasha found one topic with three skills per uploaded file. */
export async function mockUploadDocuments(islandId: string, files: File[]): Promise<UploadResponse> {
  await delay(300)
  const owner = root(memberIsland(islandId))
  for (const file of files) {
    const name = file.name.replace(/\.[^.]*$/, '') || file.name
    if (!TOPICS.some((topic) => topic.islandId === owner && topic.name.toLowerCase() === name.toLowerCase())) {
      TOPICS.push({ id: `topic-${nextId++}`, islandId: owner, name, skills: ['Basics', 'Practice', 'Mastery'] })
    }
  }
  return {
    island_id: owner,
    objects: files.map((file) => ({
      key: `uploads/${owner}/mock/${file.name}`,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      size: file.size,
    })),
    failures: [],
  }
}

/** Whether a mock user is online right now. */
export function mockIsOnline(userId: string): boolean {
  return ONLINE.has(userId)
}

/** The mock users, for the mock invite channel. */
export function mockUser(userId: string): UserSummary | undefined {
  return USERS.get(userId)
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
