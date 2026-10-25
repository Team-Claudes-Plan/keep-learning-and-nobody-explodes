import { useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { BridgeSpan } from '../../data/islands'
import { playSfx } from '../../audio/sfx'

const DECK_Y = 0.1
/** Height of the arch at the middle, relative to the bridge length. */
const ARCH_RATIO = 0.09
const DECK_WIDTH = 1.3
const PLANK_STEP = 0.34
const POST_STEP = 1.4
const POST_SIZE = 0.1
const RAIL_HEIGHT = 0.55

const PLANK_COLORS = ['#9a6b43', '#8a5d38', '#a57650']
const POST_COLOR = '#5e4029'
const HOVER_COLOR = '#d9a066'

type BridgeProps = {
  span: BridgeSpan
  /** Index of the island in view; the label shows on the side the viewer is on. */
  activeIndex: number
  leftName: string
  rightName: string
  onCross: (toIndex: number) => void
}

/** Wooden arch bridge between two neighbouring islands. Clicking it crosses to the other one. */
export default function Bridge({ span, activeIndex, leftName, rightName, onCross }: BridgeProps) {
  const [hovered, setHovered] = useState(false)
  const [sx, sz] = span.start
  const [ex, ez] = span.end
  const length = Math.hypot(ex - sx, ez - sz)
  const heading = Math.atan2(-(ez - sz), ex - sx)
  const arch = length * ARCH_RATIO
  const deckY = (t: number) => DECK_Y + arch * Math.sin(Math.PI * t)

  const planks = useMemo(() => {
    const count = Math.floor(length / PLANK_STEP)
    return Array.from({ length: count }, (_, index) => {
      const t = (index + 0.5) / count
      const slope = (arch * Math.PI * Math.cos(Math.PI * t)) / length
      return { x: (t - 0.5) * length, y: DECK_Y + arch * Math.sin(Math.PI * t), tilt: Math.atan(slope), index }
    })
  }, [length, arch])

  const posts = useMemo(() => {
    const count = Math.max(2, Math.round(length / POST_STEP) + 1)
    return Array.from({ length: count }, (_, index) => index / (count - 1))
  }, [length])

  const toIndex = activeIndex <= span.leftIndex ? span.leftIndex + 1 : span.leftIndex
  const onLeft = activeIndex <= span.leftIndex

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    playSfx('bridge')
    onCross(toIndex)
  }
  const handleOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()
    setHovered(true)
    document.body.style.cursor = 'pointer'
  }
  const handleOut = () => {
    setHovered(false)
    document.body.style.cursor = 'auto'
  }

  return (
    <group
      position={[(sx + ex) / 2, 0, (sz + ez) / 2]}
      rotation-y={heading}
      onClick={handleClick}
      onPointerOver={handleOver}
      onPointerOut={handleOut}
    >
      {planks.map((plank) => (
        <mesh key={plank.index} position={[plank.x, plank.y, 0]} rotation-z={plank.tilt}>
          <boxGeometry args={[PLANK_STEP * 0.86, 0.08, DECK_WIDTH]} />
          <meshStandardMaterial
            color={hovered ? HOVER_COLOR : PLANK_COLORS[plank.index % PLANK_COLORS.length]}
            roughness={1}
            flatShading
          />
        </mesh>
      ))}

      {[-1, 1].map((side) =>
        posts.map((t) => (
          <mesh key={`${side}-${t}`} position={[(t - 0.5) * length, deckY(t) + RAIL_HEIGHT / 2, (side * DECK_WIDTH) / 2]}>
            <boxGeometry args={[POST_SIZE, RAIL_HEIGHT, POST_SIZE]} />
            <meshStandardMaterial color={POST_COLOR} roughness={1} flatShading />
          </mesh>
        )),
      )}

      {[-1, 1].map((side) =>
        posts.slice(1).map((t, index) => {
          const t0 = posts[index]
          const x0 = (t0 - 0.5) * length
          const x1 = (t - 0.5) * length
          const y0 = deckY(t0) + RAIL_HEIGHT
          const y1 = deckY(t) + RAIL_HEIGHT
          return (
            <mesh
              key={`rail-${side}-${t}`}
              position={[(x0 + x1) / 2, (y0 + y1) / 2, (side * DECK_WIDTH) / 2]}
              rotation-z={Math.atan2(y1 - y0, x1 - x0)}
            >
              <boxGeometry args={[Math.hypot(x1 - x0, y1 - y0) + 0.06, 0.07, 0.07]} />
              <meshStandardMaterial color={POST_COLOR} roughness={1} flatShading />
            </mesh>
          )
        }),
      )}

      {/* Invisible box so the whole bridge, gaps included, is easy to click. */}
      <mesh position={[0, DECK_Y + arch / 2 + 0.2, 0]}>
        <boxGeometry args={[length, arch + 0.8, DECK_WIDTH + 0.3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      <Html
        position={[(onLeft ? -0.32 : 0.32) * length, DECK_Y + arch + 0.9, 0]}
        center
        zIndexRange={[0, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className={`island-sign${hovered ? ' is-hovered' : ''}`}>
          {onLeft ? `${rightName} →` : `← ${leftName}`}
        </div>
      </Html>
    </group>
  )
}
