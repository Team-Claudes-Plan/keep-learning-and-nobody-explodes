import type { ComponentProps } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { GLYPHS, glyphOf } from '../glyphs'
import { FACE, FONT_URL, HINT_COLOR } from './module3d'

const GLYPH_TEXTURE_SIZE = 128
const textures = new Map<string, THREE.CanvasTexture>()

/** The glyph drawn as a white-on-transparent line texture, one per glyph and colour, shared. */
function glyphTexture(index: number, color: string) {
  const key = `${index}|${color}`
  let texture = textures.get(key)
  if (!texture) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = GLYPH_TEXTURE_SIZE
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(GLYPH_TEXTURE_SIZE / 100, GLYPH_TEXTURE_SIZE / 100)
      ctx.strokeStyle = color
      ctx.lineWidth = 7
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(new Path2D(GLYPHS[index]))
    }
    texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    textures.set(key, texture)
  }
  return texture
}

type GlyphProps = {
  index: number
  size: number
  color?: string
  position: [number, number, number]
  onClick?: ComponentProps<'mesh'>['onClick']
}

/** A glyph on a module: a flat square facing the viewer. */
export function Glyph3D({ index, size, color = '#f2f4f7', position, onClick }: GlyphProps) {
  return (
    <mesh position={position} onClick={onClick} raycast={onClick ? undefined : () => null}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={glyphTexture(index, color)} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

type LabelProps = Omit<ComponentProps<typeof Text>, 'children'> & {
  children: string
  /** Glyph size; defaults to twice the font size the text would have had. */
  glyphSize?: number
}

/**
 * Label of an answer, item or target on a module: plain text, or, if the label is a glyph (see
 * glyphs.ts), the glyph, placed the same way the text would have been (same anchors).
 */
export function Label({ children, glyphSize, ...props }: LabelProps) {
  const glyph = glyphOf(children)
  if (glyph === null) return <Text {...props}>{children}</Text>

  const size = glyphSize ?? (typeof props.fontSize === 'number' ? props.fontSize : 0.04) * 2
  const [x, y, z] = (props.position as [number, number, number] | undefined) ?? [0, 0, 0]
  const dx = props.anchorX === 'left' ? size / 2 : props.anchorX === 'right' ? -size / 2 : 0
  const dy = props.anchorY === 'top' ? -size / 2 : props.anchorY === 'bottom' ? size / 2 : 0
  return (
    <Glyph3D
      index={glyph}
      size={size}
      color={typeof props.color === 'string' ? props.color : undefined}
      position={[x + dx, y + dy, z]}
      onClick={props.onClick as GlyphProps['onClick']}
    />
  )
}

/** Rough width of a text line, as a share of the font size (for sizing the plate behind it). */
const GLYPH_WIDTH = 0.56

type PlateTextProps = {
  text: string
  position: [number, number, number]
  fontSize: number
  maxWidth?: number
  anchorX?: 'left' | 'center' | 'right'
  anchorY?: 'top' | 'middle' | 'bottom'
  textAlign?: 'left' | 'center' | 'right'
  color?: string
}

/**
 * Text on its own small dark plate, so it reads well whatever the module plate behind it looks
 * like (the plates range from light metal to mid grey).
 */
export function PlateText({
  text,
  position,
  fontSize,
  maxWidth = 0.8,
  anchorX = 'center',
  anchorY = 'middle',
  textAlign,
  color = '#f2f4f7',
}: PlateTextProps) {
  const pad = Math.max(0.012, fontSize * 0.4)
  const lineWidth = text.length * fontSize * GLYPH_WIDTH
  // a bit of slack: word wrapping fills lines less than the raw width suggests
  const lines = Math.max(1, Math.ceil((lineWidth * 1.15) / maxWidth))
  const width = Math.min(lineWidth, maxWidth) + pad * 2
  const height = lines * fontSize * 1.15 + pad * 1.4
  const [x, y, z] = position
  const cx = anchorX === 'left' ? x - pad + width / 2 : anchorX === 'right' ? x + pad - width / 2 : x
  const cy = anchorY === 'top' ? y + pad * 0.7 - height / 2 : anchorY === 'bottom' ? y - pad * 0.7 + height / 2 : y
  return (
    <group>
      <mesh position={[cx, cy, z - 0.003]} raycast={() => null}>
        <boxGeometry args={[width, height, 0.004]} />
        {/* unlit, so it stays dark under any light (a lit dark grey turns mid grey on the bright plates) */}
        <meshBasicMaterial color="#14171c" />
      </mesh>
      <Text
        font={FONT_URL}
        position={position}
        fontSize={fontSize}
        maxWidth={maxWidth}
        lineHeight={1.15}
        anchorX={anchorX}
        anchorY={anchorY}
        textAlign={textAlign ?? anchorX}
        color={color}
        raycast={() => null}
      >
        {text}
      </Text>
    </group>
  )
}

/**
 * The question (or whatever the defuser is told) across the top of a module, in place of the old
 * instructions. Long questions get a smaller font so they stay within two lines.
 */
export function ModuleHeading({ text }: { text?: string }) {
  if (!text) return null
  const fontSize = Math.min(0.034, (2 * 0.72) / (Math.max(text.length, 1) * GLYPH_WIDTH))
  return (
    <PlateText
      text={text}
      position={[-0.43, 0.37, FACE + 0.014]}
      fontSize={fontSize}
      maxWidth={0.7}
      anchorX="left"
      color={HINT_COLOR}
    />
  )
}
