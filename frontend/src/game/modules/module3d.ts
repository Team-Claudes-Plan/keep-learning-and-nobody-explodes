import { useCallback, type RefObject } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Shared constants for 3D modules. Module space (see public/models/bomb/manifest.json):
// 1×1 plate centred on the origin, front face at z = FACE, +Y up, status LED in the top-right corner.

export const FACE = 0.08

/** Bundled font for 3D labels (Inter, OFL), so nothing is fetched from a CDN. */
export const FONT_URL = '/fonts/inter-latin-600.woff'

/** Colour of the instruction line at the top of a module. */
export const HINT_COLOR = '#ffb547'

/** Area below the instruction line that rows of controls are spread over. */
export const ROWS_TOP = 0.24
/** Leaves the bottom strip free for the lock-in button. */
export const ROWS_BOTTOM = -0.28

/** Evenly spaced rows between ROWS_TOP and ROWS_BOTTOM, at most `maxStep` apart and centred. */
export function rowLayout(count: number, maxStep = 0.13) {
  const step = count > 1 ? Math.min(maxStep, (ROWS_TOP - ROWS_BOTTOM) / (count - 1)) : 0
  const first = (ROWS_TOP + ROWS_BOTTOM) / 2 + (step * (count - 1)) / 2
  return { step: step || maxStep, ys: Array.from({ length: count }, (_, i) => first - i * step) }
}

/** Font size that lets a label fit into a box of the given width and row height. */
export function labelSize(label: string, width: number, rowHeight: number, max = 0.042) {
  const area = width * rowHeight * 0.85
  return Math.min(max, rowHeight * 0.36, Math.sqrt(area / (Math.max(label.length, 1) * 0.6)))
}

/**
 * Maps a pointer position (clientX/Y) onto the module plate, in module space. Used for drags that
 * follow window pointer events, so they keep working when the pointer leaves the module.
 */
export function useModulePointer(group: RefObject<THREE.Group | null>) {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  return useCallback(
    (clientX: number, clientY: number) => {
      const g = group.current
      if (!g) return null
      const rect = canvas.getBoundingClientRect()
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(ndc, camera)
      const origin = g.localToWorld(new THREE.Vector3(0, 0, FACE))
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(g.matrixWorld)
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin)
      const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
      if (!hit) return null
      const local = g.worldToLocal(hit)
      local.z = FACE
      return local
    },
    [camera, canvas, group],
  )
}
