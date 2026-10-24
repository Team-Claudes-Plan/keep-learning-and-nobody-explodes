import { Euler, Matrix4, Vector3 } from 'three'

export const ISO_CAMERA = {
  position: [10, 10, 10] as [number, number, number],
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

export const ROOM_MIN_ZOOM = 140
export const ROOM_WALL_Z = -1.3
