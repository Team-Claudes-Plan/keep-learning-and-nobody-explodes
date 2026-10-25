import { Suspense, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { Vec2 } from '../../data/life'
import { animatePart, collectAnimatedParts } from '../facade/animatedParts'

/** Built in Blender by scripts/blender/construction.py. */
const SITE_URL = '/models/construction/site.glb'

function Site() {
  const { scene } = useGLTF(SITE_URL)
  const model = useMemo(() => scene.clone(true), [scene])
  const parts = useMemo(() => collectAnimatedParts(model), [model])

  useFrame(({ clock }) => {
    for (const part of parts) animatePart(part, clock.elapsedTime)
  })

  return <primitive object={model} />
}

/** The cell where new houses go up while an upload is being processed. */
export default function ConstructionSite({ position }: { position: Vec2 }) {
  return (
    <group position={[position[0], 0, position[1]]}>
      <Suspense fallback={null}>
        <Site />
      </Suspense>
    </group>
  )
}

useGLTF.preload(SITE_URL)
