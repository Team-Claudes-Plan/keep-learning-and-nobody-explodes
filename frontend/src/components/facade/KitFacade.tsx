import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Box3, Color, Group, Mesh, MeshStandardMaterial, Plane, Vector3, type Material, type Object3D } from 'three'
import { HOUSE_KITS, type HouseKitId } from '../../data/houseKits'
import { animatePart, collectAnimatedParts } from './animatedParts'

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
