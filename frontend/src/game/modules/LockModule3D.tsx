import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import { FACE, FONT_URL } from './module3d'
import { ModuleHeading } from './Label3D'
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
/** Each of the ten faces of the decagonal wheel (WHEEL_RADIUS is the distance to a face). */
const FACE_HEIGHT = 2 * WHEEL_RADIUS * Math.tan(STEP / 2)
const FACE_THICKNESS = 0.01
/** Spring the wheel turns on: quick, with a small overshoot before it settles on the digit. */
const WHEEL_SPRING = 520
const WHEEL_DAMPING = 30

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
  const axis = useRef<THREE.Group>(null)
  const wheel = useRef<THREE.Group>(null)
  // Digit d faces the viewer at angle -d * STEP: turning up rolls the wheel's front upwards and the
  // next digit comes up from below, like a real lock. Always the short way round (9 → 0 rolls on).
  const goal = useRef(-digit * STEP)
  const angle = useRef(-digit * STEP)
  const speed = useRef(0)
  const shown = useRef(digit)
  useEffect(() => {
    const delta = ((((digit - shown.current) % 10) + 15) % 10) - 5
    goal.current -= delta * STEP
    shown.current = digit
  }, [digit])

  // The wheel rides a spring: it rolls over to the next digit, overshoots a touch and settles in.
  useFrame((_, delta) => {
    if (!wheel.current) return
    const dt = Math.min(delta, 1 / 20)
    const steps = Math.ceil(dt / (1 / 240))
    for (let i = 0; i < steps; i++) {
      speed.current += (WHEEL_SPRING * (goal.current - angle.current) - WHEEL_DAMPING * speed.current) * (dt / steps)
      angle.current += speed.current * (dt / steps)
    }
    wheel.current.rotation.x = angle.current
  })

  function click(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (disabled || !axis.current) return
    onFocus()
    // above the wheel's axis turns up, below turns down
    const local = axis.current.worldToLocal(event.point.clone())
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
      <group ref={axis} position={[0, WHEEL_Y, WHEEL_Z]}>
        <group
          ref={wheel}
          onClick={click}
          onWheel={(e) => {
            e.stopPropagation()
            // the wheel follows the scroll like a page does: content moving up rolls it up (next digit)
            if (!disabled) onTurn(e.deltaY > 0 ? 1 : -1)
          }}
        >
          {/* core, so no gaps show between the faces */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[WHEEL_RADIUS * 0.97, WHEEL_RADIUS * 0.97, WHEEL_WIDTH * 0.96, 10]} />
            <meshStandardMaterial color="#0e1013" roughness={0.8} />
          </mesh>
          {Array.from({ length: 10 }, (_, d) => (
            // ten flat faces make the decagon, one digit on each
            <group key={d} rotation={[d * STEP, 0, 0]}>
              <mesh position={[0, 0, WHEEL_RADIUS - FACE_THICKNESS / 2]}>
                <boxGeometry args={[WHEEL_WIDTH, FACE_HEIGHT * 0.94, FACE_THICKNESS]} />
                <meshStandardMaterial color="#23272e" metalness={0.55} roughness={0.4} flatShading />
              </mesh>
              <Text
                font={FONT_URL}
                position={[0, 0, WHEEL_RADIUS + 0.001]}
                raycast={() => null}
                fontSize={FACE_HEIGHT * 0.82}
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
          <cylinderGeometry args={[WHEEL_RADIUS * 1.09, WHEEL_RADIUS * 1.09, 0.01, 40]} />
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
export default function LockModule3D({ primitive, value, onChange, disabled, heading }: ModuleProps<'number'>) {
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
      <ModuleHeading text={heading} />
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
