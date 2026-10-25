import { useSyncExternalStore, type CSSProperties } from 'react'
import { getCloudPhase, subscribeCloudPhase } from './cloudTransition'
import './cloudTransition.css'

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Cloud = { x: number; y: number; w: number; ox: number; oy: number; din: number; dout: number }

// A jittered grid of big clouds covering the viewport. Each one flies in from
// (and leaves towards) the screen edge it sits closest to.
const CLOUDS: Cloud[] = (() => {
  const rand = prng(42)
  const cols = 5
  const rows = 4
  const clouds: Cloud[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -6 + (c / (cols - 1)) * 112 + (rand() - 0.5) * 12
      const y = -4 + (r / (rows - 1)) * 108 + (rand() - 0.5) * 12
      let dx = x - 50
      let dy = (y - 50) * 0.8
      const len = Math.hypot(dx, dy)
      if (len < 8) {
        const a = rand() * Math.PI * 2
        dx = Math.cos(a)
        dy = Math.sin(a)
      } else {
        dx /= len
        dy /= len
      }
      clouds.push({
        x,
        y,
        w: 48 + rand() * 22,
        ox: dx * 120,
        oy: dy * 120,
        din: Math.round(rand() * 130),
        dout: Math.round(rand() * 120),
      })
    }
  }
  // Draw the centre clouds last so they sit on top while covering.
  return clouds.sort((a, b) => Math.hypot(b.x - 50, b.y - 50) - Math.hypot(a.x - 50, a.y - 50))
})()

export default function CloudTransition() {
  const phase = useSyncExternalStore(subscribeCloudPhase, getCloudPhase)

  return (
    <div className="cloud-overlay" data-phase={phase} aria-hidden="true">
      <div className="cloud-fill" />
      {CLOUDS.map((cloud, i) => (
        <div
          key={i}
          className="cloud"
          style={
            {
              left: `${cloud.x}vw`,
              top: `${cloud.y}vh`,
              '--w': `${cloud.w}vmax`,
              '--ox': cloud.ox,
              '--oy': cloud.oy,
              '--din': `${cloud.din}ms`,
              '--dout': `${cloud.dout}ms`,
            } as CSSProperties
          }
        >
          <span className="puff puff-1" />
          <span className="puff puff-2" />
          <span className="puff puff-3" />
          <span className="puff puff-4" />
          <span className="puff puff-5" />
        </div>
      ))}
    </div>
  )
}
