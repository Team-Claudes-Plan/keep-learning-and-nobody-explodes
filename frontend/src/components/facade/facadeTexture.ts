import { CanvasTexture, LinearSRGBColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import type { BaseDesign, FacadeTextures } from '../../data/facadeTypes'

export const TEXTURE_SIZE = 256

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

const COLS = 6
const ROWS = 8

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')
  return [canvas, context]
}

function finishTexture(canvas: HTMLCanvasElement, colorSpace: Texture['colorSpace']): Texture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = colorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

export function createProceduralTextures(setId: string, design: BaseDesign): FacadeTextures {
  const random = mulberry32(hashString(setId))
  const size = TEXTURE_SIZE
  const tile = size / COLS

  const [albedoCanvas, albedo] = createCanvas(size)
  albedo.fillStyle = shade(design.material.tint, -0.04)
  albedo.fillRect(0, 0, size, size)

  const [emissiveCanvas, emissive] = createCanvas(size)
  emissive.fillStyle = '#000000'
  emissive.fillRect(0, 0, size, size)

  const windowColor = shade(design.material.tint, -0.28)
  const frameColor = shade(design.material.tint, 0.08)
  const litColors = [shade(design.material.tint, 0.5), '#ffe6a3', '#bfe9ff']

  for (let row = 0; row < ROWS; row += 1) {
    const bandY = row * (size / ROWS)
    albedo.fillStyle = frameColor
    albedo.fillRect(0, bandY, size, size / ROWS - tile * 0.6)

    for (let col = 0; col < COLS; col += 1) {
      const x = col * tile + tile * 0.2
      const y = bandY + tile * 0.18
      const windowW = tile * 0.6
      const windowH = size / ROWS - tile * 0.9

      albedo.fillStyle = windowColor
      albedo.fillRect(x, y, windowW, windowH)

      if (random() < 0.55) {
        const color = litColors[Math.floor(random() * litColors.length)]
        emissive.fillStyle = color
        emissive.fillRect(x, y, windowW, windowH)
      }
    }
  }

  const textures: FacadeTextures = {}
  if (design.maps.includes('albedo')) {
    textures.albedo = finishTexture(albedoCanvas, SRGBColorSpace)
  }
  if (design.maps.includes('emissive')) {
    textures.emissive = finishTexture(emissiveCanvas, SRGBColorSpace)
  }
  if (design.maps.includes('normal')) {
    const [normalCanvas, normal] = createCanvas(size)
    normal.fillStyle = 'rgb(128, 128, 255)'
    normal.fillRect(0, 0, size, size)
    textures.normal = finishTexture(normalCanvas, LinearSRGBColorSpace)
  }
  if (design.maps.includes('roughness')) {
    const [roughCanvas, rough] = createCanvas(size)
    rough.fillStyle = 'rgb(180, 180, 180)'
    rough.fillRect(0, 0, size, size)
    textures.roughness = finishTexture(roughCanvas, LinearSRGBColorSpace)
  }
  return textures
}
