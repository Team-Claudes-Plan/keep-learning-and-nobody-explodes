import { useEffect, useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'

type SignProps = {
  label: string
  width: number
  height: number
  color: string
  glow: number
}

function makeSignTexture(label: string, color: string): CanvasTexture {
  const width = 256
  const height = 96
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context) {
    context.fillStyle = '#0b0e14'
    context.fillRect(0, 0, width, height)
    context.fillStyle = color
    context.fillRect(8, 8, width - 16, height - 16)
    context.fillStyle = '#0b0e14'
    context.font = 'bold 40px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(label.slice(0, 14), width / 2, height / 2 + 2)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

export default function Sign({ label, width, height, color, glow }: SignProps) {
  const texture = useMemo(() => makeSignTexture(label, color), [label, color])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group>
      <mesh position={[0, 0, 0.004]}>
        <boxGeometry args={[width + 0.04, height + 0.04, 0.012]} />
        <meshStandardMaterial color="#0b0e14" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.014]}>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial
          map={texture}
          emissiveMap={texture}
          emissive="#ffffff"
          emissiveIntensity={0.35 + glow * 0.6}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>
    </group>
  )
}
