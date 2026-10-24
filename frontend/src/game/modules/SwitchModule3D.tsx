import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import type * as THREE from 'three'
import type { AssignPrimitive, PickPrimitive } from '../primitives'
import { FACE, FONT_URL, HINT_COLOR, labelSize, ROWS_TOP, rowLayout } from './module3d'
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

function ToggleSwitches({ primitive, value, onChange, disabled }: ModuleProps<'pick'> & { primitive: PickPrimitive }) {
  const on = primitive.onLabel ?? 'AN'
  const off = primitive.offLabel ?? 'AUS'
  const { step, ys } = rowLayout(primitive.items.length)
  const labelWidth = 0.52
  // the lever must stay within its own row, also when it points down at the next one
  const size = Math.min(0.11, step * 0.62)
  const switchX = 0.2

  function flip(i: number) {
    onChange(value.includes(i) ? value.filter((v) => v !== i) : [...value, i])
  }

  return (
    <group>
      <Text font={FONT_URL} position={[LABEL_LEFT, 0.37, FACE + 0.012]} fontSize={0.032} maxWidth={0.72} anchorX="left" anchorY="middle" color={HINT_COLOR}>
        Leg die Schalter auf {on} (oben) oder {off} (unten).
      </Text>
      <LabelStrip width={labelWidth} ys={ys} step={step} />
      {primitive.items.map((label, i) => {
        const isOn = value.includes(i)
        const y = ys[i]
        return (
          <group key={i}>
            <Text
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
            </Text>
            <group position={[switchX, 0, 0]}>
              <Toggle y={y} isOn={isOn} size={size} />
            </group>
            {[
              [on, isOn, 1],
              [off, !isOn, -1],
            ].map(([text, lit, side]) => (
              <Text
                key={String(side)}
                font={FONT_URL}
                position={[switchX + size * 0.8, y + (side as number) * size * 0.4, FACE + 0.012]}
                fontSize={Math.min(0.03, step * 0.24)}
                anchorX="left"
                anchorY="middle"
                color={lit ? ACTIVE : '#5b6270'}
              >
                {text as string}
              </Text>
            ))}
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
function Slide({ y, xs, position, size }: { y: number; xs: number[]; position: number | null; size: number }) {
  const knob = useRef<THREE.Group>(null)
  const left = xs[0]
  const right = xs[xs.length - 1]
  // Not set yet: the knob waits, dimmed, in the middle of the track.
  const goal = position === null ? (left + right) / 2 : xs[position]
  // starting position only, then useFrame slides it (a changing prop would make it jump)
  const [start] = useState(goal)
  useFrame((_, delta) => {
    const g = knob.current
    if (g) g.position.x += (goal - g.position.x) * (1 - Math.exp(-delta * 18))
  })
  return (
    <group position={[0, y, FACE]}>
      <mesh position={[(left + right) / 2, 0, 0.006]}>
        <boxGeometry args={[right - left + size * 1.4, size * 0.45, 0.012]} />
        <meshStandardMaterial color="#14171c" roughness={0.6} />
      </mesh>
      {xs.map((x, t) => (
        <mesh key={t} position={[x, 0, 0.013]}>
          <circleGeometry args={[size * 0.08, 12]} />
          <meshBasicMaterial color={t === position ? ACTIVE : '#5b6270'} toneMapped={false} />
        </mesh>
      ))}
      <group ref={knob} position={[start, 0, 0]}>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[size * 0.55, size * 0.75, 0.04]} />
          <meshStandardMaterial
            color={position === null ? '#4a4f57' : '#c3c8cf'}
            metalness={0.85}
            roughness={0.3}
          />
        </mesh>
        {position !== null && (
          <mesh position={[0, 0, 0.051]}>
            <boxGeometry args={[size * 0.1, size * 0.6, 0.002]} />
            <meshBasicMaterial color={ACTIVE} toneMapped={false} />
          </mesh>
        )}
      </group>
    </group>
  )
}

function PositionSwitches({ primitive, value, onChange, disabled }: ModuleProps<'assign'> & { primitive: AssignPrimitive }) {
  const { step, ys } = rowLayout(primitive.items.length)
  const labelWidth = 0.36
  const trackLeft = 0.0
  const trackRight = 0.36
  const targetCount = primitive.targets.length
  const spacing = targetCount > 1 ? (trackRight - trackLeft) / (targetCount - 1) : 0
  const xs = primitive.targets.map((_, t) => (targetCount > 1 ? trackLeft + t * spacing : (trackLeft + trackRight) / 2))
  const size = Math.min(0.09, step * 0.75)
  const columnWidth = Math.min(0.16, targetCount > 1 ? spacing * 1.05 : 0.3)

  function set(item: number, target: number) {
    onChange(value.map((v, i) => (i === item ? target : v)))
  }

  return (
    <group>
      <Text font={FONT_URL} position={[LABEL_LEFT, 0.37, FACE + 0.012]} fontSize={0.032} maxWidth={0.72} anchorX="left" anchorY="middle" color={HINT_COLOR}>
        Schieb jeden Schalter auf die passende Spalte.
      </Text>
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
          <Text
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
          </Text>
          <Slide y={ys[i]} xs={xs} position={value[i]} size={size} />
          {/* one click target per notch */}
          {xs.map((x, t) => (
            <mesh key={t} position={[x, ys[i], FACE + 0.13]} onClick={stop(() => set(i, t), disabled)}>
              <planeGeometry args={[targetCount > 1 ? spacing : 0.3, step * 0.95]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          ))}
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
