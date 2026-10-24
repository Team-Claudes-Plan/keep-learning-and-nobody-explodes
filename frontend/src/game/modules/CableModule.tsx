import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { ModuleProps } from './types'

const CABLE_COLORS = ['#e5484d', '#3e63dd', '#eab308', '#30a46c', '#8e4ec6', '#f76b15', '#12a594', '#1f2937']

type Pt = { x: number; y: number }
type Geometry = { width: number; height: number; plugs: Pt[]; sockets: Pt[] }

function center(el: Element | null, origin: DOMRect): Pt {
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2 - origin.left, y: r.top + r.height / 2 - origin.top }
}

function wirePath(a: Pt, b: Pt) {
  const bend = Math.max(40, Math.abs(b.x - a.x) / 2)
  return `M${a.x} ${a.y} C${a.x + bend} ${a.y} ${b.x - bend} ${b.y} ${b.x} ${b.y}`
}

export default function CableModule({ primitive, value, onChange, disabled }: ModuleProps<'assign'>) {
  const board = useRef<HTMLDivElement>(null)
  const plugRefs = useRef<(HTMLSpanElement | null)[]>([])
  const socketRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [geo, setGeo] = useState<Geometry | null>(null)
  /** Plug being dragged and the pointer position relative to the board. */
  const [drag, setDrag] = useState<{ item: number; pos: Pt } | null>(null)
  const [hoverSocket, setHoverSocket] = useState<number | null>(null)

  // Plug/socket positions only change with the layout, so measure on resize.
  useEffect(() => {
    const el = board.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const origin = el.getBoundingClientRect()
      setGeo({
        width: origin.width,
        height: origin.height,
        plugs: plugRefs.current.map((p) => center(p, origin)),
        sockets: socketRefs.current.map((s) => center(s, origin)),
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  function pointerPos(e: PointerEvent): Pt {
    const origin = board.current!.getBoundingClientRect()
    return { x: e.clientX - origin.left, y: e.clientY - origin.top }
  }

  function socketAt(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-socket]')
    return el ? Number(el.getAttribute('data-socket')) : null
  }

  function startDrag(e: PointerEvent<HTMLButtonElement>, item: number) {
    if (disabled) return
    e.preventDefault()
    board.current?.setPointerCapture(e.pointerId)
    // Grabbing a connected plug pulls its cable out.
    if (value[item] !== null) onChange(value.map((v, i) => (i === item ? null : v)))
    setDrag({ item, pos: pointerPos(e) })
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    setDrag({ item: drag.item, pos: pointerPos(e) })
    setHoverSocket(socketAt(e))
  }

  function onUp(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const target = socketAt(e)
    if (target !== null) {
      onChange(
        value.map((v, i) => {
          if (i === drag.item) return target
          // Matching: a socket takes only one cable.
          if (primitive.unique && v === target) return null
          return v
        }),
      )
    }
    setDrag(null)
    setHoverSocket(null)
  }

  return (
    <div>
      <p className="mg-hint">Zieh die Kabel von links in die passende Buchse rechts.</p>
      <div
        ref={board}
        className={`mod-cables ${drag ? 'is-dragging' : ''}`}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="mod-cables-col">
          {primitive.items.map((label, i) => (
            <button
              key={i}
              className={`mod-cable-end is-left ${drag?.item === i ? 'is-active' : ''}`}
              onPointerDown={(e) => startDrag(e, i)}
              disabled={disabled}
            >
              <span className="mod-cable-text">{label}</span>
              <span
                ref={(el) => {
                  plugRefs.current[i] = el
                }}
                className="mod-cable-plug"
                style={{ background: CABLE_COLORS[i % CABLE_COLORS.length] }}
              />
            </button>
          ))}
        </div>
        <div />
        <div className="mod-cables-col">
          {primitive.targets.map((label, j) => (
            <div key={j} className={`mod-cable-end is-right ${hoverSocket === j ? 'is-target' : ''}`} data-socket={j}>
              <span
                ref={(el) => {
                  socketRefs.current[j] = el
                }}
                className="mod-cable-plug is-socket"
              />
              <span className="mod-cable-text">{label}</span>
            </div>
          ))}
        </div>

        {geo && (
          <svg className="mod-cables-wires" width={geo.width} height={geo.height} aria-hidden>
            {value.map((target, i) =>
              target === null || !geo.sockets[target] ? null : (
                <path
                  key={i}
                  d={wirePath(geo.plugs[i], geo.sockets[target])}
                  stroke={CABLE_COLORS[i % CABLE_COLORS.length]}
                />
              ),
            )}
            {drag && (
              <path
                className="is-live"
                d={wirePath(geo.plugs[drag.item], drag.pos)}
                stroke={CABLE_COLORS[drag.item % CABLE_COLORS.length]}
              />
            )}
          </svg>
        )}
      </div>
    </div>
  )
}
