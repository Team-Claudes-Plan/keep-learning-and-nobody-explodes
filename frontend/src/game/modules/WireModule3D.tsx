import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR, labelSize, ROWS_BOTTOM, ROWS_TOP, rowLayout, useModulePointer } from './module3d'
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

/** Jaw opening of the cutter (radians per half), and how long a snip takes to close and reopen. */
const CUTTER_OPEN = 0.28
const SNIP_SECONDS = 0.28
/** The cutter hovers above the wires; its jaw tips sit at the pointer. */
const CUTTER_Z = FACE + 0.13
/** How the cutter is held (tilt), and its jaw length from tip to pivot. */
const CUTTER_TILT = -0.45
const JAW_LENGTH = 0.085
/** How far below the lowest wire the cutter still shows; further down the normal pointer is back. */
const CUTTER_MARGIN = 0.05

/** Jaw from tip (at the pointer) to pivot, in module space. */
const JAW = { x: JAW_LENGTH * Math.sin(CUTTER_TILT), y: -JAW_LENGTH * Math.cos(CUTTER_TILT) }

/**
 * The uncut wire lying between the open jaws, if any: the whole cutting edge cuts, not just the tip.
 * Returns the wire and where along it the cut goes.
 */
function wireInJaws(p: THREE.Vector3, ys: number[], uncut: (i: number) => boolean) {
  const reach = WIRE_RADIUS + 0.014 // wire thickness and its slight wobble
  const middle = p.y + JAW.y / 2
  let best: { wire: number; t: number } | null = null
  let bestDistance = Infinity
  ys.forEach((y, i) => {
    if (!uncut(i) || y > p.y + reach || y < p.y + JAW.y - reach) return
    const u = THREE.MathUtils.clamp((y - p.y) / JAW.y, 0, 1)
    const t = (p.x + u * JAW.x - WIRE_START) / (WIRE_END - WIRE_START)
    if (t < 0.05 || t > 0.95 || Math.abs(y - middle) >= bestDistance) return
    best = { wire: i, t: THREE.MathUtils.clamp(t, 0.15, 0.85) }
    bestDistance = Math.abs(y - middle)
  })
  return best as { wire: number; t: number } | null
}

/** One half of the side cutter: steel jaw above the pivot, red rubber handle below it. */
function CutterHalf({ side, half }: { side: 1 | -1; half: RefObject<THREE.Group | null> }) {
  return (
    <group ref={half}>
      {/* jaw: tapers to a sharp tip at the pointer */}
      <mesh position={[side * 0.009, 0.042, 0]} rotation={[0, 0, side * 0.12]} raycast={() => null}>
        <cylinderGeometry args={[0.004, 0.014, 0.085, 4]} />
        <meshStandardMaterial color="#c9ced6" metalness={0.95} roughness={0.2} />
      </mesh>
      {/* shank between jaw and grip */}
      <mesh position={[side * 0.016, -0.03, 0]} rotation={[0, 0, side * 0.12]} raycast={() => null}>
        <boxGeometry args={[0.016, 0.06, 0.012]} />
        <meshStandardMaterial color="#9aa0a6" metalness={0.9} roughness={0.3} />
      </mesh>
      {/* grip */}
      <mesh position={[side * 0.034, -0.15, 0]} rotation={[0, 0, side * 0.14]} raycast={() => null}>
        <capsuleGeometry args={[0.016, 0.17, 6, 12]} />
        <meshStandardMaterial color="#d23a3a" roughness={0.55} />
      </mesh>
    </group>
  )
}

/**
 * Side cutter that follows the pointer over the module while it is open; every new `snips` count
 * (one per cut wire) makes its jaws snap shut and open again.
 */
function Cutter({
  active,
  snips,
  bottom,
  onAim,
}: {
  active: boolean
  snips: number
  /** Lowest pointer height the cutter shows at (just below the last wire). */
  bottom: number
  onAim: (p: THREE.Vector3 | null) => void
}) {
  /** Fixed at the module origin, so the pointer is mapped into module space (not the moving tool's). */
  const anchor = useRef<THREE.Group>(null)
  const group = useRef<THREE.Group>(null)
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const pointerOnModule = useModulePointer(anchor)
  const at = useRef<THREE.Vector3 | null>(null)
  /** Clock time of the last snip; a new one is stamped on the next frame. */
  const snipAt = useRef(-Infinity)
  const pending = useRef(false)
  useEffect(() => {
    if (snips > 0) pending.current = true
  }, [snips])

  useEffect(() => {
    if (!active) return
    const move = (e: PointerEvent) => {
      const p = pointerOnModule(e.clientX, e.clientY)
      // only while the pointer is over the module plate
      at.current = p && Math.abs(p.x) < 0.5 && p.y < 0.5 && p.y > bottom ? p : null
      document.body.style.cursor = at.current ? 'none' : ''
      onAim(at.current)
    }
    window.addEventListener('pointermove', move)
    return () => {
      window.removeEventListener('pointermove', move)
      document.body.style.cursor = ''
      at.current = null
      onAim(null)
    }
  }, [active, bottom, pointerOnModule, onAim])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g || !left.current || !right.current) return
    if (pending.current) {
      pending.current = false
      snipAt.current = clock.elapsedTime
    }
    g.visible = active && at.current !== null
    if (at.current) g.position.set(at.current.x, at.current.y, CUTTER_Z)
    const t = (clock.elapsedTime - snipAt.current) / SNIP_SECONDS
    // shut fast (first quarter), then ease open again
    const open = t < 0 || t > 1 ? 1 : t < 0.25 ? 1 - t / 0.25 : (t - 0.25) / 0.75
    left.current.rotation.z = CUTTER_OPEN * open
    right.current.rotation.z = -CUTTER_OPEN * open
  })

  return (
    <group ref={anchor}>
      <group ref={group} visible={false}>
        {/* tilted like a hand holds it; the pivot sits below the tips */}
        <group rotation={[0, 0, CUTTER_TILT]}>
          <group position={[0, -JAW_LENGTH, 0]}>
            <CutterHalf side={-1} half={left} />
            <CutterHalf side={1} half={right} />
            {/* pivot rivet */}
            <mesh position={[0, 0, 0.009]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.012, 0.012, 0.006, 16]} />
              <meshStandardMaterial color="#5b6270" metalness={0.9} roughness={0.3} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

function Wire({
  index,
  y,
  label,
  rowHeight,
  cutT,
  aimed,
}: {
  index: number
  y: number
  label: string
  rowHeight: number
  cutT: number | null
  /** Lies between the cutter's jaws: the next click cuts it. */
  aimed: boolean
}) {
  const color = WIRE_COLORS[index % WIRE_COLORS.length]
  const curve = useMemo(() => wireCurve(y, index), [y, index])
  const halves = useMemo(() => (cutT === null ? null : cutCurves(curve, cutT)), [curve, cutT])

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
        <Tube curve={curve} color={color} glow={aimed} />
      )}
    </group>
  )
}

/** Wires laid out for the question: one labelled wire per answer, cut with the side cutter. */
export default function WireModule3D({ primitive, value, onChange, disabled }: ModuleProps<'pick'>) {
  /** Where each wire was cut, as curve parameter. */
  const [cutAt, setCutAt] = useState<Record<number, number>>({})
  /** Wires cut so far, for the cutter's snip animation. */
  const [snips, setSnips] = useState(0)
  const { step, ys } = rowLayout(primitive.items.length)
  // The cutter only reaches down to just below the last wire (the lock-in button sits further down).
  const cutterBottom = ys[ys.length - 1] - CUTTER_MARGIN
  /** Wire between the cutter's jaws right now, and where it would be cut. */
  const [aim, setAim] = useState<{ wire: number; t: number } | null>(null)
  const uncut = (i: number) => !value.includes(i)
  const latest = useRef({ ys, uncut })
  latest.current = { ys, uncut }
  const onAim = useCallback((p: THREE.Vector3 | null) => {
    const next = p && wireInJaws(p, latest.current.ys, latest.current.uncut)
    setAim((prev) => (prev?.wire === next?.wire && prev?.t === next?.t ? prev : (next ?? null)))
  }, [])

  function snip(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (disabled || !aim || !uncut(aim.wire)) return
    setSnips((n) => n + 1)
    setCutAt((prev) => ({ ...prev, [aim.wire]: aim.t }))
    onChange([...value, aim.wire])
    setAim(null)
  }

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
          aimed={!disabled && aim?.wire === i}
        />
      ))}
      {/* clicks over the wires go to the cutter; below them they reach the lock-in button */}
      {!disabled && (
        <mesh position={[0, (0.5 + cutterBottom) / 2, FACE + 0.1]} onClick={snip}>
          <planeGeometry args={[1, 0.5 - cutterBottom]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {/* the cutter in hand, above everything else */}
      <Cutter active={!disabled} snips={snips} bottom={cutterBottom} onAim={onAim} />
    </group>
  )
}
