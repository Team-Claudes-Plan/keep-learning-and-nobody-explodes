import type { ModuleProps } from './types'

export default function ButtonsModule({ primitive, value, onChange, disabled }: ModuleProps<'sequence'>) {
  function press(i: number) {
    const at = value.indexOf(i)
    // Pressing an already pressed button undoes it and everything after it.
    onChange(at === -1 ? [...value, i] : value.slice(0, at))
  }

  return (
    <div>
      <p className="mg-hint">Drücke die Knöpfe in der richtigen Reihenfolge.</p>
      <div className="mod-buttons">
        {primitive.items.map((label, i) => {
          const step = value.indexOf(i)
          return (
            <button
              key={i}
              className={`mod-press ${step !== -1 ? 'is-pressed' : ''}`}
              onClick={() => press(i)}
              disabled={disabled}
            >
              <span className="mod-press-cap">{step === -1 ? '' : step + 1}</span>
              <span className="mod-press-label">{label}</span>
            </button>
          )
        })}
      </div>
      <button className="mg-button" onClick={() => onChange([])} disabled={disabled || value.length === 0}>
        Zurücksetzen
      </button>
    </div>
  )
}
