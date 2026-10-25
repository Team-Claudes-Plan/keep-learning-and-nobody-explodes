import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { FACE, FONT_URL, labelSize, rowLayout, useModulePointer } from './module3d'
import { Label, ModuleHeading, PlateText } from './Label3D'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const NUMBER_X = -0.4
const BLOCK_X = 0.04
const BLOCK_WIDTH = 0.74

type BlockProps = {
  label: string
  /** Where the block should be (it slides there); while dragged it follows the pointer instead. */
  y: number
  height: number
  dragging: boolean
  disabled: boolean
  onGrab: (event: ThreeEvent<PointerEvent>) => void
}

/** A block on the rail: slides to its slot, lifts up while it is being dragged. */
function Block({ label, y, height, dragging, disabled, onGrab }: BlockProps) {
  const ref = useRef<THREE.Group>(null)
  // Starting position only: after that useFrame moves the block. Passing the changing y as a prop
  // would reset the whole position (lift included) on every render, so the block would pulse.
  const [start] = useState(y)
  useFrame((_, delta) => {
    const g = ref.current
    if (!g) return
    const k = dragging ? 1 : 1 - Math.exp(-delta * 18)
    g.position.y += (y - g.position.y) * k
    g.position.z += ((dragging ? 0.05 : 0) - g.position.z) * (1 - Math.exp(-delta * 20))
  })
  return (
    <group ref={ref} position={[BLOCK_X, start, 0]}>
      <mesh position={[0, 0, FACE + 0.025]} onPointerDown={onGrab}>
        <boxGeometry args={[BLOCK_WIDTH, height, 0.04]} />
        <meshStandardMaterial
          color={dragging ? '#3a4150' : '#2a2f38'}
          metalness={0.4}
          roughness={0.5}
          emissive={dragging ? ACTIVE : '#000000'}
          emissiveIntensity={dragging ? 0.08 : 0}
        />
      </mesh>
      {/* grip lines on the left end */}
      {[-1, 0, 1].map((k) => (
        <mesh key={k} position={[-BLOCK_WIDTH / 2 + 0.035 + k * 0.012, 0, FACE + 0.046]} raycast={() => null}>
          <planeGeometry args={[0.005, height * 0.5]} />
          <meshBasicMaterial color={disabled ? '#5b6270' : '#9aa3b2'} />
        </mesh>
      ))}
      <Label
        font={FONT_URL}
        position={[-BLOCK_WIDTH / 2 + 0.07, 0, FACE + 0.046]}
        raycast={() => null}
        fontSize={labelSize(label, BLOCK_WIDTH - 0.1, height * 1.1)}
        maxWidth={BLOCK_WIDTH - 0.1}
        anchorX="left"
        anchorY="middle"
        lineHeight={1.1}
        color="#f2f4f7"
      >
        {label}
      </Label>
    </group>
  )
}

/** Block in hand: its height, the slot it would land in, and where on the block it was grabbed. */
type Drag = { item: number; y: number; insertAt: number; offset: number }

/** The landing slot only changes once the block is this far (in steps) from it, so it does not flicker at the border. */
const SLOT_HOLD = 0.65

/** Sliding blocks on the bomb: drag them up or down into the right order (top = first). */
export default function SliderModule3D({ primitive, value, onChange, disabled, heading }: ModuleProps<'sequence'>) {
  const group = useRef<THREE.Group>(null)
  const pointerOnModule = useModulePointer(group)
  const [drag, setDrag] = useState<Drag | null>(null)
  const { step, ys } = rowLayout(primitive.items.length, 0.12)
  const height = step * 0.82

  /** Slot a block at height y lands in: stays with the current one until clearly past the border. */
  function slotAt(y: number, current: number) {
    if (Math.abs(ys[current] - y) < step * SLOT_HOLD) return current
    let best = 0
    ys.forEach((slotY, k) => {
      if (Math.abs(slotY - y) < Math.abs(ys[best] - y)) best = k
    })
    return best
  }

  function grab(event: ThreeEvent<PointerEvent>, item: number) {
    event.stopPropagation()
    if (disabled) return
    const at = value.indexOf(item)
    // keep the spot where it was grabbed under the pointer, instead of jumping to the block's middle
    const p = pointerOnModule(event.clientX, event.clientY)
    setDrag({ item, y: ys[at], insertAt: at, offset: p ? p.y - ys[at] : 0 })
  }

  const latest = useRef({ value, onChange, drag })
  latest.current = { value, onChange, drag }
  const dragItem = drag?.item ?? null
  useEffect(() => {
    if (dragItem === null) return
    const move = (e: PointerEvent) => {
      const p = pointerOnModule(e.clientX, e.clientY)
      if (!p) return
      setDrag((d) => {
        if (!d) return d
        const y = THREE.MathUtils.clamp(p.y - d.offset, ys[ys.length - 1], ys[0])
        return { ...d, y, insertAt: slotAt(y, d.insertAt) }
      })
    }
    const up = () => {
      const { value: order, onChange: change, drag: d } = latest.current
      setDrag(null)
      if (!d) return
      const rest = order.filter((v) => v !== d.item)
      rest.splice(d.insertAt, 0, d.item)
      if (rest.some((v, k) => v !== order[k])) change(rest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    // pointerOnModule/slotAt only read layout that does not change during a drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragItem])

  // While dragging, the other blocks close up and leave a gap where the dragged one would land.
  const others = drag ? value.filter((v) => v !== drag.item) : value
  const slotOf = new Map<number, number>()
  others.forEach((item, k) => slotOf.set(item, drag && k >= drag.insertAt ? k + 1 : k))

  return (
    <group ref={group}>
      <ModuleHeading text={heading} />
      {/* rail with numbered slots */}
      <mesh position={[BLOCK_X, (ys[0] + ys[ys.length - 1]) / 2, FACE + 0.003]}>
        <boxGeometry args={[BLOCK_WIDTH + 0.03, ys[0] - ys[ys.length - 1] + step, 0.006]} />
        <meshStandardMaterial color="#0d1014" roughness={0.8} />
      </mesh>
      {ys.map((y, k) => (
        <PlateText
          key={k}
          text={`${k + 1}.`}
          position={[NUMBER_X, y, FACE + 0.014]}
          fontSize={Math.min(0.04, step * 0.4)}
          color={drag && drag.insertAt === k ? ACTIVE : '#d4d8de'}
        />
      ))}
      {primitive.items.map((label, item) => {
        const dragging = drag?.item === item
        return (
          <Block
            key={item}
            label={label}
            y={dragging ? drag.y : ys[slotOf.get(item) ?? 0]}
            height={height}
            dragging={dragging}
            disabled={disabled}
            onGrab={(e) => grab(e, item)}
          />
        )
      })}
    </group>
  )
}
