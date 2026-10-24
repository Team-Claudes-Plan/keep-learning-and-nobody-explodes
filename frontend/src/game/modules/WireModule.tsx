import type { ModuleProps } from './types'

const WIRE_COLORS = ['#e5484d', '#3e63dd', '#f5d90a', '#30a46c', '#eeeeee', '#8e4ec6', '#f76b15', '#12a594']

export default function WireModule({ primitive, value, onChange, disabled }: ModuleProps<'pick'>) {
  function toggle(i: number) {
    if (disabled) return
    if (value.includes(i)) onChange(value.filter((v) => v !== i))
    else if (primitive.mode === 'one') onChange([i])
    else onChange([...value, i])
  }

  return (
    <div>
      <p className="mg-hint">
        {primitive.mode === 'one'
          ? 'Schneide das richtige Kabel durch.'
          : 'Schneide die Kabel der falschen Antworten durch.'}
      </p>
      <div className="mod-wires">
        {primitive.items.map((label, i) => {
          const cut = value.includes(i)
          return (
            <button
              key={i}
              className={`mod-wire ${cut ? 'is-cut' : ''}`}
              onClick={() => toggle(i)}
              disabled={disabled}
              aria-pressed={cut}
            >
              <span className="mod-wire-label">{label}</span>
              <span className="mod-wire-line" style={{ background: WIRE_COLORS[i % WIRE_COLORS.length] }} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
