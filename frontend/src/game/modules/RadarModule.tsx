import type { MouseEvent } from 'react'
import type { ModuleProps } from './types'

export default function RadarModule({ primitive, value, onChange, disabled }: ModuleProps<'point'>) {
  function aim(e: MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    onChange({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
  }

  return (
    <div>
      <p className="mg-hint">Klicke auf die richtige Stelle im Radarbild.</p>
      <button className="mod-radar" onClick={aim} disabled={disabled} aria-label="Ziel im Bild markieren">
        <img src={primitive.image} alt="" draggable={false} />
        <span className="mod-radar-sweep" />
        {value && (
          <span className="mod-radar-marker" style={{ left: `${value.x}%`, top: `${value.y}%` }} />
        )}
      </button>
      <p className="mg-muted">{value ? `Ziel: ${value.x}% / ${value.y}%` : 'Kein Ziel markiert'}</p>
    </div>
  )
}
