import { useEffect, useMemo, useRef, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { FACE, FONT_URL, HINT_COLOR, labelSize, ROWS_BOTTOM, ROWS_TOP, rowLayout, useModulePointer } from './module3d'
import type { ModuleProps } from './types'

// Same palette as the 2D cable module.
const CABLE_COLORS = ['#e5484d', '#3e63dd', '#eab308', '#30a46c', '#8e4ec6', '#f76b15', '#12a594', '#1f2937']

const LEFT_LABEL_X = -0.44
const LEFT_LABEL_WIDTH = 0.3
const PLUG_X = -0.1
const SOCKET_X = 0.13
const RIGHT_LABEL_X = 0.19
const RIGHT_LABEL_WIDTH = 0.25
const Z = FACE + 0.03
const CABLE_RADIUS = 0.013
/** The cable end snaps into a socket within this distance of it... */
const SNAP_IN = 0.06
/** ...and only snaps back out once pulled this far away, so it does not chatter at the edge. */
const SNAP_OUT = 0.09

/** Cable in hand: the pointer position and the socket its end is snapped into, if any. */
type Drag = { item: number; at: THREE.Vector3; snapped: number | null }

/** Height step between cable layers; more than a cable's thickness at the crossing point. */
const LAYER_LIFT = 0.045

/**
 * Cable from a plug to a point, bowing out towards the viewer. Each cable bows out to its own
 * layer, so crossing cables run over each other instead of through each other.
 */
function cableCurve(from: THREE.Vector3, to: THREE.Vector3, layer: number) {
  const bend = Math.max(0.06, Math.abs(to.x - from.x) * 0.4)
  const lift = 0.05 + layer * LAYER_LIFT
  return new THREE.CubicBezierCurve3(
    from,
    new THREE.Vector3(from.x + bend, from.y, from.z + lift),
    new THREE.Vector3(to.x - bend, to.y, to.z + lift),
    to,
  )
}

function Cable({ from, to, color, layer }: { from: THREE.Vector3; to: THREE.Vector3; color: string; layer: number }) {
  const geometry = useMemo(
    () => new THREE.TubeGeometry(cableCurve(from, to, layer), 32, CABLE_RADIUS, 8),
    [from, to, layer],
  )
  return (
    <mesh geometry={geometry} raycast={() => null}>
      <meshStandardMaterial color={color} roughness={0.45} />
    </mesh>
  )
}

/**
 * Patch panel on the bomb: drag a plug from the left onto a socket on the right.
 * Matching allows one cable per socket; grouping lets several cables share one.
 */
export default function CableModule3D({ primitive, value, onChange, disabled }: ModuleProps<'assign'>) {
  const group = useRef<THREE.Group>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  const itemCount = primitive.items.length
  const targetCount = primitive.targets.length
  const left = useMemo(() => rowLayout(itemCount, 0.12), [itemCount])
  const right = useMemo(() => rowLayout(targetCount, 0.16), [targetCount])
  const plugs = useMemo(() => left.ys.map((y) => new THREE.Vector3(PLUG_X, y, Z)), [left])
  const sockets = useMemo(() => right.ys.map((y) => new THREE.Vector3(SOCKET_X, y, Z)), [right])

  // Dragging follows the real pointer (window events + a ray onto the module plate), so it never
  // breaks off when the pointer moves fast, leaves the module or passes over the HTML card.
  const pointerOnModule = useModulePointer(group)
  const latest = useRef({ value, onChange, unique: primitive.unique })
  latest.current = { value, onChange, unique: primitive.unique }

  /** Socket the cable end at p is snapped into: stays in while close, else the nearest one in reach. */
  function snapFor(p: THREE.Vector3, snapped: number | null) {
    const dist = (j: number) => Math.hypot(p.x - sockets[j].x, p.y - sockets[j].y)
    if (snapped !== null && dist(snapped) < SNAP_OUT) return snapped
    let best: number | null = null
    let bestDist = Math.min(SNAP_IN, right.step * 0.45)
    sockets.forEach((_, j) => {
      if (dist(j) < bestDist) {
        best = j
        bestDist = dist(j)
      }
    })
    return best as number | null
  }

  function startDrag(event: ThreeEvent<PointerEvent>, item: number) {
    event.stopPropagation()
    if (disabled) return
    // Grabbing a connected plug pulls its cable out.
    if (value[item] !== null) onChange(value.map((v, i) => (i === item ? null : v)))
    setDrag({ item, at: pointerOnModule(event.clientX, event.clientY)?.setZ(Z) ?? plugs[item].clone(), snapped: null })
  }

  const dragItem = drag?.item ?? null
  const dragRef = useRef(drag)
  dragRef.current = drag
  useEffect(() => {
    if (dragItem === null) return
    const move = (e: PointerEvent) => {
      const at = pointerOnModule(e.clientX, e.clientY)?.setZ(Z)
      if (at) setDrag((d) => d && { item: dragItem, at, snapped: snapFor(at, d.snapped) })
    }
    const up = () => {
      // drops into the socket the cable end is snapped into, if any
      const target = dragRef.current?.snapped ?? null
      if (target !== null) {
        const { value: current, onChange: change, unique } = latest.current
        change(
          current.map((v, i) => {
            if (i === dragItem) return target
            // Matching: a socket takes only one cable.
            if (unique && v === target) return null
            return v
          }),
        )
      }
      setDrag(null)
    }
    const cancel = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    // pointerOnModule/snapFor only read refs and layout that do not change during a drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragItem])

  return (
    <group ref={group}>
      <Text font={FONT_URL} position={[-0.44, 0.37, FACE + 0.012]} fontSize={0.032} anchorX="left" anchorY="middle" color={HINT_COLOR}>
        Stecker in die passende Buchse ziehen.
      </Text>

      {/* dark label strips */}
      <mesh position={[LEFT_LABEL_X + LEFT_LABEL_WIDTH / 2 - 0.01, (ROWS_TOP + ROWS_BOTTOM) / 2, FACE + 0.004]}>
        <boxGeometry args={[LEFT_LABEL_WIDTH + 0.03, ROWS_TOP - ROWS_BOTTOM + 0.1, 0.008]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>
      <mesh position={[RIGHT_LABEL_X + RIGHT_LABEL_WIDTH / 2 - 0.01, (ROWS_TOP + ROWS_BOTTOM) / 2, FACE + 0.004]}>
        <boxGeometry args={[RIGHT_LABEL_WIDTH + 0.03, ROWS_TOP - ROWS_BOTTOM + 0.1, 0.008]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>

      {primitive.items.map((label, i) => {
        const connected = value[i] !== null
        const color = CABLE_COLORS[i % CABLE_COLORS.length]
        return (
          <group key={`item-${i}`}>
            <Text
              font={FONT_URL}
              position={[LEFT_LABEL_X, left.ys[i], FACE + 0.012]}
              fontSize={labelSize(label, LEFT_LABEL_WIDTH, left.step)}
              maxWidth={LEFT_LABEL_WIDTH - 0.02}
              anchorX="left"
              anchorY="middle"
              lineHeight={1.1}
              color="#f2f4f7"
            >
              {label}
            </Text>
            {/* the whole row (label + plug) is the grab handle */}
            <mesh
              position={[(LEFT_LABEL_X + PLUG_X + 0.04) / 2, left.ys[i], Z + 0.03]}
              onPointerDown={(e) => startDrag(e, i)}
            >
              <planeGeometry args={[PLUG_X + 0.04 - LEFT_LABEL_X, Math.min(left.step, 0.12) * 0.95]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <mesh position={plugs[i]} rotation={[Math.PI / 2, 0, 0]} raycast={() => null}>
              <cylinderGeometry args={[0.024, 0.024, 0.05, 16]} />
              <meshStandardMaterial
                color={color}
                roughness={0.4}
                emissive={drag?.item === i ? color : '#000000'}
                emissiveIntensity={drag?.item === i ? 0.5 : 0}
              />
            </mesh>
            {connected && <Cable from={plugs[i]} to={sockets[value[i]!]} color={color} layer={i} />}
          </group>
        )
      })}

      {primitive.targets.map((label, j) => (
        <group key={`target-${j}`}>
          <mesh position={sockets[j]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.032, 0.032, 0.03, 20]} />
            <meshStandardMaterial
              color="#1b1e24"
              metalness={0.6}
              roughness={0.35}
            />
          </mesh>
          <Text
            font={FONT_URL}
            position={[RIGHT_LABEL_X, right.ys[j], FACE + 0.012]}
            fontSize={labelSize(label, RIGHT_LABEL_WIDTH, right.step)}
            maxWidth={RIGHT_LABEL_WIDTH - 0.02}
            anchorX="left"
            anchorY="middle"
            lineHeight={1.1}
            color="#f2f4f7"
          >
            {label}
          </Text>
        </group>
      ))}

      {drag && (
        <>
          {/* the cable in hand follows the pointer, above all plugged-in ones */}
          <Cable
            from={plugs[drag.item]}
            to={drag.snapped !== null ? sockets[drag.snapped] : drag.at}
            color={CABLE_COLORS[drag.item % CABLE_COLORS.length]}
            layer={primitive.items.length}
          />
        </>
      )}
    </group>
  )
}
