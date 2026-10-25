// Abstract symbols that stand in for answers on the bomb. The defuser only sees the symbol, the
// expert's manual says what it stands for, so the two have to describe the shapes to each other.
// Each glyph is an SVG path in a 100×100 box, drawn as a line (no fill), the same on the bomb (3D,
// see Label3D.tsx) and in the manual (GlyphIcon.tsx).
// In a session the backend deals them out per game, by index into this list, and never uses one
// twice (backend/src/session/glyphs.rs): keep GLYPH_COUNT there equal to the length of GLYPHS.

export const GLYPHS: string[] = [
  // ring with a dot in the middle
  'M50 15a35 35 0 1 0 0.01 0 M50 44a6 6 0 1 0 0.01 0',
  // triangle with a bar across
  'M50 14 L86 82 L14 82 Z M31 62 L69 62',
  // trident
  'M50 88 L50 22 M24 22 Q24 56 50 56 Q76 56 76 22',
  // diamond with a cross inside
  'M50 10 L90 50 L50 90 L10 50 Z M50 32 L50 68 M32 50 L68 50',
  // lightning bolt
  'M60 8 L30 54 L52 54 L40 92 L74 40 L52 40 Z',
  // omega
  'M18 84 L38 84 Q18 70 20 48 Q24 16 50 16 Q76 16 80 48 Q82 70 62 84 L82 84',
  // five-pointed star
  'M50 10 L61 38 L91 38 L67 56 L76 86 L50 68 L24 86 L33 56 L9 38 L39 38 Z',
  // hourglass
  'M22 14 L78 14 L22 86 L78 86 Z',
  // crescent moon
  'M64 14 A36 36 0 1 0 64 86 A28 28 0 1 1 64 14 Z',
  // eye
  'M8 50 Q50 10 92 50 Q50 90 8 50 Z M50 39a11 11 0 1 0 0.01 0',
  // square with a loop on every corner
  'M34 34 H66 V66 H34 Z M34 34a10 10 0 1 1 -0.01 0.01 M66 34a10 10 0 1 1 0.01 0.01 M66 66a10 10 0 1 1 0.01 -0.01 M34 66a10 10 0 1 1 -0.01 -0.01',
  // zigzag
  'M8 30 L29 74 L50 34 L71 74 L92 30',
  // anchor
  'M50 14 L50 86 M32 30 L68 30 M18 58 Q50 100 82 58',
  // hexagon with a dot
  'M50 10 L85 30 L85 70 L50 90 L15 70 L15 30 Z M50 44a6 6 0 1 0 0.01 0',
  // two chevrons facing apart
  'M40 14 L14 50 L40 86 M60 14 L86 50 L60 86',
  // H with a ring in the middle
  'M24 14 L24 86 M76 14 L76 86 M24 50 L38 50 M62 50 L76 50 M50 38a12 12 0 1 0 0.01 0',
  // two waves
  'M8 36 Q29 18 50 36 T92 36 M8 66 Q29 48 50 66 T92 66',
  // arrow with a forked tail
  'M50 10 L50 90 M30 30 L50 10 L70 30 M30 90 L50 72 L70 90',
  // crossed-out circle
  'M50 14a36 36 0 1 0 0.01 0 M25 25 L75 75 M75 25 L25 75',
  // gate (pi-like)
  'M14 26 L86 26 M34 26 L34 86 M66 26 Q66 82 88 80',
  // infinity
  'M50 50 C36 26 10 30 10 50 C10 70 36 74 50 50 C64 26 90 30 90 50 C90 70 64 74 50 50 Z',
  // spiral
  'M50 50 m4 0 a4 4 0 1 0 -8 0 a10 10 0 1 0 20 0 a16 16 0 1 0 -32 0 a22 22 0 1 0 44 0 a28 28 0 1 0 -56 0',
]

/** Marks a label as a glyph: invisible prefix + glyph number, so labels stay plain strings. */
const GLYPH_TAG = '⁣glyph:'

export function glyphLabel(index: number) {
  return `${GLYPH_TAG}${index}`
}

/** The glyph a label stands for, or null for an ordinary text label. */
export function glyphOf(label: string): number | null {
  if (!label.startsWith(GLYPH_TAG)) return null
  const index = Number(label.slice(GLYPH_TAG.length))
  return Number.isInteger(index) && index >= 0 && index < GLYPHS.length ? index : null
}
