import type { WallAtlas } from './facadeTypes'

export type WallPartName = 'outer' | 'inner' | 'edge'
export type DecorKind = 'flowerPot' | 'lamp' | 'bench' | 'vine'

export type HouseParts = {
  outer: string
  inner: string
  edge: string
  door: string
  sign: string
}

export type Decor = {
  kind: DecorKind
  color: string
}

export const DEFAULT_WALL_ATLAS: WallAtlas = {
  outer: { x: 0, y: 0, w: 0.5, h: 1 },
  inner: { x: 0.5, y: 0, w: 0.5, h: 1 },
}

export const DECOR_KINDS: DecorKind[] = ['flowerPot', 'lamp', 'bench', 'vine']

export function shadeHex(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16)
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)))
  const r = clamp(((num >> 16) & 0xff) + amount * 255)
  const g = clamp(((num >> 8) & 0xff) + amount * 255)
  const b = clamp((num & 0xff) + amount * 255)
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function resolveParts(parts: Partial<HouseParts> | undefined, tint: string): HouseParts {
  return {
    outer: parts?.outer ?? tint,
    inner: parts?.inner ?? shadeHex(tint, 0.1),
    edge: parts?.edge ?? shadeHex(tint, -0.22),
    door: parts?.door ?? shadeHex(tint, 0.28),
    sign: parts?.sign ?? shadeHex(tint, 0.16),
  }
}

export function decorForHouse(facadeColor: string, index: number): Decor {
  return { kind: DECOR_KINDS[index % DECOR_KINDS.length], color: facadeColor }
}