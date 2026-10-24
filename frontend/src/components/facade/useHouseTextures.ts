import { use, useMemo } from 'react'
import { LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import type { BaseDesign, FacadeTextures, TextureSlot } from '../../data/facadeTypes'
import { createProceduralTextures } from './facadeTexture'

const textureModules = import.meta.glob('/src/assets/house-*/*.{png,jpg,jpeg,webp}', {
  eager: false,
  import: 'default',
}) as Record<string, () => Promise<string>>

const SLOTS: TextureSlot[] = ['albedo', 'emissive', 'normal', 'roughness']

type TextureSet = { setId: string; files: Partial<Record<TextureSlot, string>> }

function discoverTextureSets(): Record<string, TextureSet> {
  const sets: Record<string, TextureSet> = {}
  for (const path of Object.keys(textureModules)) {
    const match = path.match(/\/(house-[^/]+)\/([^/.]+)\.[a-z]+$/i)
    if (!match) continue
    const [, setId, slot] = match
    if (!SLOTS.includes(slot as TextureSlot)) continue
    const set = (sets[setId] ??= { setId, files: {} })
    set.files[slot as TextureSlot] = path
  }
  return sets
}

const TEXTURE_SETS = discoverTextureSets()

type Resource = { promise: Promise<FacadeTextures> }
const cache = new Map<string, Resource>()

async function loadTextureSet(set: TextureSet): Promise<FacadeTextures> {
  const loader = new TextureLoader()
  const entries = await Promise.all(
    (Object.entries(set.files) as [TextureSlot, string][]).map(async ([slot, path]) => {
      const loaderFn = textureModules[path]
      if (!loaderFn) return null
      const url = await loaderFn()
      const texture: Texture = await loader.loadAsync(url)
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.colorSpace =
        slot === 'albedo' || slot === 'emissive' ? SRGBColorSpace : LinearSRGBColorSpace
      texture.anisotropy = 4
      return [slot, texture] as const
    }),
  )

  const textures: FacadeTextures = {}
  for (const entry of entries) {
    if (entry) textures[entry[0]] = entry[1]
  }
  return textures
}

function getResource(setId: string, design: BaseDesign): Resource {
  const set = TEXTURE_SETS[setId]
  const hasFiles = Boolean(set && Object.keys(set.files).length > 0)
  const key = hasFiles ? setId : `${setId}::${design.id}`
  const cached = cache.get(key)
  if (cached) return cached

  const promise =
    hasFiles && set
      ? loadTextureSet(set)
      : Promise.resolve().then(() => createProceduralTextures(setId, design))

  const resource: Resource = { promise }
  cache.set(key, resource)
  return resource
}

export function useHouseTextures(setId: string, design: BaseDesign): FacadeTextures {
  const resource = useMemo(() => getResource(setId, design), [setId, design])
  return use(resource.promise)
}
