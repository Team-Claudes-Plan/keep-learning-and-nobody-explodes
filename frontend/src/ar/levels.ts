import { MODULES } from '../game/modules'
import type { ModuleDef } from '../game/modules/types'

/**
 * The AR demo shows the bomb as a physical object. Every level is a preset loadout: all eleven
 * slots are filled, so the bomb looks complete, and across the six levels every module appears.
 * The last level puts all eleven module types on one bomb.
 */
export type ArLevel = {
  id: string
  /** 1-6 for the learning levels, null for the "everything" level. */
  number: number | null
  label: string
  subtitle: string
  description: string
  accent: string
  /** Distinct module types used by this level, in the order they are placed. */
  modules: string[]
  /** Exactly eleven module ids, one per slot. */
  slots: string[]
}

const SLOTS = 11

/** Repeats the module types until every slot is filled. */
function fill(modules: string[]): string[] {
  return Array.from({ length: SLOTS }, (_, index) => modules[index % modules.length])
}

type LevelSeed = Omit<ArLevel, 'slots'> & { modules: string[]; slots?: string[] }

function level({ slots, ...seed }: LevelSeed): ArLevel {
  return { ...seed, slots: slots ?? fill(seed.modules) }
}

export const AR_LEVELS: ArLevel[] = [
  level({
    id: 'foundations',
    number: 1,
    label: 'Foundations',
    subtitle: 'Kabel & Sicherungen',
    description: 'Die Grundlagen: Kabel, Sicherungen und die erste Mechanik der Bombe.',
    accent: '#4f8cff',
    modules: ['wires', 'fuses'],
  }),
  level({
    id: 'patterns',
    number: 2,
    label: 'Patterns',
    subtitle: 'Drehen, schalten, verbinden',
    description: 'Muster erkennen: Drehschalter, Kippschalter und gesteckte Kabel.',
    accent: '#ffb347',
    modules: ['rotary', 'switches', 'cables'],
  }),
  level({
    id: 'structures',
    number: 3,
    label: 'Structures',
    subtitle: 'Reihenfolgen & Sortierung',
    description: 'Struktur in die Aufgabe bringen: Knöpfe, Schieber und die Sortier-Weiche.',
    accent: '#4fd18b',
    modules: ['buttons', 'slider', 'sorter', 'switches'],
  }),
  level({
    id: 'networks',
    number: 4,
    label: 'Networks',
    subtitle: 'Terminal & Radar',
    description: 'Netzwerke verbinden: Terminal, Kabel, Radar und feine Drähte.',
    accent: '#8f6bff',
    modules: ['terminal', 'cables', 'radar', 'wires'],
  }),
  level({
    id: 'systems',
    number: 5,
    label: 'Systems',
    subtitle: 'Das volle System',
    description: 'Viele Systeme greifen ineinander: Schloss, Terminal, Drehschalter, Sicherungen.',
    accent: '#ff5f6d',
    modules: ['lock', 'terminal', 'rotary', 'fuses', 'switches', 'sorter'],
  }),
  level({
    id: 'analysis',
    number: 6,
    label: 'Analysis',
    subtitle: 'Alles analysieren',
    description: 'Die Königsdisziplin: sieben Modularten, die zusammen analysiert werden wollen.',
    accent: '#4fd1d1',
    modules: ['radar', 'slider', 'sorter', 'lock', 'buttons', 'cables', 'terminal'],
  }),
  level({
    id: 'all-modules',
    number: null,
    label: 'Alle 11 Module',
    subtitle: 'Maximale Variation',
    description: 'Jede der elf Modularten genau einmal – die Bombe in ihrer vollsten Form.',
    accent: '#ff8a1f',
    modules: MODULES.map((module) => module.id),
    // Put the most distinctive modules on the faces you see first (front, upper front).
    slots: ['radar', 'terminal', 'buttons', 'lock', 'slider', 'sorter', 'cables', 'rotary', 'switches', 'fuses', 'wires'],
  }),
]

const MODULES_BY_ID = new Map(MODULES.map((module) => [module.id, module]))

export function getModuleInfo(id: string): ModuleDef | undefined {
  return MODULES_BY_ID.get(id)
}

export function levelByIndex(index: number): ArLevel {
  return AR_LEVELS[Math.max(0, Math.min(AR_LEVELS.length - 1, index))]
}
