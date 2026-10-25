import { GLYPHS } from './glyphs'

/** A glyph for the manual (HTML), drawn exactly like on the bomb. */
export default function GlyphIcon({ index, size = 40, stroke = 7 }: { index: number; size?: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="glyph-icon">
      <path
        d={GLYPHS[index]}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
