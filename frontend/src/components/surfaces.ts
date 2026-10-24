import { MeshStandardMaterial, RepeatWrapping, type Material, type MeshStandardMaterialParameters, type Texture } from 'three'
import type { FacadeTextures } from '../data/facadeTypes'

export type SurfaceSpec = {
  textures: FacadeTextures
  color: string
  emissive?: string
  emissiveIntensity?: number
  roughness?: number
  metalness?: number
  tileWidth: number
  tileHeight: number
}

export function cloneRepeat(source: Texture, repeatX: number, repeatY: number): Texture {
  const clone = source.clone()
  clone.wrapS = RepeatWrapping
  clone.wrapT = RepeatWrapping
  clone.repeat.set(Math.max(1, Math.round(repeatX)), Math.max(1, Math.round(repeatY)))
  clone.needsUpdate = true
  return clone
}

export function createTiledMaterial(
  spec: SurfaceSpec,
  faceWidth: number,
  faceHeight: number,
  glow = 0,
): MeshStandardMaterial {
  const { textures } = spec
  const hasAlbedo = Boolean(textures.albedo)
  const hasEmissive = Boolean(textures.emissive)
  const intensity = spec.emissiveIntensity ?? 0

  const params: MeshStandardMaterialParameters = {
    color: hasAlbedo ? '#ffffff' : spec.color,
    roughness: spec.roughness ?? 0.8,
    metalness: spec.metalness ?? 0,
    emissive: hasEmissive ? '#ffffff' : spec.emissive ?? spec.color,
    emissiveIntensity: hasEmissive ? intensity * (1 + glow) : spec.emissiveIntensity ?? 0,
  }

  const material = new MeshStandardMaterial(params)
  const repeatX = faceWidth / spec.tileWidth
  const repeatY = faceHeight / spec.tileHeight
  if (textures.albedo) material.map = cloneRepeat(textures.albedo, repeatX, repeatY)
  if (textures.emissive) material.emissiveMap = cloneRepeat(textures.emissive, repeatX, repeatY)
  if (textures.normal) material.normalMap = cloneRepeat(textures.normal, repeatX, repeatY)
  if (textures.roughness) material.roughnessMap = cloneRepeat(textures.roughness, repeatX, repeatY)
  return material
}

export function disposeMaterials(materials: (Material | null | undefined)[]) {
  for (const material of materials) {
    if (!material || !(material instanceof MeshStandardMaterial)) continue
    material.map?.dispose()
    material.emissiveMap?.dispose()
    material.normalMap?.dispose()
    material.roughnessMap?.dispose()
    material.dispose()
  }
}
