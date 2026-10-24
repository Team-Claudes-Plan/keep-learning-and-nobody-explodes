import type { ModuleProps } from './types'

export default function SorterModule({ primitive, value, onChange, disabled }: ModuleProps<'assign'>) {
  const current = value.findIndex((v) => v === null)
  const remaining = value.filter((v) => v === null).length

  function sort(target: number) {
    if (current === -1) return
    onChange(value.map((v, i) => (i === current ? target : v)))
  }

  function takeBack(item: number) {
    onChange(value.map((v, i) => (i === item ? null : v)))
  }

  return (
    <div>
      <p className="mg-hint">Stell die Weiche, um das Teil auf dem Band einzusortieren. Klick ein Teil im Behälter an, um es zurückzulegen.</p>
      <div className="mod-belt">
        <span className="mod-belt-item">{current === -1 ? 'Band leer ✓' : primitive.items[current]}</span>
        <span className="mg-muted">{remaining} übrig</span>
      </div>
      <div className="mod-bins" style={{ gridTemplateColumns: `repeat(${primitive.targets.length}, 1fr)` }}>
        {primitive.targets.map((target, t) => (
          <div key={t} className="mod-bin">
            <button className="mg-button mod-bin-lever" onClick={() => sort(t)} disabled={disabled || current === -1}>
              ↓ {target}
            </button>
            <div className="mod-bin-content">
              {value.map((v, i) =>
                v === t ? (
                  <button key={i} className="mod-bin-item" onClick={() => takeBack(i)} disabled={disabled}>
                    {primitive.items[i]}
                  </button>
                ) : null,
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
