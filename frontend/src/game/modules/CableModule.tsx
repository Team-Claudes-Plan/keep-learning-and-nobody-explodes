import { useState } from 'react'
import type { ModuleProps } from './types'

const CABLE_COLORS = ['#e5484d', '#3e63dd', '#f5d90a', '#30a46c', '#8e4ec6', '#f76b15', '#12a594', '#eeeeee']
const ROW_HEIGHT = 44

export default function CableModule({ primitive, value, onChange, disabled }: ModuleProps<'assign'>) {
  const [active, setActive] = useState<number | null>(null)
  const { items, targets } = primitive
  const height = Math.max(items.length, targets.length) * ROW_HEIGHT
  const leftY = (i: number) => ((i + 0.5) * height) / items.length
  const rightY = (j: number) => ((j + 0.5) * height) / targets.length

  function connect(target: number) {
    if (active === null) return
    onChange(
      value.map((v, i) => {
        if (i === active) return target
        // Matching: a socket takes only one cable.
        if (primitive.unique && v === target) return null
        return v
      }),
    )
    setActive(null)
  }

  function pickPlug(i: number) {
    if (active === i) {
      // Second click on the same plug pulls its cable.
      onChange(value.map((v, k) => (k === i ? null : v)))
      setActive(null)
    } else {
      setActive(i)
    }
  }

  return (
    <div>
      <p className="mg-hint">Klicke links einen Stecker an und dann rechts die passende Buchse.</p>
      <div className="mod-cables" style={{ height }}>
        <div className="mod-cables-col">
          {items.map((label, i) => (
            <button
              key={i}
              className={`mod-cable-end is-left ${active === i ? 'is-active' : ''}`}
              onClick={() => pickPlug(i)}
              disabled={disabled}
            >
              <span className="mod-cable-text">{label}</span>
              <span className="mod-cable-plug" style={{ background: CABLE_COLORS[i % CABLE_COLORS.length] }} />
            </button>
          ))}
        </div>
        <svg className="mod-cables-wires" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden>
          {value.map((target, i) =>
            target === null ? null : (
              <path
                key={i}
                d={`M0 ${leftY(i)} C50 ${leftY(i)} 50 ${rightY(target)} 100 ${rightY(target)}`}
                stroke={CABLE_COLORS[i % CABLE_COLORS.length]}
                strokeWidth={4}
                fill="none"
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}
        </svg>
        <div className="mod-cables-col">
          {targets.map((label, j) => (
            <button
              key={j}
              className={`mod-cable-end is-right ${active !== null ? 'is-target' : ''}`}
              onClick={() => connect(j)}
              disabled={disabled || active === null}
            >
              <span className="mod-cable-plug is-socket" />
              <span className="mod-cable-text">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
