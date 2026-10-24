import { useEffect, useMemo } from 'react'
import { MeshStandardMaterial, type Material, type MeshStandardMaterialParameters } from 'three'
import type { BaseDesign, FacadeTextures, Tier } from '../../data/facadeTypes'
import { resolveDesign } from '../../data/baseDesigns'
import { resolveShape } from '../../data/facadeShapes'
import type { House } from '../../data/houses'
import { houseHeight } from '../../data/houses'
import { cloneRepeat, disposeMaterials } from '../surfaces'
import { useHouseTextures } from './useHouseTextures'
import Roof from './roofs'
import DetailProp from './details'

function createTierMaterials(
  tier: Tier,
  textures: FacadeTextures,
  design: BaseDesign,
  glow: number,
): Material[] {
  const { tileWidth, tileHeight } = design.tiling
  const sideX = tier.width / tileWidth
  const sideZ = tier.depth / tileWidth
  const rows = tier.height / tileHeight
  const repeats: [number, number][] = [
    [sideX, rows],
    [sideX, rows],
    [sideZ, sideX],
    [sideZ, sideX],
    [sideZ, rows],
    [sideZ, rows],
  ]

  const hasAlbedo = Boolean(textures.albedo)
  const hasEmissive = Boolean(textures.emissive)

  return repeats.map(([repeatX, repeatY]) => {
    const params: MeshStandardMaterialParameters = {
      color: hasAlbedo ? '#ffffff' : design.material.tint,
      roughness: design.material.roughness,
      metalness: design.material.metalness,
      emissive: hasEmissive ? '#ffffff' : design.material.tint,
      emissiveIntensity: hasEmissive ? design.material.emissiveIntensity * (1 + glow) : 0,
    }
    const material = new MeshStandardMaterial(params)
    if (textures.albedo) material.map = cloneRepeat(textures.albedo, repeatX, repeatY)
    if (textures.emissive) material.emissiveMap = cloneRepeat(textures.emissive, repeatX, repeatY)
    if (textures.normal) material.normalMap = cloneRepeat(textures.normal, repeatX, repeatY)
    if (textures.roughness) material.roughnessMap = cloneRepeat(textures.roughness, repeatX, repeatY)
    return material
  })
}

function disposeTierMaterials(materialSets: Material[][]) {
  disposeMaterials(materialSets.flat())
}

type FacadeProps = {
  house: House
  shapeId: string
  designId: string
  hovered: boolean
  roofColor?: string
}

export default function Facade({ house, shapeId, designId, hovered, roofColor }: FacadeProps) {
  const shape = resolveShape(shapeId)
  const design = resolveDesign(designId)
  const textures = useHouseTextures(house.facade.textures, design)

  const height = houseHeight(house)
  const glow = hovered ? 1 : 0

  const tiers = useMemo(
    () => shape.buildTiers(house.footprint, height),
    [shape, house.footprint, height],
  )

  const materialSets = useMemo(
    () => tiers.map((tier) => createTierMaterials(tier, textures, design, glow)),
    [tiers, textures, design, glow],
  )

  useEffect(() => () => disposeTierMaterials(materialSets), [materialSets])

  const top = tiers[tiers.length - 1]
  const roofColorResolved = roofColor ?? shape.roofColor

  return (
    <group>
      {tiers.map((tier, index) => (
        <mesh
          key={index}
          position={[0, tier.y + tier.height / 2, 0]}
          material={materialSets[index]}
        >
          <boxGeometry args={[tier.width, tier.height, tier.depth]} />
        </mesh>
      ))}

      <Roof
        kind={shape.roof}
        width={top.width}
        depth={top.depth}
        y={top.y + top.height}
        color={roofColorResolved}
        glow={glow}
      />

      {shape.details.map((detail, index) => {
        const tier = tiers[Math.min(detail.tier ?? 0, tiers.length - 1)]
        const offset = detail.offset ?? [0, 0, 0]
        const position: [number, number, number] = [
          offset[0] * tier.width,
          tier.y + tier.height / 2 + offset[1] * tier.height,
          offset[2] * tier.depth,
        ]
        return (
          <group key={index} position={position}>
            <DetailProp kind={detail.kind} color={detail.color} scale={detail.scale} glow={glow} />
          </group>
        )
      })}
    </group>
  )
}
