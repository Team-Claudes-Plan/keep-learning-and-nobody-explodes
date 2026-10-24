import { useEffect, useState } from 'react'
import type { ModuleProps } from './types'

const DIGITS = 4

/** Keys go to the lock unless the player is typing somewhere else. */
function isTypingElsewhere(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

export default function LockModule({ primitive, value, onChange, disabled }: ModuleProps<'number'>) {
  const [cursor, setCursor] = useState(0)
  const digits = String(value ?? 0).padStart(DIGITS, '0').split('').map(Number)

  function setDigit(pos: number, digit: number) {
    const next = [...digits]
    next[pos] = digit
    onChange(Number(next.join('')))
  }

  function turn(pos: number, delta: number) {
    setDigit(pos, (digits[pos] + delta + 10) % 10)
  }

  // Keyboard works as soon as the module is open: ↑↓ turn, ←→ move, digits type in.
  useEffect(() => {
    if (disabled) return
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingElsewhere(e.target)) return
      if (e.key === 'ArrowUp') turn(cursor, 1)
      else if (e.key === 'ArrowDown') turn(cursor, -1)
      else if (e.key === 'ArrowLeft') setCursor(Math.max(0, cursor - 1))
      else if (e.key === 'ArrowRight') setCursor(Math.min(DIGITS - 1, cursor + 1))
      else if (/^[0-9]$/.test(e.key)) {
        setDigit(cursor, Number(e.key))
        setCursor(Math.min(DIGITS - 1, cursor + 1))
      } else if (e.key === 'Backspace') {
        setDigit(cursor, 0)
        setCursor(Math.max(0, cursor - 1))
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div>
      <p className="mg-hint">↑↓ drehen · ←→ Ziffer wählen · Ziffern direkt eintippen</p>
      <div className="mod-lock">
        {digits.map((digit, pos) => (
          <div
            key={pos}
            className={`mod-wheel ${pos === cursor && !disabled ? 'is-cursor' : ''}`}
            role="spinbutton"
            aria-label={`Ziffer ${pos + 1}`}
            aria-valuemin={0}
            aria-valuemax={9}
            aria-valuenow={digit}
            onClick={() => setCursor(pos)}
          >
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
