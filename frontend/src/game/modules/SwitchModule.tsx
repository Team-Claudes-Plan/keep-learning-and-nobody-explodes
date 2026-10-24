import type { AssignPrimitive, PickPrimitive } from '../primitives'
import type { ModuleProps } from './types'

type Props = ModuleProps<'pick'> | ModuleProps<'assign'>

export default function SwitchModule(props: Props) {
  return props.primitive.kind === 'pick'
    ? <ToggleSwitches {...(props as ModuleProps<'pick'>)} />
    : <PositionSwitches {...(props as ModuleProps<'assign'>)} />
}

function ToggleSwitches({ primitive, value, onChange, disabled }: ModuleProps<'pick'> & { primitive: PickPrimitive }) {
  const on = primitive.onLabel ?? 'AN'
  const off = primitive.offLabel ?? 'AUS'

  function flip(i: number) {
    onChange(value.includes(i) ? value.filter((v) => v !== i) : [...value, i])
  }

  return (
    <div>
      <p className="mg-hint">Lege die Schalter auf {on} oder {off}.</p>
      <div className="mod-switches">
        {primitive.items.map((label, i) => {
          const isOn = value.includes(i)
          return (
            <div key={i} className="mod-switch-row">
              <span className="mod-switch-label">{label}</span>
              <button
                className={`mod-toggle ${isOn ? 'is-on' : ''}`}
                onClick={() => flip(i)}
                disabled={disabled}
                aria-pressed={isOn}
              >
                <span className="mod-toggle-track">
                  <span className="mod-toggle-lever" />
                </span>
                <span className="mod-toggle-text">{isOn ? on : off}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PositionSwitches({ primitive, value, onChange, disabled }: ModuleProps<'assign'> & { primitive: AssignPrimitive }) {
  function set(item: number, target: number) {
    onChange(value.map((v, i) => (i === item ? target : v)))
  }

  return (
    <div>
      <p className="mg-hint">Stelle jeden Schalter auf die passende Position.</p>
      <div className="mod-switches">
        {primitive.items.map((label, i) => (
          <div key={i} className="mod-switch-row">
            <span className="mod-switch-label">{label}</span>
            <div className="mod-positions" role="radiogroup" aria-label={label}>
              {primitive.targets.map((target, t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={value[i] === t}
                  className={`mod-position ${value[i] === t ? 'is-active' : ''}`}
                  onClick={() => set(i, t)}
                  disabled={disabled}
                >
                  {target}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
