import { useEffect, useRef } from 'react'
import { playFanfare } from '../audio/sfx'

// The party when the bomb is defused: confetti cannons fire from both bottom corners, more
// confetti rains from the top, a fanfare plays and a big banner pops in. Mount it to start it.

const COLORS = ['#ff4d6d', '#ffb547', '#ffe66d', '#3dff6e', '#3fe6ff', '#5b8def', '#c85dd8', '#ffffff']
const GRAVITY = 900
const DRAG = 0.985

type Piece = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  angle: number
  spin: number
  /** Flutter phase: the piece tilts back and forth, so it shimmers like paper. */
  flutter: number
  shape: 'rect' | 'circle' | 'strip'
}

function piece(x: number, y: number, vx: number, vy: number): Piece {
  const r = Math.random()
  return {
    x,
    y,
    vx,
    vy,
    size: 6 + Math.random() * 7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 14,
    flutter: Math.random() * Math.PI * 2,
    shape: r < 0.55 ? 'rect' : r < 0.8 ? 'strip' : 'circle',
  }
}

export default function Celebration() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    playFanfare()
    const c = canvas.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      c.width = c.clientWidth * dpr
      c.height = c.clientHeight * dpr
    }
    resize()
    window.addEventListener('resize', resize)

    const pieces: Piece[] = []
    const w = () => c.clientWidth
    const h = () => c.clientHeight

    /** A cannon shot from a bottom corner, aimed up and towards the middle. */
    const cannon = (side: -1 | 1, count: number) => {
      const x = side < 0 ? 0 : w()
      for (let i = 0; i < count; i++) {
        const angle = (-Math.PI / 2) * (0.55 + Math.random() * 0.4)
        const speed = (900 + Math.random() * 700) * (h() / 900 + 0.3)
        pieces.push(piece(x, h(), -side * Math.cos(angle) * speed, Math.sin(angle) * speed))
      }
    }
    /** Confetti drifting down from above the screen. */
    const rain = (count: number) => {
      for (let i = 0; i < count; i++) {
        pieces.push(piece(Math.random() * w(), -20 - Math.random() * 200, (Math.random() - 0.5) * 200, Math.random() * 100))
      }
    }

    const scale = reduced ? 0.25 : 1
    const timers = [
      setTimeout(() => (cannon(-1, 140 * scale), cannon(1, 140 * scale)), 0),
      setTimeout(() => rain(160 * scale), 250),
      setTimeout(() => (cannon(-1, 100 * scale), cannon(1, 100 * scale)), 900),
      setTimeout(() => rain(120 * scale), 1600),
      setTimeout(() => (cannon(-1, 80 * scale), cannon(1, 80 * scale)), 2300),
    ]

    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000)
      last = now
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w(), h())
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i]
        p.vy += GRAVITY * dt
        p.vx *= DRAG
        p.vy *= DRAG
        // light pieces fall slowly once their speed is gone, like paper
        p.vy = Math.min(p.vy, 260)
        p.x += (p.vx + Math.sin(p.flutter) * 40) * dt
        p.y += p.vy * dt
        p.angle += p.spin * dt
        p.flutter += dt * 6
        if (p.y > h() + 40) {
          pieces.splice(i, 1)
          continue
        }
        const tilt = Math.abs(Math.cos(p.flutter))
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.fillStyle = p.color
        if (p.shape === 'circle') {
          ctx.beginPath()
          ctx.ellipse(0, 0, p.size / 2, (p.size / 2) * tilt + 0.5, 0, 0, Math.PI * 2)
          ctx.fill()
        } else {
          const len = p.shape === 'strip' ? p.size * 2 : p.size
          ctx.fillRect(-len / 2, (-p.size / 2) * tilt * 0.6, len, p.size * tilt * 0.6 + 0.8)
        }
        ctx.restore()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="celebration" aria-hidden>
      <div className="celebration-glow" />
      <canvas ref={canvas} className="celebration-confetti" />
      <div className="celebration-banner">
        <span className="celebration-title">ENTSCHÄRFT!</span>
        <span className="celebration-sub">🎉 Ihr habt die Bombe gerettet 🎉</span>
      </div>
    </div>
  )
}
