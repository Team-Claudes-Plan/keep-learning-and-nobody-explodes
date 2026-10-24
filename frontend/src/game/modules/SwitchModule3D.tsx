import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import type { AssignPrimitive, PickPrimitive } from '../primitives'
import { FACE, FONT_URL, labelSize, ROWS_TOP, rowLayout, useModulePointer } from './module3d'
import { Label, ModuleHeading } from './Label3D'
import type { ModuleProps } from './types'

type Props = ModuleProps<'pick'> | ModuleProps<'assign'>

const ACTIVE = '#ffb547'
const LABEL_LEFT = -0.44
/** Lever tilt from upright, towards ON (up) or OFF (down). */
const LEVER_TILT = 0.75

function stop(handler: () => void, disabled: boolean) {
  return (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    if (!disabled) handler()
  }
}

/** Dark strip behind the row labels, so they read well on the metal plate. */
function LabelStrip({ width, ys, step }: { width: number; ys: number[]; step: number }) {
  const top = ys[0] + step / 2
  const bottom = ys[ys.length - 1] - step / 2
  return (
    <mesh position={[LABEL_LEFT + width / 2 - 0.01, (top + bottom) / 2, FACE + 0.004]}>
      <boxGeometry args={[width + 0.03, top - bottom, 0.008]} />
      <meshStandardMaterial color="#0d1014" roughness={0.8} />
    </mesh>
  )
}

/** Bat-handle toggle switch: the lever snaps up (on) or down (off). */
function Toggle({ y, isOn, size }: { y: number; isOn: boolean; size: number }) {
  const lever = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (!lever.current) return
    const goal = isOn ? -LEVER_TILT : LEVER_TILT
    lever.current.rotation.x += (goal - lever.current.rotation.x) * (1 - Math.exp(-delta * 22))
  })
  return (
    <group position={[0, y, FACE]}>
      <mesh position={[0, 0, 0.006]}>
        <boxGeometry args={[size * 0.9, size * 1.2, 0.012]} />
        <meshStandardMaterial color="#c3c8cf" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[size * 0.28, size * 0.28, 0.018, 6]} />
        <meshStandardMaterial color="#8d939b" metalness={0.9} roughness={0.25} />
      </mesh>
      <group ref={lever} position={[0, 0, 0.026]}>
        <mesh position={[0, 0, size * 0.55]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[size * 0.1, size * 0.14, size * 1.1, 14]} />
          <meshStandardMaterial color="#e3e6ea" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0, size * 1.12]}>
          <sphereGeometry args={[size * 0.16, 14, 14]} />
          <meshStandardMaterial color="#e3e6ea" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>
    </group>
  )
}

/** Indicator lamp next to a toggle switch: glows while the switch is on. */
function Lamp({ x, y, size, lit }: { x: number; y: number; size: number; lit: boolean }) {
  const radius = size * 0.32
  return (
    <group position={[x, y, FACE]}>
      {/* chrome bezel */}
      <mesh position={[0, 0, 0.006]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 1.35, radius * 1.4, 0.012, 24]} />
        <meshStandardMaterial color="#b9bec6" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* glass dome */}
      <mesh position={[0, 0, 0.012]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.7, 1]}>
        <sphereGeometry args={[radius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={lit ? ACTIVE : '#3a2f22'}
          emissive={lit ? ACTIVE : '#000000'}
          emissiveIntensity={lit ? 1.6 : 0}
          roughness={0.25}
          toneMapped={!lit}
        />
      </mesh>
    </group>
  )
}

function ToggleSwitches({ primitive, value, onChange, disabled, heading }: ModuleProps<'pick'> & { primitive: PickPrimitive }) {
  const { step, ys } = rowLayout(primitive.items.length)
  const labelWidth = 0.52
  // the lever must stay within its own row, also when it points down at the next one
  const size = Math.min(0.11, step * 0.55)
  const switchX = 0.2

  function flip(i: number) {
    onChange(value.includes(i) ? value.filter((v) => v !== i) : [...value, i])
  }

  return (
    <group>
      <ModuleHeading text={heading} />
      <LabelStrip width={labelWidth} ys={ys} step={step} />
      {primitive.items.map((label, i) => {
        const isOn = value.includes(i)
        const y = ys[i]
        return (
          <group key={i}>
            <Label
              font={FONT_URL}
              position={[LABEL_LEFT, y, FACE + 0.012]}
              fontSize={labelSize(label, labelWidth, step)}
              maxWidth={labelWidth - 0.02}
              anchorX="left"
              anchorY="middle"
              lineHeight={1.1}
              color="#f2f4f7"
            >
              {label}
            </Label>
            <group position={[switchX, 0, 0]}>
              <Toggle y={y} isOn={isOn} size={size} />
            </group>
            <Lamp x={switchX + size * 1.25} y={y} size={size} lit={isOn} />
            {/* the whole row flips the switch */}
            <mesh position={[0, y, FACE + 0.13]} onClick={stop(() => flip(i), disabled)}>
              <planeGeometry args={[0.88, step * 0.95]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

/** Slide switch with one notch per target; the knob slides to the chosen one. */
/** How far (share of the way to the midpoint) the knob follows the pointer before it snaps over. */
const DETENT_HOLD = 0.35

function nearestNotch(xs: number[], x: number) {
  let best = 0
  xs.forEach((notch, t) => {
    if (Math.abs(notch - x) < Math.abs(xs[best] - x)) best = t
  })
  return best
}

/**
 * Knob position while dragging: it lags behind the pointer around a notch and resists more the
 * further it is pulled; past the midpoint it snaps over into the next notch.
 */
function detentX(xs: number[], raw: number) {
  if (xs.length < 2) return xs[0]
  const notch = xs[nearestNotch(xs, raw)]
  const half = (xs[1] - xs[0]) / 2
  const t = Math.min(1, Math.abs(raw - notch) / half)
  return notch + Math.sign(raw - notch) * half * DETENT_HOLD * t ** 1.5
}

type SlideProps = {
  y: number
  xs: number[]
  position: number | null
  size: number
  /** Pointer x while the knob is being dragged, null otherwise. */
  dragX: number | null
}

function Slide({ y, xs, position, size, dragX }: SlideProps) {
  const knob = useRef<THREE.Group>(null)
  const left = xs[0]
  const right = xs[xs.length - 1]
  // Not set yet: the knob waits, dimmed, in the middle of the track.
  const goal = dragX !== null ? detentX(xs, dragX) : position === null ? (left + right) / 2 : xs[position]
  // starting position only, then useFrame slides it (a changing prop would make it jump)
  const [start] = useState(goal)
  useFrame((_, delta) => {
    const g = knob.current
    // snappy, so the click into a notch is felt
    if (g) g.position.x += (goal - g.position.x) * (1 - Math.exp(-delta * (dragX !== null ? 35 : 22)))
  })
  const shown = dragX !== null ? nearestNotch(xs, dragX) : position
  return (
    <group position={[0, y, FACE]}>
      <mesh position={[(left + right) / 2, 0, 0.006]}>
        <boxGeometry args={[right - left + size * 1.4, size * 0.45, 0.012]} />
        <meshStandardMaterial color="#14171c" roughness={0.6} />
      </mesh>
      {xs.map((x, t) => (
        <mesh key={t} position={[x, 0, 0.013]}>
          <circleGeometry args={[size * 0.08, 12]} />
          <meshBasicMaterial color={t === shown ? ACTIVE : '#5b6270'} toneMapped={false} />
        </mesh>
      ))}
      <group ref={knob} position={[start, 0, 0]}>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[size * 0.55, size * 0.75, 0.04]} />
          <meshStandardMaterial
            color={shown === null ? '#4a4f57' : '#c3c8cf'}
            metalness={0.85}
            roughness={0.3}
          />
        </mesh>
        {shown !== null && (
          <mesh position={[0, 0, 0.051]}>
            <boxGeometry args={[size * 0.1, size * 0.6, 0.002]} />
            <meshBasicMaterial color={ACTIVE} toneMapped={false} />
          </mesh>
        )}
      </group>
    </group>
  )
}

function PositionSwitches({ primitive, value, onChange, disabled, heading }: ModuleProps<'assign'> & { primitive: AssignPrimitive }) {
  const { step, ys } = rowLayout(primitive.items.length)
  const labelWidth = 0.36
  const trackLeft = 0.0
  const trackRight = 0.36
  const targetCount = primitive.targets.length
  const spacing = targetCount > 1 ? (trackRight - trackLeft) / (targetCount - 1) : 0
  const xs = primitive.targets.map((_, t) => (targetCount > 1 ? trackLeft + t * spacing : (trackLeft + trackRight) / 2))
  const size = Math.min(0.09, step * 0.75)
  const columnWidth = Math.min(0.16, targetCount > 1 ? spacing * 1.05 : 0.3)

  // Drag a knob left or right: it clicks from notch to notch and stays in the one it is let go in.
  // A plain click puts it straight into the notch under the pointer.
  const group = useRef<THREE.Group>(null)
  const pointerOnModule = useModulePointer(group)
  const [drag, setDrag] = useState<{ item: number; x: number } | null>(null)
  const latest = useRef({ value, onChange, drag })
  latest.current = { value, onChange, drag }
  const clampX = (x: number) => Math.min(xs[xs.length - 1] + spacing * 0.3, Math.max(xs[0] - spacing * 0.3, x))

  function grab(event: ThreeEvent<PointerEvent>, item: number) {
    event.stopPropagation()
    if (disabled) return
    const p = pointerOnModule(event.clientX, event.clientY)
    if (p) setDrag({ item, x: clampX(p.x) })
  }

  const dragItem = drag?.item ?? null
  useEffect(() => {
    if (dragItem === null) return
    const move = (e: PointerEvent) => {
      const p = pointerOnModule(e.clientX, e.clientY)
      if (p) setDrag((d) => d && { ...d, x: clampX(p.x) })
    }
    const up = () => {
      const { value: current, onChange: change, drag: d } = latest.current
      setDrag(null)
      if (!d) return
      const target = nearestNotch(xs, d.x)
      if (current[d.item] !== target) change(current.map((v, i) => (i === d.item ? target : v)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // pointerOnModule/xs only read layout that does not change during a drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragItem])

  return (
    <group ref={group}>
      <ModuleHeading text={heading} />
      <LabelStrip width={labelWidth} ys={ys} step={step} />
      {/* column headings: the targets, on a dark strip */}
      <mesh position={[(trackLeft + trackRight) / 2, ROWS_TOP + 0.045, FACE + 0.004]}>
        <boxGeometry args={[trackRight - trackLeft + 0.12, 0.05, 0.008]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>
      {primitive.targets.map((target, t) => (
        <Text
          key={t}
          font={FONT_URL}
          position={[xs[t], ROWS_TOP + 0.045, FACE + 0.012]}
          fontSize={labelSize(target, columnWidth, 0.05, 0.026)}
          maxWidth={columnWidth}
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          lineHeight={1.05}
          color="#f2f4f7"
        >
          {target}
        </Text>
      ))}
      {primitive.items.map((label, i) => (
        <group key={i}>
          <Label
            font={FONT_URL}
            position={[LABEL_LEFT, ys[i], FACE + 0.012]}
            fontSize={labelSize(label, labelWidth, step)}
            maxWidth={labelWidth - 0.02}
            anchorX="left"
            anchorY="middle"
            lineHeight={1.1}
            color="#f2f4f7"
          >
            {label}
          </Label>
          <Slide y={ys[i]} xs={xs} position={value[i]} size={size} dragX={drag?.item === i ? drag.x : null} />
          {/* the track is the handle: press anywhere on it to grab the knob */}
          <mesh
            position={[(xs[0] + xs[xs.length - 1]) / 2, ys[i], FACE + 0.13]}
            onPointerDown={(e) => grab(e, i)}
            onClick={(e) => e.stopPropagation()}
          >
            <planeGeometry args={[xs[xs.length - 1] - xs[0] + Math.max(spacing, 0.3), step * 0.95]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Switch panel on the bomb: toggle switches (on/off), or slide switches with one notch per group. */
export default function SwitchModule3D(props: Props) {
  return props.primitive.kind === 'pick' ? (
    <ToggleSwitches {...(props as ModuleProps<'pick'>)} />
  ) : (
    <PositionSwitches {...(props as ModuleProps<'assign'>)} />
  )
}
