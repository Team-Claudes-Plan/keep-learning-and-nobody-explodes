import type { BaseDesign } from './facadeTypes'

export const BASE_DESIGNS: Record<string, BaseDesign> = {
  'glass-grid': {
    id: 'glass-grid',
    label: 'Glass grid',
    material: { tint: '#33405c', roughness: 0.28, metalness: 0.45, emissiveIntensity: 0.9 },
    maps: ['albedo', 'emissive'],
    tiling: { tileWidth: 1.1, tileHeight: 1.0 },
  },

  panel: {
    id: 'panel',
    label: 'Panel',
    material: { tint: '#4a5468', roughness: 0.55, metalness: 0.6, emissiveIntensity: 0.7 },
    maps: ['albedo', 'emissive', 'roughness'],
    tiling: { tileWidth: 1.0, tileHeight: 1.0 },
  },

  'organic-bark': {
    id: 'organic-bark',
    label: 'Organic bark',
    material: { tint: '#4a6b3f', roughness: 0.9, metalness: 0.0, emissiveIntensity: 0.5 },
    maps: ['albedo', 'emissive'],
    tiling: { tileWidth: 1.3, tileHeight: 0.9 },
  },
}

export function resolveDesign(id: string): BaseDesign {
  return BASE_DESIGNS[id] ?? BASE_DESIGNS['glass-grid']
}
