import { Quaternion, Vector3, type Object3D } from 'three'

// Moving parts of the Blender models (house kits, the construction site): nodes tagged with glTF
// extras `anim`, `axis` and optional `speed` / `amplitude`.

/**
 * A moving part of a kit (globe, robot arm, tree, ...). The Blender script tags these nodes
 * with glTF extras: anim, axis and optional speed / amplitude.
 */
export type AnimatedPart = {
  node: Object3D
  anim: 'spin' | 'swing' | 'wobble' | 'blink'
  axis: Vector3
  speed: number
  amplitude: number
  /** Random offset so houses of the same kind don't move in lockstep. */
  phase: number
  rest: Quaternion
  nextBlink: number
}

const BLINK_TIME = 0.16
const X_AXIS = new Vector3(1, 0, 0)
const Z_AXIS = new Vector3(0, 0, 1)
const turn = new Quaternion()
const turnB = new Quaternion()

export function collectAnimatedParts(root: Object3D): AnimatedPart[] {
  const parts: AnimatedPart[] = []
  root.traverse((node) => {
    const { anim, axis, speed, amplitude } = node.userData
    if (!anim) return
    parts.push({
      node,
      anim,
      axis: new Vector3(...((axis as [number, number, number] | undefined) ?? [0, 1, 0])).normalize(),
      speed: Number(speed ?? 1),
      amplitude: Number(amplitude ?? 0.1),
      phase: Math.random() * Math.PI * 2,
      rest: node.quaternion.clone(),
      nextBlink: 1 + Math.random() * 4,
    })
  })
  return parts
}

/** 0 = eyes open, 1 = shut. A quick close-and-open over BLINK_TIME seconds. */
function blinkAmount(part: AnimatedPart, time: number): number {
  if (time > part.nextBlink + BLINK_TIME) {
    // Mostly single blinks every few seconds, sometimes a quick double blink.
    part.nextBlink = Math.random() < 0.2 ? time + 0.12 : time + 2 + Math.random() * 5
  }
  const t = (time - part.nextBlink) / BLINK_TIME
  return t < 0 || t > 1 ? 0 : Math.sin(t * Math.PI)
}

export function animatePart(part: AnimatedPart, time: number) {
  const { node, axis, speed, amplitude, phase, rest } = part
  switch (part.anim) {
    case 'spin':
      turn.setFromAxisAngle(axis, time * speed + phase)
      node.quaternion.copy(rest).premultiply(turn)
      break
    case 'swing':
      turn.setFromAxisAngle(axis, amplitude * Math.sin(time * speed + phase))
      node.quaternion.copy(rest).premultiply(turn)
      break
    case 'wobble':
      // Two slightly different frequencies so the sway never quite repeats.
      turn.setFromAxisAngle(X_AXIS, amplitude * Math.sin(time * 1.3 + phase))
      turnB.setFromAxisAngle(Z_AXIS, amplitude * Math.sin(time * 1.7 + phase * 2))
      node.quaternion.copy(rest).premultiply(turn).premultiply(turnB)
      break
    case 'blink':
      node.scale.y = Math.max(0.08, 1 - blinkAmount(part, time))
      break
  }
}
