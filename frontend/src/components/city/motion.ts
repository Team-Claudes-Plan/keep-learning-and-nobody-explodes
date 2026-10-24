import type { Vec2 } from '../../data/life'

type Segment = {
  x: number
  z: number
  dx: number
  dz: number
  length: number
}

export type PathMetrics = {
  segments: Segment[]
  total: number
}

export function buildPath(points: Vec2[]): PathMetrics {
  const segments = points.map((point, index) => {
    const next = points[(index + 1) % points.length]
    const dx = next[0] - point[0]
    const dz = next[1] - point[1]
    return { x: point[0], z: point[1], dx, dz, length: Math.hypot(dx, dz) }
  })
  const total = segments.reduce((sum, segment) => sum + segment.length, 0)
  return { segments, total }
}

export function samplePath(
  metrics: PathMetrics,
  distance: number,
): { x: number; z: number; heading: number } {
  const { segments, total } = metrics
  if (total === 0) return { x: 0, z: 0, heading: 0 }

  let remaining = ((distance % total) + total) % total
  for (const segment of segments) {
    if (remaining > segment.length) {
      remaining -= segment.length
      continue
    }
    const t = segment.length === 0 ? 0 : remaining / segment.length
    return {
      x: segment.x + segment.dx * t,
      z: segment.z + segment.dz * t,
      heading: Math.atan2(-segment.dz, segment.dx),
    }
  }

  const last = segments[segments.length - 1]
  return { x: last.x + last.dx, z: last.z + last.dz, heading: Math.atan2(-last.dz, last.dx) }
}
