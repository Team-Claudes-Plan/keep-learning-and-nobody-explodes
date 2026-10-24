export type TextureSlot = 'albedo' | 'emissive' | 'normal' | 'roughness'

export type WallPart = 'outer' | 'inner'

export type PartRegion = {
  x: number
  y: number
  w: number
  h: number
}

export type WallAtlas = Record<WallPart, PartRegion>

export type RoofShape = 'flat' | 'antenna' | 'dome' | 'canopy' | 'foliage'

export type FacadeDetailKind = 'robotArm' | 'solarFin' | 'coil' | 'dish' | 'planter' | 'vine'

export type DetailAnchor = {
  kind: FacadeDetailKind
  color: string
  scale?: number
  tier?: number
  offset?: [number, number, number]
}

export type Tier = {
  width: number
  depth: number
  y: number
  height: number
}

export type FacadeShape = {
  id: string
  label: string
  roof: RoofShape
  roofColor: string
  details: DetailAnchor[]
  buildTiers: (footprint: [number, number], totalHeight: number) => Tier[]
}

export type BaseDesign = {
  id: string
  label: string
  material: {
    tint: string
    roughness: number
    metalness: number
    emissiveIntensity: number
  }
  maps: TextureSlot[]
  tiling: {
    tileWidth: number
    tileHeight: number
  }
}

export type FacadeConfig = {
  shape: string
  design: string
  textures: string
  roofColor?: string
  atlas?: WallAtlas
}

export type FacadeTextures = Partial<Record<TextureSlot, import('three').Texture>>
