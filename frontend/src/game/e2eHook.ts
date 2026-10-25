import { useEffect } from 'react'
import type { SessionClient } from '../api/session'
import type { DefuserPart } from '../api/types'

// End-to-end tests cannot click into the three.js bomb. In builds with VITE_E2E=true the defuser's
// page exposes `window.__bomb`, which answers through the same socket a click on the bomb uses.
// Other builds drop this code.

export type E2eBomb = {
  /** Every module on the bomb: its part position and its symbols, in answer order. */
  parts: { position: number; glyphs: number[] }[]
  /** Answers the single choice module of `position` by picking the entry shown as `glyph`. */
  chooseGlyph(position: number, glyph: number): boolean
}

declare global {
  interface Window {
    __bomb?: E2eBomb
  }
}

export function useE2eBomb(client: SessionClient, parts: DefuserPart[] | null) {
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== 'true' || !parts) return
    window.__bomb = {
      parts: parts.map((part) => ({ position: part.position, glyphs: part.glyphs ?? [] })),
      chooseGlyph: (position, glyph) => {
        const index = parts.find((part) => part.position === position)?.glyphs?.indexOf(glyph) ?? -1
        return index >= 0 && client.submitAnswer(position, { type: 'single_choice', answer: index })
      },
    }
    return () => {
      delete window.__bomb
    }
  }, [client, parts])
}
