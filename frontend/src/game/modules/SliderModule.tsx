import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ModuleProps } from './types'

type Drag = {
  item: number
  /** Where the block would land among the other blocks. */
  insertAt: number
  /** Pointer position and grab offset, in viewport pixels. */
  x: number
  y: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export default function SliderModule({ primitive, value, onChange, disabled }: ModuleProps<'sequence'>) {
  const blockRefs = useRef(new Map<number, HTMLDivElement>())
  const [drag, setDrag] = useState<Drag | null>(null)

  function moveTo(item: number, to: number) {
    const rest = value.filter((v) => v !== item)
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, item)
    onChange(rest)
  }

  function startDrag(e: PointerEvent<HTMLDivElement>, item: number) {
    if (disabled) return
    // Prevents text selection and native drag while moving.
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    // Capture on the rail: the dragged block is taken out of the flow.
    e.currentTarget.parentElement?.setPointerCapture(e.pointerId)
    setDrag({
      item,
      insertAt: value.indexOf(item),
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    })
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag) return
    const others = value.filter((v) => v !== drag.item)
    // Reading order: before a block if above its row, or in its row left of its middle.
    let insertAt = others.length
    for (let k = 0; k < others.length; k++) {
      const r = blockRefs.current.get(others[k])?.getBoundingClientRect()
      if (!r) continue
      if (e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)) {
        insertAt = k
        break
      }
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY, insertAt })
  }

  function endDrag() {
    if (!drag) return
    moveTo(drag.item, drag.insertAt)
    setDrag(null)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>, item: number) {
    if (disabled) return
    const pos = value.indexOf(item)
    if (e.key === 'ArrowLeft') moveTo(item, pos - 1)
    else if (e.key === 'ArrowRight') moveTo(item, pos + 1)
    else return
    e.preventDefault()
  }

  const others = drag ? value.filter((v) => v !== drag.item) : value

  function block(item: number, pos: number) {
    return (
      <div
        key={item}
        ref={(el) => {
          if (el) blockRefs.current.set(item, el)
          else blockRefs.current.delete(item)
        }}
        className={`mod-block ${disabled ? 'is-disabled' : ''}`}
        onPointerDown={(e) => startDrag(e, item)}
        onKeyDown={(e) => onKeyDown(e, item)}
        tabIndex={disabled ? -1 : 0}
        role="option"
        aria-selected={false}
        aria-label={`${primitive.items[item]}, Position ${pos + 1}. Pfeiltasten zum Verschieben.`}
      >
        <span className="mod-block-grip" aria-hidden>⠿</span>
        <span className="mod-block-pos">{pos + 1}</span>
        {primitive.items[item]}
      </div>
    )
  }

  return (
    <div>
      <p className="mg-hint">Zieh die Blöcke in die richtige Reihenfolge (links → rechts).</p>
      <div
        className={`mod-rail ${drag ? 'is-dragging' : ''}`}
        role="listbox"
        aria-label="Reihenfolge"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={() => setDrag(null)}
      >
        {others.map((item, k) => {
          const pos = drag && k >= drag.insertAt ? k + 1 : k
          return [
            drag && k === drag.insertAt && (
              <div key="gap" className="mod-block-gap" style={{ width: drag.width, height: drag.height }} />
            ),
            block(item, pos),
          ]
        })}
        {drag && drag.insertAt === others.length && (
          <div key="gap" className="mod-block-gap" style={{ width: drag.width, height: drag.height }} />
        )}
      </div>

      {drag && (
        <div
          className="mod-block is-floating"
          style={{ left: drag.x - drag.offsetX, top: drag.y - drag.offsetY, width: drag.width }}
          aria-hidden
        >
          <span className="mod-block-grip">⠿</span>
          <span className="mod-block-pos">{drag.insertAt + 1}</span>
          {primitive.items[drag.item]}
        </div>
      )}
    </div>
  )
}
