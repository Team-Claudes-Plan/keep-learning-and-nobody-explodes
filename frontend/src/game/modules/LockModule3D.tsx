import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR } from './module3d'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const DIGITS = 4
const WHEEL_RADIUS = 0.1
const WHEEL_WIDTH = 0.12
const WHEEL_GAP = 0.155
const WHEEL_Y = 0.02
/** The wheels sit partly sunk into the plate, only the front shows. */
const WHEEL_Z = FACE + 0.01
const STEP = (2 * Math.PI) / 10

/** Keys go to the lock unless the player is typing somewhere else. */
function isTypingElsewhere(target: EventTarget | null) {
  return target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

type WheelProps = {
  x: number
  digit: number
  cursor: boolean
  disabled: boolean
  onTurn: (delta: number) => void
  onFocus: () => void
}

/** One number wheel: click its upper half (or ▲) to turn up, lower half (or ▼) to turn down, or scroll. */
function Wheel({ x, digit, cursor, disabled, onTurn, onFocus }: WheelProps) {
  const wheel = useRef<THREE.Group>(null)
  // Turns the short way round (9 → 0 rolls on instead of back through all digits).
  const goal = useRef(digit * STEP)
  // starting angle only, then useFrame turns the wheel (a changing prop would make it jump)
  const [start] = useState(digit)
  const shown = useRef(digit)
  useEffect(() => {
    const delta = ((((digit - shown.current) % 10) + 15) % 10) - 5
    goal.current += delta * STEP
    shown.current = digit
  }, [digit])

  useFrame((_, delta) => {
    if (wheel.current) wheel.current.rotation.x += (goal.current - wheel.current.rotation.x) * (1 - Math.exp(-delta * 16))
  })

  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (disabled) return
    onFocus()
    // above the wheel's axis turns up, below turns down
    const local = event.object.parent!.parent!.worldToLocal(event.point.clone())
    onTurn(local.y > 0 ? 1 : -1)
  }

  function arrow(by: number) {
    return (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      if (disabled) return
      onFocus()
      onTurn(by)
    }
  }

  return (
    <group position={[x, 0, 0]}>
      <group position={[0, WHEEL_Y, WHEEL_Z]}>
        <group ref={wheel} rotation={[start * STEP, 0, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]} onClick={click} onWheel={(e) => {
            e.stopPropagation()
            if (!disabled) onTurn(e.deltaY < 0 ? 1 : -1)
          }}>
            <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 40]} />
            <meshStandardMaterial color="#20242b" metalness={0.5} roughness={0.45} />
          </mesh>
          {Array.from({ length: 10 }, (_, d) => (
            // Digit d faces the viewer when the wheel is turned to d * STEP.
            <group key={d} rotation={[-d * STEP, 0, 0]}>
              <Text
                font={FONT_URL}
                position={[0, 0, WHEEL_RADIUS + 0.001]}
                raycast={() => null}
                fontSize={0.075}
                anchorX="center"
                anchorY="middle"
                color="#f2f4f7"
              >
                {String(d)}
              </Text>
            </group>
          ))}
        </group>
      </group>
      {/* metal rings on both sides of the wheel */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (WHEEL_WIDTH + 0.012)) / 2, WHEEL_Y, WHEEL_Z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[WHEEL_RADIUS * 1.04, WHEEL_RADIUS * 1.04, 0.01, 40]} />
          <meshStandardMaterial color="#9aa0a6" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}
      {/* arrows above and below */}
      {[1, -1].map((by) => (
        <mesh
          key={by}
          position={[0, WHEEL_Y + by * 0.16, FACE + 0.012]}
          rotation={[0, 0, by > 0 ? Math.PI / 2 : -Math.PI / 2]}
          onClick={arrow(by)}
        >
          <circleGeometry args={[0.03, 3]} />
          <meshBasicMaterial color={cursor && !disabled ? ACTIVE : '#7d8590'} toneMapped={false} />
        </mesh>
      ))}
      {/* cursor frame for keyboard input */}
      {cursor &&
        !disabled &&
        [
          [WHEEL_WIDTH + 0.05, 0.008, 0, WHEEL_RADIUS + 0.012],
          [WHEEL_WIDTH + 0.05, 0.008, 0, -WHEEL_RADIUS - 0.012],
          [0.008, WHEEL_RADIUS * 2 + 0.032, (WHEEL_WIDTH + 0.05) / 2, 0],
          [0.008, WHEEL_RADIUS * 2 + 0.032, -(WHEEL_WIDTH + 0.05) / 2, 0],
        ].map(([w, h, fx, fy], k) => (
          <mesh key={k} position={[fx, WHEEL_Y + fy, FACE + 0.008]} raycast={() => null}>
            <planeGeometry args={[w, h]} />
            <meshBasicMaterial color={ACTIVE} toneMapped={false} />
          </mesh>
        ))}
    </group>
  )
}

/** Combination lock on the bomb: four number wheels, turned by click, scroll or keyboard. */
export default function LockModule3D({ primitive, value, onChange, disabled }: ModuleProps<'number'>) {
  const [cursor, setCursor] = useState(0)
  const digits = String(value ?? 0).padStart(DIGITS, '0').slice(-DIGITS).split('').map(Number)

  function setDigit(pos: number, digit: number) {
    const next = [...digits]
    next[pos] = digit
    onChange(Number(next.join('')))
  }

  function turn(pos: number, delta: number) {
    setDigit(pos, (digits[pos] + delta + 10) % 10)
  }

  // Keyboard while the module is open: ↑↓ turn, ←→ move, digits type in.
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

  const first = -((DIGITS - 1) * WHEEL_GAP) / 2 - (primitive.unit ? 0.05 : 0)

  return (
    <group>
      <Text font={FONT_URL} position={[-0.44, 0.37, FACE + 0.012]} fontSize={0.032} maxWidth={0.72} anchorX="left" anchorY="middle" color={HINT_COLOR}>
        Räder drehen: klicken, scrollen oder tippen (↑↓ ←→ 0–9).
      </Text>
      {/* housing: dark window around the wheels */}
      <mesh position={[first + ((DIGITS - 1) * WHEEL_GAP) / 2, WHEEL_Y, FACE + 0.003]}>
        <boxGeometry args={[(DIGITS - 1) * WHEEL_GAP + WHEEL_WIDTH + 0.08, WHEEL_RADIUS * 2.3, 0.006]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>
      {digits.map((digit, pos) => (
        <Wheel
          key={pos}
          x={first + pos * WHEEL_GAP}
          digit={digit}
          cursor={pos === cursor}
          disabled={disabled}
          onTurn={(delta) => turn(pos, delta)}
          onFocus={() => setCursor(pos)}
        />
      ))}
      {primitive.unit && (
        <Text
          font={FONT_URL}
          position={[first + (DIGITS - 1) * WHEEL_GAP + WHEEL_WIDTH / 2 + 0.04, WHEEL_Y, FACE + 0.012]}
          fontSize={0.05}
          anchorX="left"
          anchorY="middle"
          color="#f2f4f7"
        >
          {primitive.unit}
        </Text>
      )}
    </group>
  )
}
