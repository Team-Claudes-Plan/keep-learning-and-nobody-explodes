import type { RefObject } from 'react'

export const TITLE_LINES = ['KEEP LEARNING', 'AND NOBODY', 'EXPLODES'] as const

export type Burst = { x: number; y: number; z: number; scale: number }

/** Shared, mutable effect state: anyone can queue bursts, everyone reads shake. */
export type TitleFx = { shake: number; bursts: Burst[] }

export type TitleFxRef = RefObject<TitleFx>

export function createTitleFx(): TitleFx {
  return { shake: 0, bursts: [] }
}
