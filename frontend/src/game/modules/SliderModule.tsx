import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ModuleProps } from './types'

export default function SliderModule({ primitive, value, onChange, disabled }: ModuleProps<'sequence'>) {
  const blocks = useRef<(HTMLDivElement | null)[]>([])
  const [dragging, setDragging] = useState<number | null>(null)

  function moveTo(item: number, to: number) {
    const from = value.indexOf(item)
    if (from === to || to < 0 || to >= value.length) return
    const next = [...value]
    next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  function startDrag(e: PointerEvent<HTMLDivElement>, item: number) {
    if (disabled) return
    // Capture on the rail: the block itself moves in the DOM while dragging.
    e.currentTarget.parentElement?.setPointerCapture(e.pointerId)
    setDragging(item)
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging === null) return
    const from = value.indexOf(dragging)
    blocks.current.forEach((el, pos) => {
      if (!el || pos === from) return
      const r = el.getBoundingClientRect()
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!inside) return
      // Only swap once the pointer passes the block's middle, so blocks of different widths don't flip back.
      const cx = r.left + r.width / 2
      if ((pos > from && e.clientX < cx) || (pos < from && e.clientX > cx)) return
      moveTo(dragging, pos)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, item: number) {
    if (disabled) return
    const pos = value.indexOf(item)
    if (e.key === 'ArrowLeft') moveTo(item, pos - 1)
    else if (e.key === 'ArrowRight') moveTo(item, pos + 1)
    else return
    e.preventDefault()
  }

  return (
    <div>
      <p className="mg-hint">Zieh die Blöcke in die richtige Reihenfolge (links → rechts).</p>
      <div
        className={`mod-rail ${dragging !== null ? 'is-dragging' : ''}`}
        role="listbox"
        aria-label="Reihenfolge"
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        {value.map((item, pos) => (
          <div
            key={item}
            ref={(el) => {
              blocks.current[pos] = el
            }}
            className={`mod-block ${dragging === item ? 'is-dragged' : ''} ${disabled ? 'is-disabled' : ''}`}
            onPointerDown={(e) => startDrag(e, item)}
            onKeyDown={(e) => onKeyDown(e, item)}
            tabIndex={disabled ? -1 : 0}
            role="option"
            aria-selected={dragging === item}
            aria-label={`${primitive.items[item]}, Position ${pos + 1}. Pfeiltasten zum Verschieben.`}
          >
            <span className="mod-block-grip" aria-hidden>⠿</span>
            <span className="mod-block-pos">{pos + 1}</span>
            {primitive.items[item]}
          </div>
        ))}
      </div>
    </div>
  )
}
