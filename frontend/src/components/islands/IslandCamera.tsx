import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrthographicCamera, Vector3 } from 'three'
import { SCREEN_RIGHT, clampToShoreline, type Vec2 } from '../../data/island'
import { VIEW_SIDE_REACH } from '../../data/islands'

/** Seconds the view takes to scroll from one island to the next. */
const SCROLL_SECONDS = 1.3

type Controls = { target: Vector3; enabled: boolean; minZoom: number; update: () => void }

const [RIGHT_X, RIGHT_Z] = SCREEN_RIGHT

type Scroll = { from: Vec2; to: Vec2; t: number }

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * Keeps the view on the active island: jumps there on first render, scrolls sideways when the
 * active island changes, and otherwise keeps panning inside that island's shoreline. Zooming out
 * and panning sideways stop once the edge of a neighbouring island comes into view.
 */
export default function IslandCamera({ center, minZoom }: { center: Vec2; minZoom: number }) {
  const camera = useThree((state) => state.camera) as OrthographicCamera
  const width = useThree((state) => state.size.width)
  const controls = useThree((state) => state.controls) as Controls | null
  const shown = useRef<Vec2 | null>(null)
  const scroll = useRef<Scroll | null>(null)

  useFrame((_, delta) => {
    if (!controls) return
    const target = controls.target
    const moveTo = (x: number, z: number) => {
      if (x === target.x && z === target.z) return
      camera.position.x += x - target.x
      camera.position.z += z - target.z
      target.x = x
      target.z = z
      controls.update()
    }

    if (!shown.current) {
      shown.current = center
      moveTo(center[0], center[1])
      return
    }

    if (shown.current[0] !== center[0] || shown.current[1] !== center[1]) {
      shown.current = center
      scroll.current = { from: [target.x, target.z], to: center, t: 0 }
      controls.enabled = false
    }

    const active = scroll.current
    if (active) {
      active.t = Math.min(1, active.t + delta / SCROLL_SECONDS)
      const f = easeInOut(active.t)
      moveTo(active.from[0] + (active.to[0] - active.from[0]) * f, active.from[1] + (active.to[1] - active.from[1]) * f)
      if (active.t >= 1) {
        scroll.current = null
        controls.enabled = true
      }
      return
    }

    // Half the screen spans width / 2 / zoom world units along SCREEN_RIGHT (the camera never
    // rotates). Keep target ± that within VIEW_SIDE_REACH, zooming in first if even the center can't.
    const sideZoom = width / 2 / VIEW_SIDE_REACH
    controls.minZoom = Math.max(minZoom, sideZoom)
    if (camera.zoom < controls.minZoom) {
      camera.zoom = controls.minZoom
      camera.updateProjectionMatrix()
    }
    const maxSide = VIEW_SIDE_REACH - width / 2 / camera.zoom

    const [x, z] = clampToShoreline(target.x - center[0], target.z - center[1])
    const side = x * RIGHT_X + z * RIGHT_Z
    const shift = Math.max(-maxSide, Math.min(maxSide, side)) - side
    moveTo(x + shift * RIGHT_X + center[0], z + shift * RIGHT_Z + center[1])
  })

  return null
}
