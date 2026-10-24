import type { FacadeShape, Tier } from './facadeTypes'

type Band = { frac: number; scaleW: number; scaleD: number }

function stack(footprint: [number, number], totalHeight: number, bands: Band[]): Tier[] {
  const [w, d] = footprint
  let y = 0
  return bands.map((band) => {
    const height = totalHeight * band.frac
    const tier: Tier = { width: w * band.scaleW, depth: d * band.scaleD, y, height }
    y += height
    return tier
  })
}

export const FACADE_SHAPES: Record<string, FacadeShape> = {
  slab: {
    id: 'slab',
    label: 'Slab',
    roof: 'flat',
    roofColor: '#1c2438',
    details: [],
    buildTiers: (footprint, totalHeight) =>
      stack(footprint, totalHeight, [{ frac: 1, scaleW: 1, scaleD: 1 }]),
  },

  'tiered-setback': {
    id: 'tiered-setback',
    label: 'Tiered setback',
    roof: 'flat',
    roofColor: '#1c2438',
    details: [
      { kind: 'robotArm', color: '#6ea8fe', tier: 1, offset: [0.55, 0.5, 0] },
      { kind: 'dish', color: '#c9d4e6', tier: 2, offset: [-0.5, 0.4, 0.4] },
    ],
    buildTiers: (footprint, totalHeight) =>
      stack(footprint, totalHeight, [
        { frac: 0.5, scaleW: 1, scaleD: 1 },
        { frac: 0.3, scaleW: 0.78, scaleD: 0.78 },
        { frac: 0.2, scaleW: 0.56, scaleD: 0.56 },
      ]),
  },

  spire: {
    id: 'spire',
    label: 'Spire',
    roof: 'antenna',
    roofColor: '#c9d4e6',
    details: [
      { kind: 'solarFin', color: '#4fd1d1', tier: 0, offset: [0.62, 0.6, 0] },
      { kind: 'coil', color: '#ff8f4f', tier: 1, offset: [-0.55, 0.5, 0] },
    ],
    buildTiers: (footprint, totalHeight) =>
      stack(footprint, totalHeight, [
        { frac: 0.68, scaleW: 1, scaleD: 1 },
        { frac: 0.2, scaleW: 0.68, scaleD: 0.68 },
        { frac: 0.12, scaleW: 0.36, scaleD: 0.36 },
      ]),
  },

  penthouse: {
    id: 'penthouse',
    label: 'Penthouse',
    roof: 'flat',
    roofColor: '#263550',
    details: [
      { kind: 'dish', color: '#c9d4e6', tier: 2, offset: [-0.4, 0.5, 0.4] },
      { kind: 'solarFin', color: '#4fd1d1', tier: 1, offset: [0.7, 0.5, 0] },
    ],
    buildTiers: (footprint, totalHeight) =>
      stack(footprint, totalHeight, [
        { frac: 0.75, scaleW: 1, scaleD: 1 },
        { frac: 0.15, scaleW: 1.15, scaleD: 1.15 },
        { frac: 0.1, scaleW: 0.7, scaleD: 0.7 },
      ]),
  },

  'tree-tower': {
    id: 'tree-tower',
    label: 'Tree tower',
    roof: 'foliage',
    roofColor: '#4fd18b',
    details: [
      { kind: 'planter', color: '#4fd18b', tier: 1, offset: [0.5, 0.15, 0.5] },
      { kind: 'vine', color: '#2f9e63', tier: 0, offset: [-0.5, 0.5, 0.5] },
      { kind: 'vine', color: '#2f9e63', tier: 1, offset: [0.5, 0.5, -0.5] },
    ],
    buildTiers: (footprint, totalHeight) =>
      stack(footprint, totalHeight, [
        { frac: 0.45, scaleW: 0.5, scaleD: 0.5 },
        { frac: 0.3, scaleW: 1, scaleD: 1 },
        { frac: 0.25, scaleW: 0.82, scaleD: 0.82 },
      ]),
  },
}

export function resolveShape(id: string): FacadeShape {
  return FACADE_SHAPES[id] ?? FACADE_SHAPES.slab
}
