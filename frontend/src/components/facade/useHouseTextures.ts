import { use, useMemo } from 'react'
import {
  CanvasTexture,
  LinearSRGBColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three'
import type { BaseDesign, FacadeTextures, PartRegion, TextureSlot, WallAtlas } from '../../data/facadeTypes'
import { DEFAULT_WALL_ATLAS } from '../../data/houseParts'
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

type BaseTextures = { textures: FacadeTextures; procedural: boolean }
type Resource<T> = { promise: Promise<T> }

const baseCache = new Map<string, Resource<BaseTextures>>()
const wallCache = new Map<string, Resource<WallTextures>>()

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

function getBase(setId: string, design: BaseDesign): Resource<BaseTextures> {
  const set = TEXTURE_SETS[setId]
  const hasFiles = Boolean(set && Object.keys(set.files).length > 0)
  const key = hasFiles ? setId : `${setId}::${design.id}`
  const cached = baseCache.get(key)
  if (cached) return cached

  const promise: Promise<BaseTextures> =
    hasFiles && set
      ? loadTextureSet(set).then((textures) => ({ textures, procedural: false }))
      : Promise.resolve().then(() => ({
          textures: createProceduralTextures(setId, design),
          procedural: true,
        }))

  const resource: Resource<BaseTextures> = { promise }
  baseCache.set(key, resource)
  return resource
}

function sliceTexture(source: Texture, region: PartRegion): Texture {
  const image = source.image as CanvasImageSource & { width: number; height: number }
  const sx = Math.round(image.width * region.x)
  const sy = Math.round(image.height * region.y)
  const sw = Math.max(1, Math.round(image.width * region.w))
  const sh = Math.max(1, Math.round(image.height * region.h))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')
  context.drawImage(image, sx, sy, sw, sh, 0, 0, sw, sh)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = source.colorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

export type WallTextures = { outer: FacadeTextures; inner: FacadeTextures }

function atlasKey(atlas: WallAtlas): string {
  const region = (part: PartRegion) => `${part.x},${part.y},${part.w},${part.h}`
  return `${region(atlas.outer)}|${region(atlas.inner)}`
}

function getWall(setId: string, design: BaseDesign, atlas: WallAtlas): Resource<WallTextures> {
  const key = `${setId}::${design.id}::${atlasKey(atlas)}`
  const cached = wallCache.get(key)
  if (cached) return cached

  const promise = getBase(setId, design).promise.then(({ textures, procedural }): WallTextures => {
    if (procedural) return { outer: textures, inner: {} }

    const outer: FacadeTextures = {}
    const inner: FacadeTextures = {}
    for (const slot of SLOTS) {
      const texture = textures[slot]
      if (!texture) continue
      outer[slot] = sliceTexture(texture, atlas.outer)
      inner[slot] = sliceTexture(texture, atlas.inner)
    }
    return { outer, inner }
  })

  const resource: Resource<WallTextures> = { promise }
  wallCache.set(key, resource)
  return resource
}

export function useWallTextures(
  setId: string,
  design: BaseDesign,
  atlas: WallAtlas = DEFAULT_WALL_ATLAS,
): WallTextures {
  const resource = useMemo(() => getWall(setId, design, atlas), [setId, design, atlas])
  return use(resource.promise)
}

export function useHouseTextures(setId: string, design: BaseDesign): FacadeTextures {
  return useWallTextures(setId, design).outer
}
