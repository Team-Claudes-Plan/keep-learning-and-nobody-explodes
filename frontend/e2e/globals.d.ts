// The hook the defuser's page exposes in VITE_E2E builds (src/game/e2eHook.ts).
export {}

declare global {
  interface Window {
    __bomb?: {
      parts: { position: number; glyphs: number[] }[]
      chooseGlyph(position: number, glyph: number): boolean
    }
  }
}
