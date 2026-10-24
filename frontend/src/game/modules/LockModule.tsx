import type { ModuleProps } from './types'

const DIGITS = 4

export default function LockModule({ primitive, value, onChange, disabled }: ModuleProps<'number'>) {
  const digits = String(value ?? 0).padStart(DIGITS, '0').split('').map(Number)

  function turn(pos: number, delta: number) {
    const next = [...digits]
    next[pos] = (next[pos] + delta + 10) % 10
    onChange(Number(next.join('')))
  }

  return (
    <div>
      <p className="mg-hint">Stelle die Zahl am Schloss ein.</p>
      <div className="mod-lock">
        {digits.map((digit, pos) => (
          <div key={pos} className="mod-wheel">
            <button className="mod-wheel-btn" onClick={() => turn(pos, 1)} disabled={disabled} aria-label="Ziffer erhöhen">
              ▲
            </button>
            <span className="mod-wheel-digit">{digit}</span>
            <button className="mod-wheel-btn" onClick={() => turn(pos, -1)} disabled={disabled} aria-label="Ziffer verringern">
              ▼
            </button>
          </div>
        ))}
        {primitive.unit && <span className="mod-lock-unit">{primitive.unit}</span>}
      </div>
    </div>
  )
}
