import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import type { AssignPrimitive, PickPrimitive } from '../primitives'
import type { ModuleProps } from './types'

type Props = ModuleProps<'pick'> | ModuleProps<'assign'>

export default function RotaryModule(props: Props) {
  return props.primitive.kind === 'pick'
    ? <SingleDial {...(props as ModuleProps<'pick'>)} />
    : <DialPerItem {...(props as ModuleProps<'assign'>)} />
}

/** Positions spread symmetrically around the top, up to a 270° arc. */
function angleFor(position: number, count: number) {
  if (count <= 1) return 0
  const span = Math.min(270, (count - 1) * 60)
  return -span / 2 + (span / (count - 1)) * position
}

function nearestPosition(angle: number, count: number) {
  let best = 0
  for (let i = 1; i < count; i++) {
    if (Math.abs(angleFor(i, count) - angle) < Math.abs(angleFor(best, count) - angle)) best = i
  }
  return best
}

type DialProps = {
  labels: string[]
  position: number | null
  /** Called once the player lets go of the knob (or clicks a label). */
  onSelect: (position: number) => void
  disabled: boolean
  size: 'large' | 'small'
  ariaLabel: string
}

function Dial({ labels, position, onSelect, disabled, size, ariaLabel }: DialProps) {
  const count = labels.length
  const [dragPos, setDragPos] = useState<number | null>(null)
  const shown = dragPos ?? position

  function positionFromPointer(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    const angle = (Math.atan2(dx, -dy) * 180) / Math.PI
    return nearestPosition(angle, count)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragPos(positionFromPointer(e))
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragPos === null) return
    setDragPos(positionFromPointer(e))
  }

  function onPointerUp() {
    if (dragPos === null) return
    const final = dragPos
    setDragPos(null)
    if (final !== position) onSelect(final)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return
    const current = dragPos ?? position ?? 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setDragPos(Math.min(count - 1, dragPos === null && position === null ? 0 : current + 1))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setDragPos(Math.max(0, current - 1))
    } else if ((e.key === 'Enter' || e.key === ' ') && dragPos !== null) {
      e.preventDefault()
      onPointerUp()
    }
  }

  return (
    <div className={`mod-dial is-${size}`}>
      <div
        className={`mod-knob ${disabled ? 'is-disabled' : ''} ${dragPos !== null ? 'is-dragging' : ''}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={1}
        aria-valuemax={count}
        aria-valuenow={shown === null ? undefined : shown + 1}
        aria-valuetext={shown === null ? 'keine Auswahl' : labels[shown]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDragPos(null)}
        onKeyDown={onKeyDown}
      >
        {labels.map((_, i) => (
          <span
            key={i}
            className={`mod-knob-tick ${i === shown ? 'is-active' : ''}`}
            style={{ transform: `rotate(${angleFor(i, count)}deg)` }}
          />
        ))}
        <span
          className={`mod-knob-cap ${shown === null ? 'is-idle' : ''}`}
          style={{ transform: `rotate(${shown === null ? 180 : angleFor(shown, count)}deg)` }}
        />
      </div>

      {/* Labels at the ticks; hidden via container query when there is not enough room. */}
      {labels.map((label, i) => {
        const rad = (angleFor(i, count) * Math.PI) / 180
        const sin = Math.sin(rad)
        const side = sin > 0.25 ? 'is-right' : sin < -0.25 ? 'is-left' : 'is-center'
        const style = { '--sin': sin, '--cos': Math.cos(rad) } as CSSProperties
        return (
          <button
            key={i}
            className={`mod-dial-label ${side} ${i === shown ? 'is-active' : ''}`}
            style={style}
            onClick={() => onSelect(i)}
            disabled={disabled}
            tabIndex={-1}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function SingleDial({ primitive, value, onChange, disabled }: ModuleProps<'pick'> & { primitive: PickPrimitive }) {
  const position = value.length > 0 ? value[0] : null

  return (
    <div className="mod-rotary">
      <p className="mg-hint">Dreh den Schalter mit der Maus auf die richtige Antwort und lass los.</p>
      <div className="mod-rotary-body">
        <Dial
          labels={primitive.items}
          position={position}
          onSelect={(i) => onChange([i])}
          disabled={disabled}
          size="large"
          ariaLabel="Drehschalter"
        />
        <ol className="mod-rotary-legend">
          {primitive.items.map((item, i) => (
            <li key={i}>
              <button
                className={`mod-rotary-option ${i === position ? 'is-active' : ''}`}
                onClick={() => onChange([i])}
                disabled={disabled}
              >
                {item}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function DialPerItem({ primitive, value, onChange, disabled }: ModuleProps<'assign'> & { primitive: AssignPrimitive }) {
  function set(item: number, target: number) {
    onChange(value.map((v, i) => (i === item ? target : v)))
  }

  return (
    <div>
      <p className="mg-hint">Dreh jeden Schalter mit der Maus auf die passende Position.</p>
      <div className="mod-dial-cards">
        {primitive.items.map((label, i) => (
          <div key={i} className="mod-dial-card">
            <span className="mod-dial-card-label">{label}</span>
            <Dial
              labels={primitive.targets}
              position={value[i]}
              onSelect={(t) => set(i, t)}
              disabled={disabled}
              size="small"
              ariaLabel={label}
            />
            <span className="mod-dial-value">{value[i] === null ? '—' : primitive.targets[value[i]]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
