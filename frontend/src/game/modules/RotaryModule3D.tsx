import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import type { AssignPrimitive, PickPrimitive } from '../primitives'
import { FACE, FONT_URL, useModulePointer } from './module3d'
import { Label, ModuleHeading } from './Label3D'
import type { ModuleProps } from './types'

type Props = ModuleProps<'pick'> | ModuleProps<'assign'>

const ACTIVE = '#ffb547'
const KNOB_RADIUS = 0.11
const TICK_RADIUS = 0.165
const LABEL_RADIUS = 0.205
/** Labels must stay inside the plate (screws sit at ±0.44). */
const PLATE_EDGE = 0.44

/** Positions spread symmetrically around the top, up to a 270° arc (0° = up, clockwise positive). */
function angleFor(position: number, count: number) {
  if (count <= 1) return 0
  const span = Math.min(270, (count - 1) * 60)
  return -span / 2 + (span / (count - 1)) * position
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** How far (share of the way to the midpoint) the knob follows the pointer before it gives way. */
const DETENT_HOLD = 0.4
/** Pointer must pass the midpoint by this much (share of half a step) to flip, so it never chatters. */
const DETENT_FLIP = 1.1
/** Spring the knob rides on: very stiff and nearly critically damped, so it lands and stops dead. */
const SPRING = 7000
const DAMPING = 125

/** Turning state: pointer angle, the position the knob sits in, and which side it was entered from. */
type Drag = { raw: number; committed: number; entry: -1 | 0 | 1 }

function stepFor(count: number) {
  return count > 1 ? angleFor(1, count) - angleFor(0, count) : 0
}

/** Moves the drag to a new pointer angle, flipping to the neighbour once pulled far enough past the midpoint. */
function dragTo(prev: Drag, raw: number, count: number): Drag {
  const flip = (stepFor(count) / 2) * DETENT_FLIP
  let { committed, entry } = prev
  for (;;) {
    const d = raw - angleFor(committed, count)
    if (d > flip && committed < count - 1) [committed, entry] = [committed + 1, -1]
    else if (d < -flip && committed > 0) [committed, entry] = [committed - 1, 1]
    else break
  }
  // once the pointer passes the notch centre, pulling on starts the next resistance
  if (entry !== 0 && Math.sign(raw - angleFor(committed, count)) !== entry) entry = 0
  return { raw, committed, entry }
}

/**
 * Where the knob points while turning: right after a click it sits in the notch; pulled away from
 * it, it follows only partly and resists more the further it goes, until it gives way.
 */
function knobAngle({ raw, committed, entry }: Drag, count: number) {
  const base = angleFor(committed, count)
  if (count <= 1 || entry !== 0) return base
  const half = stepFor(count) / 2
  const t = Math.min(1, Math.abs(raw - base) / half)
  return base + Math.sign(raw - base) * half * DETENT_HOLD * t ** 1.5
}

const SKIRT_HEIGHT = 0.02
const GRIP_HEIGHT = 0.055
const GRIP_BEVEL = 0.008

/**
 * Grip bar of the knob, seen from above: narrow tip pointing up (+Y, the pointer), wide rounded back,
 * like the bar knobs on old instrument panels. Extruded towards the viewer, edges bevelled.
 */
const GRIP_GEOMETRY = (() => {
  const shape = new THREE.Shape()
  shape.moveTo(-0.012, 0.13)
  shape.quadraticCurveTo(0, 0.142, 0.012, 0.13)
  shape.lineTo(0.032, -0.07)
  shape.absarc(0, -0.07, 0.032, 0, Math.PI, true)
  shape.lineTo(-0.012, 0.13)
  return new THREE.ExtrudeGeometry(shape, {
    depth: GRIP_HEIGHT,
    bevelEnabled: true,
    bevelThickness: GRIP_BEVEL,
    bevelSize: 0.006,
    bevelSegments: 3,
    curveSegments: 16,
  })
})()

type DialProps = {
  center: [number, number]
  labels: string[]
  position: number | null
  onSelect: (position: number) => void
  disabled: boolean
}

/**
 * The dial: grab the knob (or anywhere on the dial) and turn it; it resists, then clicks
 * into the next position and stays there; release keeps the position it clicked into. The answers sit around it, on the left and right, and can also be clicked.
 */
function Dial({ center, labels, position, onSelect, disabled }: DialProps) {
  const count = labels.length
  const group = useRef<THREE.Group>(null)
  const knob = useRef<THREE.Group>(null)
  const pointerOnModule = useModulePointer(group)
  /** Drag state while turning, null when resting on a position. */
  const [turning, setTurning] = useState<Drag | null>(null)
  const latest = useRef({ onSelect, position })
  latest.current = { onSelect, position }

  const span = count > 1 ? Math.min(270, (count - 1) * 60) : 0
  // Nothing chosen yet: the knob already rests on the first position, it just is not selected.
  const restAngle = angleFor(position ?? 0, count)
  const goalAngle = turning === null ? restAngle : knobAngle(turning, count)
  const hovered = turning === null ? position : turning.committed

  /** Knob state in degrees; `target` is the position it heads for, `armed` until it has clicked in there. */
  const anim = useRef({ angle: restAngle, velocity: 0, target: position, armed: false, kick: 0 })

  // The knob rides a spring towards its goal and clicks once when it lands in a new position.
  useFrame((_, delta) => {
    if (!knob.current) return
    const s = anim.current
    const dt = Math.min(delta, 1 / 20)
    const steps = Math.ceil(dt / (1 / 480))
    for (let i = 0; i < steps; i++) {
      s.velocity += (SPRING * (goalAngle - s.angle) - DAMPING * s.velocity) * (dt / steps)
      s.angle += s.velocity * (dt / steps)
    }
    const target = hovered
    if (target !== s.target) {
      s.target = target
      s.armed = target !== null
    }
    if (s.armed && target !== null && Math.abs(s.angle - angleFor(target, count)) < 2.5) {
      s.armed = false
      s.kick = 1
    }
    s.kick = Math.max(0, s.kick - dt * 10)
    knob.current.rotation.z = -rad(s.angle)
    // short press-in on the click, like the knob dropping into the notch
    knob.current.position.z = 0.012 - 0.006 * Math.sin(s.kick * Math.PI)
  })

  function angleAt(clientX: number, clientY: number) {
    const p = pointerOnModule(clientX, clientY)
    if (!p) return null
    const deg = (Math.atan2(p.x - center[0], p.y - center[1]) * 180) / Math.PI
    // A little past the end stops, like a real switch.
    return Math.max(-span / 2 - 15, Math.min(span / 2 + 15, deg))
  }

  function startTurn(event: ThreeEvent<PointerEvent>) {
    event.stopPropagation()
    if (disabled) return
    const raw = angleAt(event.clientX, event.clientY) ?? restAngle
    const from = position ?? 0
    setTurning(dragTo({ raw: angleFor(from, count), committed: from, entry: 0 }, raw, count))
  }

  const isTurning = turning !== null
  const drag = useRef(turning)
  drag.current = turning
  useEffect(() => {
    if (!isTurning) return
    const move = (e: PointerEvent) => {
      const a = angleAt(e.clientX, e.clientY)
      if (a !== null) setTurning((t) => t && dragTo(t, a, count))
    }
    const up = () => {
      const final = drag.current?.committed
      setTurning(null)
      if (final !== undefined && final !== latest.current.position) latest.current.onSelect(final)
    }
    const cancel = () => setTurning(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    // angleAt only reads layout that does not change while turning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTurning, count])

  return (
    <group ref={group}>
      {/* dark backing, so the answers read well on the metal plate */}
      <mesh position={[0, center[1] - 0.01, FACE + 0.003]} raycast={() => null}>
        <boxGeometry args={[0.86, 0.56, 0.006]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>
      <group position={[center[0], center[1], FACE]}>
        {/* dial plate: turning starts anywhere on it */}
        <mesh position={[0, 0, 0.006]} rotation={[Math.PI / 2, 0, 0]} onPointerDown={startTurn}>
          <cylinderGeometry args={[TICK_RADIUS + 0.03, TICK_RADIUS + 0.03, 0.012, 64]} />
          <meshStandardMaterial color="#262a31" roughness={0.5} />
        </mesh>

        {labels.map((_, i) => {
          const a = rad(angleFor(i, count))
          return (
            <mesh
              key={i}
              position={[Math.sin(a) * TICK_RADIUS, Math.cos(a) * TICK_RADIUS, 0.014]}
              rotation={[0, 0, -a]}
              raycast={() => null}
            >
              <boxGeometry args={[0.012, 0.04, 0.004]} />
              <meshBasicMaterial color={i === hovered ? ACTIVE : '#d9dde3'} toneMapped={false} />
            </mesh>
          )
        })}

        {/* knob: round metal skirt with a raised grip bar on top whose tip points at the answer */}
        <group ref={knob} position={[0, 0, 0.012]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, SKIRT_HEIGHT / 2]} onPointerDown={startTurn}>
            <cylinderGeometry args={[KNOB_RADIUS * 0.96, KNOB_RADIUS, SKIRT_HEIGHT, 48]} />
            <meshStandardMaterial color="#9ea4ac" metalness={0.85} roughness={0.32} />
          </mesh>
          <mesh geometry={GRIP_GEOMETRY} position={[0, 0, SKIRT_HEIGHT + GRIP_BEVEL]} onPointerDown={startTurn}>
            <meshStandardMaterial color="#17191d" metalness={0.15} roughness={0.38} />
          </mesh>
          {/* pointer line along the top of the grip */}
          <mesh position={[0, 0.065, SKIRT_HEIGHT + GRIP_HEIGHT + GRIP_BEVEL * 2 + 0.001]} raycast={() => null}>
            <boxGeometry args={[0.009, 0.12, 0.002]} />
            <meshBasicMaterial color={ACTIVE} toneMapped={false} />
          </mesh>
        </group>

        {/* answers around the dial: left half on the left, right half on the right */}
        {labels.map((label, i) => {
          const a = rad(angleFor(i, count))
          const sin = Math.sin(a)
          const cos = Math.cos(a)
          const x = sin * LABEL_RADIUS
          const side = sin < -0.2 ? 'right' : sin > 0.2 ? 'left' : 'center'
          const room = side === 'center' ? 0.3 : PLATE_EDGE - Math.abs(center[0] + x)
          return (
            <Label
              key={i}
              font={FONT_URL}
              position={[x, cos * LABEL_RADIUS, 0.016]}
              fontSize={Math.min(0.036, Math.max(0.022, (room * 1.6) / Math.max(label.length, 4)))}
              maxWidth={room}
              anchorX={side}
              anchorY={cos > 0.5 ? 'bottom' : cos < -0.5 ? 'top' : 'middle'}
              textAlign={side === 'right' ? 'right' : side === 'left' ? 'left' : 'center'}
              lineHeight={1.1}
              color={i === hovered ? ACTIVE : '#f2f4f7'}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation()
                if (!disabled) onSelect(i)
              }}
            >
              {label}
            </Label>
          )
        })}
      </group>
    </group>
  )
}

function SingleDial({ primitive, value, onChange, disabled }: ModuleProps<'pick'> & { primitive: PickPrimitive }) {
  return (
    <Dial
      center={[0, -0.05]}
      labels={primitive.items}
      position={value.length > 0 ? value[0] : null}
      onSelect={(i) => onChange([i])}
      disabled={disabled}
    />
  )
}

/** One dial, one item at a time: turn it to the item's target, then it moves on to the next item. */
function DialPerItem({ primitive, value, onChange, disabled }: ModuleProps<'assign'> & { primitive: AssignPrimitive }) {
  const [current, setCurrent] = useState(0)
  const count = primitive.items.length
  // stops at the first and last item, no wrapping round
  const canStep = (by: number) => current + by >= 0 && current + by < count
  const step = (by: number) => setCurrent((c) => Math.min(count - 1, Math.max(0, c + by)))

  // An item counts as answered once it is on the dial: it starts on the first group, which may
  // already be right. Items not looked at yet stay open, so locking in needs every item seen.
  useEffect(() => {
    if (!disabled && value[current] === null) onChange(value.map((v, i) => (i === current ? 0 : v)))
  }, [current, disabled, value, onChange])

  // Stays on the item after turning: the player moves on with the arrows when ready.
  function select(target: number) {
    onChange(value.map((v, i) => (i === current ? target : v)))
  }

  function arrow(by: number) {
    return (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation()
      if (!disabled && canStep(by)) step(by)
    }
  }

  return (
    <group>
      {/* item being assigned, with arrows to switch */}
      <group position={[0, 0.25, FACE]}>
        <mesh position={[0, 0, 0.005]}>
          <boxGeometry args={[0.8, 0.09, 0.01]} />
          <meshStandardMaterial color="#111317" roughness={0.5} />
        </mesh>
        {[-1, 1].map((by) => (
          <mesh key={by} position={[by * 0.35, 0, 0.012]} rotation={[0, 0, by < 0 ? Math.PI : 0]} onClick={arrow(by)}>
            <circleGeometry args={[0.028, 3]} />
            <meshBasicMaterial color={canStep(by) ? ACTIVE : '#4a4f57'} toneMapped={false} />
          </mesh>
        ))}
        <Label
          font={FONT_URL}
          position={[0, 0.005, 0.012]}
          fontSize={Math.min(0.04, 1 / Math.max(primitive.items[current].length, 10))}
          maxWidth={0.58}
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          color="#f2f4f7"
        >
          {primitive.items[current]}
        </Label>
        {/* dots: white = current item, amber = looked at (answered), grey = still open */}
        {primitive.items.map((_, i) => (
          <mesh key={i} position={[(i - (count - 1) / 2) * 0.03, -0.065, 0.006]} raycast={() => null}>
            <circleGeometry args={[i === current ? 0.009 : 0.007, 16]} />
            <meshBasicMaterial color={i === current ? '#ffffff' : value[i] !== null ? ACTIVE : '#5b6270'} toneMapped={false} />
          </mesh>
        ))}
      </group>

      <Dial
        center={[0, -0.1]}
        labels={primitive.targets}
        position={value[current]}
        onSelect={select}
        disabled={disabled}
      />
    </group>
  )
}

/** Rotary switch on the bomb: turn the knob itself to the answer. */
export default function RotaryModule3D(props: Props) {
  return (
    <group>
      <ModuleHeading text={props.heading} />
      {props.primitive.kind === 'pick' ? (
        <SingleDial {...(props as ModuleProps<'pick'>)} />
      ) : (
        <DialPerItem {...(props as ModuleProps<'assign'>)} />
      )}
    </group>
  )
}
