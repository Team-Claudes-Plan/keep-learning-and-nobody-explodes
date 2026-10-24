import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import type { FacadeTextures } from '../../data/facadeTypes'
import type { InteriorDesign } from '../../data/interiorTypes'

const SIZE = 256

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '')
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16)
  const clamp = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)))
  const r = clamp(((num >> 16) & 0xff) + amount * 255)
  const g = clamp(((num >> 8) & 0xff) + amount * 255)
  const b = clamp((num & 0xff) + amount * 255)
  return `rgb(${r}, ${g}, ${b})`
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')
  return [canvas, context]
}

function finish(canvas: HTMLCanvasElement, colorSpace: Texture['colorSpace']): Texture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = colorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

type Painter = {
  albedo: CanvasRenderingContext2D
  emissive: CanvasRenderingContext2D
  base: string
  soft: string
  dark: string
  accent: string
  random: () => number
}

function drawTiles({ albedo, emissive, base, soft, dark, accent, random }: Painter) {
  const cells = 2
  const cell = SIZE / cells
  const grout = 8
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const x = col * cell
      const y = row * cell
      albedo.fillStyle = dark
      albedo.fillRect(x, y, cell, cell)
      albedo.fillStyle = (row + col) % 2 === 0 ? base : soft
      albedo.fillRect(x + grout, y + grout, cell - grout * 2, cell - grout * 2)
      if (random() < 0.4) {
        emissive.fillStyle = accent
        emissive.fillRect(x + grout * 2, y + grout * 2, cell - grout * 4, cell - grout * 4)
      }
    }
  }
}

function drawPlanks({ albedo, emissive, base, soft, dark, accent }: Painter) {
  const rows = 4
  const rowH = SIZE / rows
  for (let row = 0; row < rows; row += 1) {
    const y = row * rowH
    albedo.fillStyle = row % 2 === 0 ? base : soft
    albedo.fillRect(0, y, SIZE, rowH - 5)
    albedo.fillStyle = dark
    albedo.fillRect(0, y + rowH - 5, SIZE, 5)
    if (row === 1) {
      emissive.fillStyle = accent
      albedo.fillRect(SIZE * 0.5, y, 5, rowH - 5)
      emissive.fillRect(SIZE * 0.5, y, 5, rowH - 5)
    }
  }
}

function drawStripes({ albedo, emissive, base, soft, accent }: Painter) {
  const cols = 4
  const colW = SIZE / cols
  for (let col = 0; col < cols; col += 1) {
    albedo.fillStyle = col % 2 === 0 ? base : soft
    albedo.fillRect(col * colW, 0, colW, SIZE)
  }
  emissive.fillStyle = accent
  emissive.fillRect(colW * 2 - 3, 0, 6, SIZE)
}

function drawDots({ albedo, emissive, base, soft, accent, random }: Painter) {
  albedo.fillStyle = base
  albedo.fillRect(0, 0, SIZE, SIZE)
  const step = SIZE / 3
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const cx = col * step + step / 2
      const cy = row * step + step / 2
      albedo.fillStyle = soft
      albedo.beginPath()
      albedo.arc(cx, cy, step * 0.24, 0, Math.PI * 2)
      albedo.fill()
      if (random() < 0.3) {
        emissive.fillStyle = accent
        emissive.beginPath()
        emissive.arc(cx, cy, step * 0.24, 0, Math.PI * 2)
        emissive.fill()
      }
    }
  }
}

function drawGrid({ albedo, emissive, soft, dark, accent, random }: Painter) {
  const rows = 3
  const cols = 3
  const cellW = SIZE / cols
  const cellH = SIZE / rows
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = col * cellW
      const y = row * cellH
      albedo.fillStyle = soft
      albedo.fillRect(x, y, cellW, cellH)
      albedo.fillStyle = dark
      albedo.fillRect(x + 8, y + 8, cellW - 16, cellH - 16)
      if (random() < 0.4) {
        emissive.fillStyle = accent
        emissive.fillRect(x + 8, y + 8, cellW - 16, cellH - 16)
      }
    }
  }
}

function drawChecker({ albedo, emissive, base, soft, accent, random }: Painter) {
  const cells = 4
  const cell = SIZE / cells
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      albedo.fillStyle = (row + col) % 2 === 0 ? base : soft
      albedo.fillRect(col * cell, row * cell, cell, cell)
      if ((row + col) % 2 === 0 && random() < 0.3) {
        emissive.fillStyle = accent
        emissive.fillRect(col * cell + cell * 0.3, row * cell + cell * 0.3, cell * 0.4, cell * 0.4)
      }
    }
  }
}

const PAINTERS = {
  tiles: drawTiles,
  planks: drawPlanks,
  stripes: drawStripes,
  dots: drawDots,
  grid: drawGrid,
  checker: drawChecker,
}

export function createInteriorTextures(seed: string, design: InteriorDesign): FacadeTextures {
  const random = mulberry32(hashString(`${seed}:${design.motif}`))
  const [albedoCanvas, albedo] = makeCanvas()
  const [emissiveCanvas, emissive] = makeCanvas()

  albedo.fillStyle = shade(design.floor, -0.05)
  albedo.fillRect(0, 0, SIZE, SIZE)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, SIZE, SIZE)

  PAINTERS[design.motif]({
    albedo,
    emissive,
    base: design.floor,
    soft: shade(design.floor, 0.07),
    dark: shade(design.floor, -0.14),
    accent: design.accent,
    random,
  })

  return {
    albedo: finish(albedoCanvas, SRGBColorSpace),
    emissive: finish(emissiveCanvas, SRGBColorSpace),
  }
}
