import type { InteriorMotif, StoreyConcept } from './interiorTypes'

export const STOREY_CONCEPTS: StoreyConcept[] = [
  {
    id: 'foundations',
    label: 'Foundations',
    design: { motif: 'tiles', floor: '#3a4668', accent: '#4f8cff' },
  },
  {
    id: 'patterns',
    label: 'Patterns',
    design: { motif: 'checker', floor: '#4f4130', accent: '#ffb347' },
  },
  {
    id: 'structures',
    label: 'Structures',
    design: { motif: 'grid', floor: '#355044', accent: '#4fd18b' },
  },
  {
    id: 'networks',
    label: 'Networks',
    design: { motif: 'dots', floor: '#413459', accent: '#8f6bff' },
  },
  {
    id: 'systems',
    label: 'Systems',
    design: { motif: 'planks', floor: '#4a3745', accent: '#ff5f6d' },
  },
  {
    id: 'analysis',
    label: 'Analysis',
    design: { motif: 'stripes', floor: '#2e4a56', accent: '#4fd1d1' },
  },
]

const CONCEPTS_BY_ID = new Map(STOREY_CONCEPTS.map((concept) => [concept.id, concept]))

const MOTIFS: InteriorMotif[] = ['tiles', 'planks', 'stripes', 'dots', 'grid', 'checker']

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function fallbackConcept(houseId: string, storeyId: string, index: number): StoreyConcept {
  const seed = hashString(`${houseId}:${storeyId}`)
  const base = STOREY_CONCEPTS[(seed + index) % STOREY_CONCEPTS.length]
  const motif = MOTIFS[(seed >>> 5) % MOTIFS.length]
  return { ...base, design: { ...base.design, motif } }
}

export function resolveConcept(
  houseId: string,
  storeyId: string,
  index: number,
  conceptId?: string,
): StoreyConcept {
  const explicit = conceptId ? CONCEPTS_BY_ID.get(conceptId) : undefined
  return explicit ?? fallbackConcept(houseId, storeyId, index)
}
