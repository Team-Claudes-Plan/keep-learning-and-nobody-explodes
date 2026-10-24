import { Suspense, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { Mesh, MeshStandardMaterial } from 'three'
import { shadeHex } from '../../data/houseParts'

/** Built in Blender by scripts/blender/storey_props.py: a 0.5 x 1.0 m leaf, origin at its centre, back on the wall. */
const DOOR_URL = '/models/storey/door.glb'
const MODEL_W = 0.5
const MODEL_H = 1.0

type DoorProps = {
  width: number
  height: number
  color: string
  frameColor: string
  glow: number
}

function DoorModel({ width, height, color, frameColor, glow }: DoorProps) {
  const { scene } = useGLTF(DOOR_URL)

  // Own copy with own materials, recoloured for this house.
  const { model, tinted } = useMemo(() => {
    const model = scene.clone(true)
    const tinted: MeshStandardMaterial[] = []
    const colors: Record<string, string> = {
      Door: color,
      DoorPanel: shadeHex(color, -0.08),
      Frame: frameColor,
    }
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const material = (child.material as MeshStandardMaterial).clone()
      const tint = colors[material.name]
      if (tint) {
        material.color.set(tint)
        material.emissive.set(tint)
        tinted.push(material)
      }
      child.material = material
    })
    return { model, tinted }
  }, [scene, color, frameColor])

  useEffect(() => {
    for (const material of tinted) material.emissiveIntensity = 0.05 + glow * 0.25
  }, [tinted, glow])

  useEffect(
    () => () => model.traverse((child) => child instanceof Mesh && (child.material as MeshStandardMaterial).dispose()),
    [model],
  )

  return <primitive object={model} scale={[width / MODEL_W, height / MODEL_H, 1]} />
}

export default function Door(props: DoorProps) {
  return (
    <Suspense fallback={null}>
      <DoorModel {...props} />
    </Suspense>
  )
}

useGLTF.preload(DOOR_URL)
