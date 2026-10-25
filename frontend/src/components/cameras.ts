import { Euler, Matrix4, Vector3 } from 'three'

export const ISO_CAMERA = {
  // Far back along the view line: the camera is orthographic, so distance only decides what the
  // near plane cuts. At 10 it sliced through tall front houses once the view panned back.
  position: [40, 40, 40] as [number, number, number],
  zoom: 60,
}

const ROOM_EYE: [number, number, number] = [0, 2.6, 9]
const ROOM_TARGET: [number, number, number] = [0, 0.8, 0]

/** Fixed view into a room: no pan or zoom. Created already aimed at the target. */
export const ROOM_CAMERA = {
  position: ROOM_EYE,
  zoom: 340,
  target: ROOM_TARGET,
  rotation: new Euler()
    .setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...ROOM_EYE), new Vector3(...ROOM_TARGET), new Vector3(0, 1, 0)))
    .toArray()
    .slice(0, 3) as [number, number, number],
}

export const ROOM_MIN_ZOOM = 120

/** World area that must stay visible in the room: the bomb table with its top and a bit of its legs. */
const ROOM_VIEW_HEIGHT = 2.4
const ROOM_VIEW_WIDTH = 2.6

/** Room zoom for a viewport: the full zoom on large screens, zoomed out on small ones so the table stays in view. */
export function roomZoom(size: { width: number; height: number }) {
  const fit = Math.min(size.height / ROOM_VIEW_HEIGHT, size.width / ROOM_VIEW_WIDTH)
  return Math.min(ROOM_CAMERA.zoom, Math.max(ROOM_MIN_ZOOM, fit))
}
export const ROOM_WALL_Z = -1.3
