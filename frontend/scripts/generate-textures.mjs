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

function createBuffer(size) {
  return { size, data: Buffer.alloc(size * size * 3), fill([r, g, b]) { this.data.fill(Buffer.from([r, g, b])) } }
}

function fillRect(buffer, x, y, w, h, [r, g, b]) {
  for (let py = Math.max(0, y); py < Math.min(buffer.size, y + h); py += 1) {
    for (let px = Math.max(0, x); px < Math.min(buffer.size, x + w); px += 1) {
      const index = (py * buffer.size + px) * 3
      buffer.data[index] = r
      buffer.data[index + 1] = g
      buffer.data[index + 2] = b
    }
  }
}

const SIZE = 256
const COLS = 6
const ROWS = 8

function drawFacade({ tint, litColors, litChance, seed }) {
  const random = mulberry32(hashString(seed))
  const albedo = createBuffer(SIZE)
  albedo.fill(shade(tint, -0.04))
  const emissive = createBuffer(SIZE)
  emissive.fill([0, 0, 0])

  const windowColor = shade(tint, -0.28)
  const frameColor = shade(tint, 0.08)
  const tile = SIZE / COLS

  for (let row = 0; row < ROWS; row += 1) {
    const bandY = row * (SIZE / ROWS)
    fillRect(albedo, 0, bandY, SIZE, SIZE / ROWS - tile * 0.6, frameColor)
    for (let col = 0; col < COLS; col += 1) {
      const x = col * tile + tile * 0.2
      const y = bandY + tile * 0.18
      const windowW = tile * 0.6
      const windowH = SIZE / ROWS - tile * 0.9
      fillRect(albedo, x, y, windowW, windowH, windowColor)
      if (random() < litChance) {
        const color = hexToRgb(litColors[Math.floor(random() * litColors.length)])
        fillRect(emissive, x, y, windowW, windowH, color)
      }
    }
  }
  return { albedo, emissive }
}

const HOUSES = [
  { id: 'house-a', tint: '#33405c', litColors: ['#6ea8fe', '#ffe6a3', '#bfe9ff'], litChance: 0.55 },
  { id: 'house-b', tint: '#4a5468', litColors: ['#ffb347', '#ff8f4f', '#ffe6a3'], litChance: 0.5 },
  { id: 'house-c', tint: '#4a6b3f', litColors: ['#8fe6a8', '#d7f7a3', '#bfe9ff'], litChance: 0.6 },
]

for (const house of HOUSES) {
  const { albedo, emissive } = drawFacade({ ...house, seed: house.id })
  const dir = resolve(assetsDir, house.id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'albedo.png'), encodePng(SIZE, SIZE, albedo.data))
  writeFileSync(resolve(dir, 'emissive.png'), encodePng(SIZE, SIZE, emissive.data))
  console.log(`generated ${house.id}/albedo.png + emissive.png`)
}
