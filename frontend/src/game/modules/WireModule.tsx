import { useRef, useState, type MouseEvent } from 'react'
import type { ModuleProps } from './types'

const WIRE_COLORS = ['#e5484d', '#3e63dd', '#eab308', '#30a46c', '#1f2937', '#8e4ec6', '#f76b15', '#12a594']

// The wire is a cubic Bézier in a 300×40 box, stretched horizontally (strokes don't scale).
type Pt = [number, number]
type Curve = [Pt, Pt, Pt, Pt]
const WIRE: Curve = [[0, 20], [80, 32], [220, 8], [300, 20]]
const VIEW_W = 300
const GAP = 22
const DROOP = 12

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

/** De Casteljau split of a cubic at t. */
function split([p0, p1, p2, p3]: Curve, t: number): [Curve, Curve] {
  const a = lerp(p0, p1, t)
  const b = lerp(p1, p2, t)
  const d = lerp(p2, p3, t)
  const e = lerp(a, b, t)
  const f = lerp(b, d, t)
  const m = lerp(e, f, t)
  return [[p0, a, e, m], [m, f, d, p3]]
}

/** Parameter t where the wire reaches x (x grows monotonically along this wire). */
function tAtX(x: number) {
  let lo = 0
  let hi = 1
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2
    if (split(WIRE, mid)[0][3][0] < x) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const toPath = ([a, b, c, d]: Curve) => `M${a[0]} ${a[1]} C ${b[0]} ${b[1]}, ${c[0]} ${c[1]}, ${d[0]} ${d[1]}`

/** Copper strands sticking out of a cut end, continuing the wire's direction. */
function strand(end: Pt, from: Pt) {
  const dx = end[0] - from[0]
  const dy = end[1] - from[1]
  const len = Math.hypot(dx, dy) || 1
  return `M${end[0]} ${end[1]} L${end[0] + (dx / len) * 5} ${end[1] + (dy / len) * 5}`
}

/** Both halves of the wire cut at x, drooping at the cut. */
function cutPaths(x: number) {
  const cx = Math.min(VIEW_W - 30, Math.max(30, x))
  const [left] = split(WIRE, tAtX(cx - GAP / 2))
  const [, right] = split(WIRE, tAtX(cx + GAP / 2))
  left[3] = [left[3][0], left[3][1] + DROOP]
  left[2] = [left[2][0], left[2][1] + DROOP / 2]
  right[0] = [right[0][0], right[0][1] + DROOP]
  right[1] = [right[1][0], right[1][1] + DROOP / 2]
  return {
    left: toPath(left),
    right: toPath(right),
    copperLeft: strand(left[3], left[2]),
    copperRight: strand(right[0], right[1]),
  }
}

function Cable({ d, color }: { d: string; color: string }) {
  return (
    <g>
      <path d={d} stroke="rgba(0, 0, 0, 0.35)" strokeWidth={11} vectorEffect="non-scaling-stroke" />
      <path d={d} stroke={color} strokeWidth={8} vectorEffect="non-scaling-stroke" />
      <path d={d} stroke="rgba(255, 255, 255, 0.45)" strokeWidth={2} vectorEffect="non-scaling-stroke" transform="translate(0 -2)" />
    </g>
  )
}

/** Wire cutters, same drawing as the cursor; tips point to the top-left corner. */
function Pliers() {
  return (
    <svg className="pliers is-snapping" viewBox="0 0 32 32" aria-hidden>
      <g transform="rotate(-45 16 16)">
        <path className="pliers-handle" d="M15 13.5 L12.5 27" />
        <path className="pliers-handle" d="M17 13.5 L19.5 27" />
        <g className="pliers-jaw is-left">
          <path d="M14.6 12.5 C 13.6 9, 14.2 5.5, 16 3 L16 12.5 Z" />
        </g>
        <g className="pliers-jaw is-right">
          <path d="M17.4 12.5 C 18.4 9, 17.8 5.5, 16 3 L16 12.5 Z" />
        </g>
        <circle cx={16} cy={12.5} r={2} className="pliers-pivot" />
      </g>
    </svg>
  )
}

export default function WireModule({ primitive, value, onChange, disabled }: ModuleProps<'pick'>) {
  /** Where each wire was cut, in wire box units. */
  const [cutAt, setCutAt] = useState<Record<number, number>>({})
  const [snap, setSnap] = useState<{ wire: number; x: number; y: number; key: number } | null>(null)
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapCount = useRef(0)

  function cut(e: MouseEvent<HTMLButtonElement>, i: number) {
    // A cut wire stays cut.
    if (disabled || value.includes(i)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    setCutAt((prev) => ({ ...prev, [i]: (x / rect.width) * VIEW_W }))
    setSnap({ wire: i, x, y: e.clientY - rect.top, key: ++snapCount.current })
    if (snapTimer.current) clearTimeout(snapTimer.current)
    snapTimer.current = setTimeout(() => setSnap(null), 650)
    onChange([...value, i])
  }

  return (
    <div>
      <p className="mg-hint">
        {primitive.mode === 'one'
          ? 'Schneide das richtige Kabel durch.'
          : 'Schneide die Kabel der falschen Antworten durch. Durch ist durch!'}
      </p>
      <div className="mod-wires">
        {primitive.items.map((label, i) => {
          const isCut = value.includes(i)
          const color = WIRE_COLORS[i % WIRE_COLORS.length]
          const paths = isCut ? cutPaths(cutAt[i] ?? VIEW_W / 2) : null
          const snapping = snap?.wire === i
          return (
            <div key={i} className={`mod-wire ${isCut ? 'is-cut' : ''}`}>
              <span className="mod-wire-label">{label}</span>
              <span className="mod-wire-terminal" />
              <button
                className={`mod-wire-cable ${snapping ? 'is-snapping' : ''}`}
                onClick={(e) => cut(e, i)}
                disabled={disabled}
                aria-disabled={isCut}
                aria-label={isCut ? `Durchgeschnitten: ${label}` : `Kabel durchschneiden: ${label}`}
              >
                <svg viewBox={`0 0 ${VIEW_W} 40`} preserveAspectRatio="none" aria-hidden>
                  <g fill="none" strokeLinecap="round">
                    {paths ? (
                      <>
                        <Cable d={paths.left} color={color} />
                        <Cable d={paths.right} color={color} />
                        <path className="mod-wire-copper" d={paths.copperLeft} vectorEffect="non-scaling-stroke" />
                        <path className="mod-wire-copper" d={paths.copperRight} vectorEffect="non-scaling-stroke" />
                      </>
                    ) : (
                      <Cable d={toPath(WIRE)} color={color} />
                    )}
                  </g>
                </svg>
                {snapping && (
                  <span key={snap.key} className="mod-wire-snap" style={{ left: snap.x, top: snap.y }}>
                    <Pliers />
                  </span>
                )}
              </button>
              <span className="mod-wire-terminal" />
            </div>
          )
        })}
      </div>
    </div>
  )
}
