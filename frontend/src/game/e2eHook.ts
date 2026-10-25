import { useEffect } from 'react'
import type { SessionClient } from '../api/session'

// End-to-end tests cannot click into the three.js bomb. In builds with VITE_E2E=true the defuser's
// page exposes `window.__bomb`, which answers through the same socket a click on the bomb uses.
// Other builds drop this code.

export type E2eBomb = {
  turn: number
  /** The symbols on this turn's module, in answer order. */
  glyphs: number[]
  /** Answers a single choice module by picking the entry shown as `glyph`. */
  chooseGlyph(glyph: number): boolean
}

declare global {
  interface Window {
    __bomb?: E2eBomb
  }
}

export function useE2eBomb(client: SessionClient, turn: number | null, glyphs: number[] | undefined) {
  useEffect(() => {
    if (import.meta.env.VITE_E2E !== 'true' || turn === null || !glyphs) return
    window.__bomb = {
      turn,
      glyphs,
      chooseGlyph: (glyph) => {
        const index = glyphs.indexOf(glyph)
        return index >= 0 && client.submitAnswer(turn, { type: 'single_choice', answer: index })
      },
    }
    return () => {
      delete window.__bomb
    }
  }, [client, turn, glyphs])
}
