import { useMemo } from 'react'
import type { FacadeTextures } from '../../data/facadeTypes'
import type { InteriorDesign } from '../../data/interiorTypes'
import { createInteriorTextures } from './interiorTexture'

const cache = new Map<string, FacadeTextures>()

export function useInteriorTextures(seed: string, design: InteriorDesign): FacadeTextures {
  return useMemo(() => {
    const key = `${seed}:${design.motif}:${design.floor}:${design.accent}`
    const cached = cache.get(key)
    if (cached) return cached
    const textures = createInteriorTextures(seed, design)
    cache.set(key, textures)
    return textures
  }, [seed, design])
}
