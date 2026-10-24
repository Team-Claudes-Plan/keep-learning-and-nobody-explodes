import { useState } from 'react'
import type { ModuleProps } from './types'

type Props = ModuleProps<'text'> | ModuleProps<'number'>

function parseNumber(input: string): number | null {
  const trimmed = input.trim().replace(',', '.')
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export default function TerminalModule(props: Props) {
  const isNumber = props.primitive.kind === 'number'
  const unit = props.primitive.kind === 'number' ? props.primitive.unit : null
  const [input, setInput] = useState(() => (props.value === null ? '' : String(props.value)))

  const uppercase = props.primitive.kind === 'text' && props.primitive.uppercase

  function change(raw: string) {
    const next = uppercase ? raw.toUpperCase() : raw
    setInput(next)
    if (isNumber) (props as ModuleProps<'number'>).onChange(parseNumber(next))
    else (props as ModuleProps<'text'>).onChange(next)
  }

  const invalid = isNumber && input.trim() !== '' && parseNumber(input) === null

  return (
    <div>
      <p className="mg-hint">{isNumber ? 'Gib die Zahl ein.' : 'Gib das Passwort ein.'} Enter schließt ab.</p>
      <label className="mod-terminal">
        <span className="mod-terminal-line">SYSTEM GESPERRT · EINGABE ERFORDERLICH</span>
        <span className="mod-terminal-input">
          <span aria-hidden>&gt;</span>
          <input
            value={input}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && props.onLockIn()}
            disabled={props.disabled}
            inputMode={isNumber ? 'decimal' : 'text'}
            autoComplete="off"
            spellCheck={false}
            aria-label={isNumber ? 'Zahl' : 'Antwort'}
          />
          {unit && <span className="mod-terminal-unit">{unit}</span>}
        </span>
        {invalid && <span className="mod-terminal-error">FEHLER: KEINE GÜLTIGE ZAHL</span>}
      </label>
    </div>
  )
}
