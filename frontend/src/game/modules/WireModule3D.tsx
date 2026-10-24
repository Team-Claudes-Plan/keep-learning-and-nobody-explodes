import { useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR, labelSize, ROWS_BOTTOM, ROWS_TOP, rowLayout } from './module3d'
import type { ModuleProps } from './types'

// Same palette as the 2D wire module.
const WIRE_COLORS = ['#e5484d', '#3e63dd', '#eab308', '#30a46c', '#1f2937', '#8e4ec6', '#f76b15', '#12a594']

const LABEL_LEFT = -0.44
const LABEL_WIDTH = 0.38
const WIRE_START = 0.0
const WIRE_END = 0.38
const WIRE_RADIUS = 0.016
const CUT_GAP = 0.05

/** Wire path between the terminals, sagging slightly towards the viewer. */
function wireCurve(y: number, i: number) {
  const z = FACE + 0.03
  const wobble = (i % 2 ? 1 : -1) * 0.012
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(WIRE_START, y, z),
    new THREE.Vector3(WIRE_START + 0.12, y + wobble, z + 0.04),
    new THREE.Vector3(WIRE_END - 0.12, y - wobble, z + 0.04),
    new THREE.Vector3(WIRE_END, y, z),
  ])
}

/** The two halves of a wire cut at parameter t, both ends drooping away from the cut. */
function cutCurves(curve: THREE.CatmullRomCurve3, t: number) {
  const gap = CUT_GAP / curve.getLength() / 2
  const half = (from: number, to: number, cutEnd: 0 | 5) => {
    const points = Array.from({ length: 6 }, (_, k) => curve.getPoint(from + ((to - from) * k) / 5))
    points[cutEnd].y -= 0.035
    points[cutEnd].z -= 0.015
    return new THREE.CatmullRomCurve3(points)
  }
  return [half(0, t - gap, 5), half(t + gap, 1, 0)] as const
}

function Tube({ curve, color, glow }: { curve: THREE.Curve<THREE.Vector3>; color: string; glow?: boolean }) {
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 32, WIRE_RADIUS, 10), [curve])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        roughness={0.45}
        emissive={glow ? color : '#000000'}
        emissiveIntensity={glow ? 0.6 : 0}
      />
    </mesh>
  )
}

function Copper({ at }: { at: THREE.Vector3 }) {
  return (
    <mesh position={at}>
      <sphereGeometry args={[WIRE_RADIUS * 0.75, 8, 8]} />
      <meshStandardMaterial color="#c87533" metalness={0.9} roughness={0.3} />
    </mesh>
  )
}

function Wire({
  index,
  y,
  label,
  rowHeight,
  cutT,
  disabled,
  onCut,
}: {
  index: number
  y: number
  label: string
  rowHeight: number
  cutT: number | null
  disabled: boolean
  onCut: (t: number) => void
}) {
  const [hover, setHover] = useState(false)
  const color = WIRE_COLORS[index % WIRE_COLORS.length]
  const curve = useMemo(() => wireCurve(y, index), [y, index])
  const halves = useMemo(() => (cutT === null ? null : cutCurves(curve, cutT)), [curve, cutT])
  const clickable = !disabled && cutT === null

  function handleClick(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (!clickable) return
    const local = event.object.worldToLocal(event.point.clone())
    const t = (local.x - WIRE_START) / (WIRE_END - WIRE_START)
    onCut(Math.min(0.85, Math.max(0.15, t)))
  }

  return (
    <group>
      <Text
        font={FONT_URL}
        position={[LABEL_LEFT, y, FACE + 0.012]}
        fontSize={labelSize(label, LABEL_WIDTH, rowHeight)}
        maxWidth={LABEL_WIDTH}
        anchorX="left"
        anchorY="middle"
        lineHeight={1.1}
        color={cutT === null ? '#f2f4f7' : '#7d8590'}
      >
        {label}
      </Text>

      {[WIRE_START - 0.02, WIRE_END + 0.02].map((x) => (
        <mesh key={x} position={[x, y, FACE + 0.02]}>
          <boxGeometry args={[0.05, 0.055, 0.04]} />
          <meshStandardMaterial color="#9aa0a6" metalness={0.9} roughness={0.3} />
        </mesh>
      ))}

      {halves ? (
        <>
          <Tube curve={halves[0]} color={color} />
          <Tube curve={halves[1]} color={color} />
          <Copper at={halves[0].getPoint(1)} />
          <Copper at={halves[1].getPoint(0)} />
        </>
      ) : (
        <group
          onClick={handleClick}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHover(true)
          }}
          onPointerOut={() => setHover(false)}
        >
          <Tube curve={curve} color={color} glow={hover && clickable} />
        </group>
      )}
    </group>
  )
}

/** Wires laid out for the question: one labelled wire per answer, click a wire to cut it. */
export default function WireModule3D({ primitive, value, onChange, disabled }: ModuleProps<'pick'>) {
  /** Where each wire was cut, as curve parameter. */
  const [cutAt, setCutAt] = useState<Record<number, number>>({})
  const { step, ys } = rowLayout(primitive.items.length)

  const hint =
    primitive.mode === 'one' ? 'Schneide das richtige Kabel durch.' : 'Schneide die falschen Antworten durch.'

  return (
    <group>
      <Text
        font={FONT_URL}
        position={[LABEL_LEFT, 0.37, FACE + 0.012]}
        fontSize={0.032}
        maxWidth={0.72}
        anchorX="left"
        anchorY="middle"
        color={HINT_COLOR}
      >
        {hint}
      </Text>

      {/* dark label strip, so labels read well on the metal plate */}
      <mesh position={[LABEL_LEFT + LABEL_WIDTH / 2 - 0.01, (ROWS_TOP + ROWS_BOTTOM) / 2, FACE + 0.004]}>
        <boxGeometry args={[LABEL_WIDTH + 0.03, ROWS_TOP - ROWS_BOTTOM + step * 0.8, 0.008]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>

      {primitive.items.map((label, i) => (
        <Wire
          key={i}
          index={i}
          y={ys[i]}
          label={label}
          rowHeight={step}
          cutT={value.includes(i) ? (cutAt[i] ?? 0.5) : null}
          disabled={disabled}
          onCut={(t) => {
            setCutAt((prev) => ({ ...prev, [i]: t }))
            onChange([...value, i])
          }}
        />
      ))}
    </group>
  )
}
