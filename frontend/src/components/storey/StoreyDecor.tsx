import { Suspense, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { Mesh, MeshStandardMaterial } from 'three'
import { shadeHex, type DecorKind } from '../../data/houseParts'

/** Built in Blender by scripts/blender/storey_decor.py. Origin on the floor, back on the wall, real metres. */
const DECOR_URLS: Record<DecorKind, string> = {
  flowerPot: '/models/storey/flowerPot.glb',
  lamp: '/models/storey/lamp.glb',
  bench: '/models/storey/bench.glb',
  vine: '/models/storey/vine.glb',
}

/** Materials that light up (lampshade, bulb) and glow brighter when the storey is hovered. */
const LIGHT_MATERIALS = new Set(['Shade', 'Bulb'])

type StoreyDecorProps = {
  kind: DecorKind
  color: string
  glow: number
}

function DecorModel({ kind, color, glow }: StoreyDecorProps) {
  const { scene } = useGLTF(DECOR_URLS[kind])

  // Own copy with own materials: Accent parts take the house colour.
  const { model, tinted, lights } = useMemo(() => {
    const model = scene.clone(true)
    const tinted: MeshStandardMaterial[] = []
    const lights: { material: MeshStandardMaterial; base: number }[] = []
    const colors: Record<string, string> = { Accent: color, AccentDark: shadeHex(color, -0.15) }
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const material = (child.material as MeshStandardMaterial).clone()
      const tint = colors[material.name]
      if (tint) {
        material.color.set(tint)
        material.emissive.set(tint)
        tinted.push(material)
      } else if (LIGHT_MATERIALS.has(material.name)) {
        lights.push({ material, base: material.emissiveIntensity })
      }
      child.material = material
    })
    return { model, tinted, lights }
  }, [scene, color])

  useEffect(() => {
    for (const material of tinted) material.emissiveIntensity = 0.05 + glow * 0.25
    for (const { material, base } of lights) material.emissiveIntensity = base * (1 + glow * 0.8)
  }, [tinted, lights, glow])

  useEffect(
    () => () => model.traverse((child) => child instanceof Mesh && (child.material as MeshStandardMaterial).dispose()),
    [model],
  )

  return <primitive object={model} />
}

export default function StoreyDecor(props: StoreyDecorProps) {
  return (
    <Suspense fallback={null}>
      <DecorModel {...props} />
    </Suspense>
  )
}

for (const url of Object.values(DECOR_URLS)) useGLTF.preload(url)
