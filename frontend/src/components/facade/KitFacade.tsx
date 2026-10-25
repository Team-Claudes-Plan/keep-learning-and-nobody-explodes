import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Color, Group, Mesh, MeshStandardMaterial, Plane, Quaternion, Vector3, type Material, type Object3D } from 'three'
import { HOUSE_KITS, type HouseKitId } from '../../data/houseKits'

type ModuleName = 'base' | 'middle' | 'top'

type KitFacadeProps = {
  kit: HouseKitId
  footprint: [number, number]
  /** One entry per storey, bottom first. The first uses the base module, the rest repeat the middle. */
  storeyHeights: number[]
  hovered: boolean
  /**
   * World-space box to cut out of the kit (used to open the front of the house view).
   * Everything inside it is hidden and the kit stops catching pointer events.
   * Needs `gl.localClippingEnabled` (SceneCanvas turns it on).
   */
  cutaway?: { min: [number, number, number]; max: [number, number, number] }
}

/** Planes whose clipped sides intersect in exactly the cutaway box (used with clipIntersection). */
function cutawayPlanes({ min, max }: NonNullable<KitFacadeProps['cutaway']>): Plane[] {
  return [
    new Plane(new Vector3(-1, 0, 0), min[0]),
    new Plane(new Vector3(1, 0, 0), -max[0]),
    new Plane(new Vector3(0, -1, 0), min[1]),
    new Plane(new Vector3(0, 1, 0), -max[1]),
    new Plane(new Vector3(0, 0, -1), min[2]),
    new Plane(new Vector3(0, 0, 1), -max[2]),
  ]
}

const noRaycast = () => {}

type GlowState = { emissive: Color; intensity: number }

/**
 * A moving part of a kit (globe, robot arm, tree, ...). The Blender script tags these nodes
 * with glTF extras: anim, axis and optional speed / amplitude.
 */
type AnimatedPart = {
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

function collectAnimatedParts(root: Object3D): AnimatedPart[] {
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

function animatePart(part: AnimatedPart, time: number) {
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

function findModule(scene: Object3D, name: ModuleName): Object3D {
  let found: Object3D | undefined
  scene.traverse((child) => {
    if (!found && child.userData.module === name) found = child
  })
  if (!found) throw new Error(`House kit is missing its "${name}" module`)
  return found
}

/** Deep-clones a module and swaps in this house's own materials, so hover glow stays per house. */
function cloneModule(source: Object3D, materials: Map<Material, MeshStandardMaterial>): Object3D {
  const clone = source.clone(true)
  clone.position.set(0, 0, 0)
  clone.traverse((child) => {
    if (!(child instanceof Mesh)) return
    const original = child.material as Material
    let material = materials.get(original)
    if (!material) {
      material = (original as MeshStandardMaterial).clone()
      material.userData.glow = {
        emissive: material.emissive.clone(),
        intensity: material.emissiveIntensity,
      } satisfies GlowState
      materials.set(original, material)
    }
    child.material = material
  })
  return clone
}

function applyGlow(material: MeshStandardMaterial, glow: number) {
  const base = material.userData.glow as GlowState
  const lit = base.emissive.r + base.emissive.g + base.emissive.b > 0
  if (lit) {
    material.emissive.copy(base.emissive)
    material.emissiveIntensity = base.intensity * (1 + glow * 1.2)
  } else {
    // Unlit surfaces get a faint lift of their own colour when hovered.
    material.emissive.copy(material.color)
    material.emissiveIntensity = glow * 0.12
  }
}

/** Height of the kit's roof crown above the top storey, as KitFacade draws it. */
export function useKitCrownHeight(kit: HouseKitId): number {
  const { scene } = useGLTF(HOUSE_KITS[kit].url)
  return useMemo(() => {
    const crown = findModule(scene, 'top').clone(true)
    crown.position.set(0, 0, 0)
    crown.updateMatrixWorld(true)
    return Math.max(0, new Box3().setFromObject(crown).max.y)
  }, [scene])
}

export default function KitFacade({ kit, footprint, storeyHeights, hovered, cutaway }: KitFacadeProps) {
  const { scene } = useGLTF(HOUSE_KITS[kit].url)

  const { group, materials, parts } = useMemo(() => {
    const base = findModule(scene, 'base')
    const middle = findModule(scene, 'middle')
    const top = findModule(scene, 'top')
    const baseHeight = Number(base.userData.height)
    const middleHeight = Number(middle.userData.height)
    const [kitW, kitD] = (base.userData.footprint as [number, number] | undefined) ?? footprint

    const materials = new Map<Material, MeshStandardMaterial>()
    const group = new Group()
    group.scale.set(footprint[0] / kitW, 1, footprint[1] / kitD)

    let y = 0
    storeyHeights.forEach((height, index) => {
      const source = index === 0 ? base : middle
      const module = cloneModule(source, materials)
      module.position.y = y
      module.scale.y = height / (index === 0 ? baseHeight : middleHeight)
      group.add(module)
      y += height
    })

    const crown = cloneModule(top, materials)
    crown.position.y = y
    group.add(crown)

    if (cutaway) {
      const planes = cutawayPlanes(cutaway)
      for (const material of materials.values()) {
        material.clippingPlanes = planes
        material.clipIntersection = true
      }
      group.traverse((child) => {
        if (child instanceof Mesh) child.raycast = noRaycast
      })
    }

    return { group, materials: [...materials.values()], parts: collectAnimatedParts(group) }
  }, [scene, footprint, storeyHeights, cutaway])

  useFrame(({ clock }) => {
    const time = clock.elapsedTime
    for (const part of parts) animatePart(part, time)
  })

  useEffect(() => {
    for (const material of materials) applyGlow(material, hovered ? 1 : 0)
  }, [materials, hovered])

  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])

  return <primitive object={group} />
}

for (const kit of Object.values(HOUSE_KITS)) useGLTF.preload(kit.url)
