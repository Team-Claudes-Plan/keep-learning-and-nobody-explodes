import type { ModuleProps } from './types'

export default function FuseModule({ primitive, value, onChange, disabled }: ModuleProps<'pick'>) {
  const on = primitive.onLabel ?? 'EIN'
  const off = primitive.offLabel ?? 'AUS'

  function toggle(i: number) {
    if (value.includes(i)) onChange(value.filter((v) => v !== i))
    else onChange(primitive.mode === 'one' ? [i] : [...value, i])
  }

  return (
    <div>
      <p className="mg-hint">
        {primitive.mode === 'one'
          ? 'Setze die richtige Sicherung ein.'
          : `Setze die Sicherungen ein (${on}) oder lass sie draußen (${off}).`}
      </p>
      <div className="mod-fuses">
        {primitive.items.map((label, i) => {
          const inserted = value.includes(i)
          return (
            <button
              key={i}
              className={`mod-fuse ${inserted ? 'is-in' : ''}`}
              onClick={() => toggle(i)}
              disabled={disabled}
              aria-pressed={inserted}
            >
              <span className="mod-fuse-slot">
                <span className="mod-fuse-body" />
              </span>
              <span className="mod-fuse-state">{inserted ? on : off}</span>
              <span className="mod-fuse-label">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
