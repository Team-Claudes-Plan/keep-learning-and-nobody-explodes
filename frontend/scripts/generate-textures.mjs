import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = resolve(here, '../src/assets')

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(width, height, rgb) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 3 + 1)
    raw[rowStart] = 0
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3)
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  const num = parseInt(value, 16)
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

function shade(hex, amount) {
  return hexToRgb(hex).map((c) => Math.max(0, Math.min(255, Math.round(c + amount * 255))))
}

function createBuffer(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 3) }
}

function fillRect(buffer, x, y, w, h, [r, g, b]) {
  for (let py = Math.max(0, y); py < Math.min(buffer.height, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(buffer.width, x + w); px += 1) {
      const index = (py * buffer.width + px) * 3
      buffer.data[index] = r
      buffer.data[index + 1] = g
      buffer.data[index + 2] = b
    }
  }
}

// Atlas layout (matches DEFAULT_WALL_ATLAS): outer wall = left half, inner wall = right half.
const ATLAS_W = 512
const ATLAS_H = 256
const REGION_W = ATLAS_W / 2
const COLS = 6
const ROWS = 8

function drawOuterRegion(albedo, emissive, { tint, litColors, litChance, random }, x0) {
  const windowColor = shade(tint, -0.28)
  const frameColor = shade(tint, 0.08)
  const tile = REGION_W / COLS

  for (let row = 0; row < ROWS; row += 1) {
    const bandY = row * (ATLAS_H / ROWS)
    fillRect(albedo, x0, bandY, REGION_W, ATLAS_H / ROWS - tile * 0.6, frameColor)
    for (let col = 0; col < COLS; col += 1) {
      const x = x0 + col * tile + tile * 0.2
      const y = bandY + tile * 0.18
      const windowW = tile * 0.6
      const windowH = ATLAS_H / ROWS - tile * 0.9
      fillRect(albedo, x, y, windowW, windowH, windowColor)
      if (random() < litChance) {
        const color = hexToRgb(litColors[Math.floor(random() * litColors.length)])
        fillRect(emissive, x, y, windowW, windowH, color)
      }
    }
  }
}

function drawInnerRegion(albedo, emissive, { tint, random }, x0) {
  const base = shade(tint, 0.16)
  const trim = shade(tint, -0.04)
  const seam = shade(tint, 0.03)

  fillRect(albedo, x0, 0, REGION_W, ATLAS_H, base)
  fillRect(albedo, x0, ATLAS_H * 0.66, REGION_W, ATLAS_H * 0.34, trim)
  fillRect(albedo, x0, ATLAS_H * 0.66, REGION_W, 6, shade(tint, 0.24))

  const panels = 4
  for (let i = 1; i < panels; i += 1) {
    fillRect(albedo, x0 + i * (REGION_W / panels), 0, 4, ATLAS_H, seam)
  }

  if (random() < 0.7) {
    fillRect(emissive, x0 + REGION_W * 0.12, ATLAS_H * 0.12, REGION_W * 0.76, 8, [255, 230, 163])
  }
}

const HOUSES = [
  { id: 'house-a', tint: '#33405c', litColors: ['#6ea8fe', '#ffe6a3', '#bfe9ff'], litChance: 0.55 },
  { id: 'house-b', tint: '#4a5468', litColors: ['#ffb347', '#ff8f4f', '#ffe6a3'], litChance: 0.5 },
  { id: 'house-c', tint: '#4a6b3f', litColors: ['#8fe6a8', '#d7f7a3', '#bfe9ff'], litChance: 0.6 },
  { id: 'house-math-tower', tint: '#2d5e9f', litColors: ['#4f8cff', '#bfe9ff', '#ffe6a3'], litChance: 0.5 },
]

for (const house of HOUSES) {
  const random = mulberry32(hashString(house.id))
  const albedo = createBuffer(ATLAS_W, ATLAS_H)
  const emissive = createBuffer(ATLAS_W, ATLAS_H)
  const normal = createBuffer(ATLAS_W, ATLAS_H)
  const roughness = createBuffer(ATLAS_W, ATLAS_H)

  albedo.data.fill(Buffer.from(shade(house.tint, -0.04)))
  emissive.data.fill(Buffer.from([0, 0, 0]))
  normal.data.fill(Buffer.from([128, 128, 255]))
  roughness.data.fill(Buffer.from([190, 190, 190]))

  drawOuterRegion(albedo, emissive, { ...house, random }, 0)
  drawInnerRegion(albedo, emissive, { ...house, random }, REGION_W)

  const dir = resolve(assetsDir, house.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'albedo.png'), encodePng(ATLAS_W, ATLAS_H, albedo.data))
  writeFileSync(resolve(dir, 'emissive.png'), encodePng(ATLAS_W, ATLAS_H, emissive.data))
  writeFileSync(resolve(dir, 'normal.png'), encodePng(ATLAS_W, ATLAS_H, normal.data))
  writeFileSync(resolve(dir, 'roughness.png'), encodePng(ATLAS_W, ATLAS_H, roughness.data))
  console.log(`generated ${house.id}/{albedo,emissive,normal,roughness}.png`)
}
