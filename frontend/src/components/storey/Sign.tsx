import { Suspense, useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import { CanvasTexture, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three'

/** Built in Blender by scripts/blender/storey_props.py: a 0.62 x 0.2 m plank, origin at its centre, back on the wall. */
const SIGN_URL = '/models/storey/sign.glb'
const MODEL_W = 0.62
const MODEL_H = 0.2
const MODEL_DEPTH = 0.03
/** Nails sit this far in from the plank's ends; the lettering stays clear of them. */
const NAIL_INSET = 0.032

const CARVE_DARK = 'rgba(74, 42, 18, 0.85)'
const CARVE_LIGHT = 'rgba(255, 236, 205, 0.45)'

type SignProps = {
  label: string
  width: number
  height: number
  glow: number
}

/** Tiny seeded random, so a sign's grain stays the same between renders. */
function random(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
}

/**
 * Transparent overlay: wood grain, a carved border and carved lettering. Drawn at the sign's
 * real width-to-height ratio so the lettering isn't stretched when the plank is.
 */
function makeCarvingTexture(label: string, aspect: number): CanvasTexture {
  const width = 1024
  const height = Math.round(width / aspect)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')

  if (context) {
    const rand = random(label.length * 977 + 13)

    // Grain: long, slightly wavy streaks along the plank
    for (let i = 0; i < 26; i++) {
      const y = rand() * height
      const amp = 2 + rand() * 6
      const phase = rand() * Math.PI * 2
      context.strokeStyle = `rgba(92, 54, 22, ${0.06 + rand() * 0.12})`
      context.lineWidth = 1 + rand() * 2.5
      context.beginPath()
      for (let x = 0; x <= width; x += 32) {
        const yy = y + Math.sin(x / 140 + phase) * amp
        if (x === 0) context.moveTo(x, yy)
        else context.lineTo(x, yy)
      }
      context.stroke()
    }

    // A groove reads as carved when lit from above: light lower lip, dark cut.
    const carve = (draw: () => void, lineWidth: number) => {
      context.save()
      context.translate(1.5, 2.5)
      context.strokeStyle = CARVE_LIGHT
      context.fillStyle = CARVE_LIGHT
      context.lineWidth = lineWidth
      draw()
      context.restore()
      context.strokeStyle = CARVE_DARK
      context.fillStyle = CARVE_DARK
      context.lineWidth = lineWidth
      draw()
    }

    // Border groove following the sawn-off corners
    const inset = 20
    const cut = 44
    carve(() => {
      context.beginPath()
      context.moveTo(inset + cut, inset)
      context.lineTo(width - inset - cut, inset)
      context.lineTo(width - inset, inset + cut)
      context.lineTo(width - inset, height - inset - cut)
      context.lineTo(width - inset - cut, height - inset)
      context.lineTo(inset + cut, height - inset)
      context.lineTo(inset, height - inset - cut)
      context.lineTo(inset, inset + cut)
      context.closePath()
      context.stroke()
    }, 5)

    // Lettering between the nails: one line, shrunk to fit; if it is still too long, two lines.
    const maxWidth = width * (1 - (4 * NAIL_INSET) / MODEL_W) - 40
    const font = (px: number) => `bold ${px}px Georgia, "Times New Roman", serif`
    const measure = (text: string) => context.measureText(text).width
    const fits = (lines: string[]) => lines.every((line) => measure(line) <= maxWidth)
    const ellipsize = (text: string) => {
      while (measure(text) > maxWidth && text.length > 1) text = `${text.slice(0, -2)}…`
      return text
    }

    let size = 150
    context.font = font(size)
    while (!fits([label]) && size > 70) context.font = font((size -= 4))
    let lines = [label]

    // Split at the space that gives the most even lines.
    const spaces = [...label.matchAll(/ /g)].map((match) => match.index)
    if (!fits(lines) && spaces.length > 0) {
      const splits = spaces.map((at) => [label.slice(0, at), label.slice(at + 1)])
      const widest = (pair: string[]) => Math.max(...pair.map(measure))
      lines = splits.reduce((best, pair) => (widest(pair) < widest(best) ? pair : best))
      size = Math.floor((height - 2 * inset - 30) / 2.1)
      context.font = font(size)
      while (!fits(lines) && size > 48) context.font = font((size -= 4))
    }
    lines = lines.map(ellipsize)

    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const lineHeight = size * 1.05
    const top = height / 2 - ((lines.length - 1) * lineHeight) / 2 + size * 0.06
    carve(() => lines.forEach((line, i) => context.fillText(line, width / 2, top + i * lineHeight)), 1)
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

function SignModel({ label, width, height, glow }: SignProps) {
  const { scene } = useGLTF(SIGN_URL)
  const aspect = width / height
  const texture = useMemo(() => makeCarvingTexture(label, aspect), [label, aspect])

  const { model, materials } = useMemo(() => {
    const model = scene.clone(true)
    const materials: MeshStandardMaterial[] = []
    model.traverse((child) => {
      if (!(child instanceof Mesh)) return
      const material = (child.material as MeshStandardMaterial).clone()
      material.emissive.copy(material.color)
      child.material = material
      materials.push(material)
    })
    return { model, materials }
  }, [scene])

  useEffect(() => {
    for (const material of materials) material.emissiveIntensity = 0.08 + glow * 0.3
  }, [materials, glow])

  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group scale={[width / MODEL_W, height / MODEL_H, 1]}>
      <primitive object={model} />
      <mesh position={[0, 0, MODEL_DEPTH + 0.0005]}>
        <planeGeometry args={[MODEL_W, MODEL_H]} />
        <meshStandardMaterial
          map={texture}
          transparent
          depthWrite={false}
          roughness={0.85}
          emissiveMap={texture}
          emissive="#ffffff"
          emissiveIntensity={0.08 + glow * 0.3}
        />
      </mesh>
    </group>
  )
}

export default function Sign(props: SignProps) {
  return (
    <Suspense fallback={null}>
      <SignModel {...props} />
    </Suspense>
  )
}

useGLTF.preload(SIGN_URL)
