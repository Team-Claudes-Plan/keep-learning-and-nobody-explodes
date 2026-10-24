import { GLYPHS } from './glyphs'

/** A glyph for the manual (HTML), drawn exactly like on the bomb. */
export default function GlyphIcon({ index, size = 40 }: { index: number; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="glyph-icon">
      <path
        d={GLYPHS[index]}
        fill="none"
        stroke="currentColor"
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
