import pg from 'pg'
import { BACKEND_URL, DATABASE_URL } from './env'

// Fake content for one test: two users on one island with one house (topic) whose skill tree has
// three storeys. Users and island go through the real API; topics, skills and tasks are what Akasha
// would write, so they go straight into Postgres.

/** The right answer of every seeded question; the expert finds its symbol by this text. */
export const RIGHT = 'RICHTIG'
const WRONG = 'falsch'

export const SKILLS = ['Grundlagen', 'Aufbau', 'Meisterschaft']
/** Fewer tasks than the ground floor bomb has modules: the backend fills up with repeats. */
const TASKS_PER_SKILL = 3

export type Seed = {
  alex: { id: string; name: string }
  mia: { id: string; name: string }
  islandId: string
  topicId: string
  skillIds: string[]
}

async function api<T>(path: string, user: string | null, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

export async function seed(): Promise<Seed> {
  const tag = Math.random().toString(36).slice(2, 8)
  const alex = { name: `Alex ${tag}`, id: '' }
  const mia = { name: `Mia ${tag}`, id: '' }
  alex.id = (await api<{ id: string }>('/api/users/create', null, { name: alex.name })).id
  mia.id = (await api<{ id: string }>('/api/users/create', null, { name: mia.name })).id
  const { id: islandId } = await api<{ id: string }>('/api/islands/create', alex.id, {
    name: `E2E ${tag}`,
    partner_id: mia.id,
  })

  const client = new pg.Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    const topic = await client.query<{ id: string }>(
      "INSERT INTO topics (island_id, language, name) VALUES ($1, 'german', $2) RETURNING id",
      [islandId, 'Bombenkunde'],
    )
    const topicId = topic.rows[0].id
    const document = await client.query<{ id: string }>(
      "INSERT INTO documents (bucket, object_key, island_id) VALUES ('e2e', $1, $2) RETURNING id",
      [`e2e/${tag}`, islandId],
    )
    const skillIds: string[] = []
    for (const [position, name] of SKILLS.entries()) {
      const skill = await client.query<{ id: string }>(
        'INSERT INTO skills (topic_id, name, position) VALUES ($1, $2, $3) RETURNING id',
        [topicId, name, position],
      )
      skillIds.push(skill.rows[0].id)
      for (let index = 0; index < TASKS_PER_SKILL; index++) {
        // the right answer sits first or second, so the defuser cannot just always pick one slot
        const options = index % 2 === 0 ? [RIGHT, WRONG] : [WRONG, RIGHT]
        const task = await client.query<{ id: string }>(
          `INSERT INTO tasks (document_id, skill_id, question_type, content, solution)
           VALUES ($1, $2, 'single_choice', $3, $4) RETURNING id`,
          [
            document.rows[0].id,
            skill.rows[0].id,
            { prompt: `${name} ${index + 1}: Welche Antwort stimmt?`, options },
            { correct_answer: options.indexOf(RIGHT) },
          ],
        )
        await client.query('INSERT INTO instructions (task_id, instruction) VALUES ($1, $2)', [
          task.rows[0].id,
          { hint: `Die richtige Antwort heißt ${RIGHT}.` },
        ])
      }
    }
    return { alex, mia, islandId, topicId, skillIds }
  } finally {
    await client.end()
  }
}
