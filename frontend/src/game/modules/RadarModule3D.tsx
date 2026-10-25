import { useEffect, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { FACE } from './module3d'
import { ModuleHeading, PlateText } from './Label3D'
import type { ModuleProps } from './types'

const ACTIVE = '#ffb547'
const RADAR_GREEN = '#3dff8a'
/** Space for the screen between the instruction line and the bottom strip. */
const MAX_WIDTH = 0.84
const MAX_HEIGHT = 0.6
const SCREEN_Y = -0.03
const TEXTURE_WIDTH = 1024

/**
 * Loads the radar image into a canvas texture, keeping its aspect ratio (SVGs without a size would
 * otherwise come out blurry or squashed). Loads without suspending, so the bomb stays visible.
 */
function useImageTexture(url: string) {
  const [texture, setTexture] = useState<{ map: THREE.Texture; aspect: number } | null>(null)
  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (cancelled) return
      const aspect = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 4 / 3
      const canvas = document.createElement('canvas')
      canvas.width = TEXTURE_WIDTH
      canvas.height = Math.round(TEXTURE_WIDTH / aspect)
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
      const map = new THREE.CanvasTexture(canvas)
      map.colorSpace = THREE.SRGBColorSpace
      setTexture({ map, aspect })
    }
    image.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  useEffect(() => () => texture?.map.dispose(), [texture])
  return texture
}

/** Rotating sweep line over the screen, like a radar scope. */
function Sweep({ radius }: { radius: number }) {
  const ref = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z -= delta * 1.6
  })
  return (
    <group ref={ref}>
      <mesh position={[radius / 2, 0, 0]} raycast={() => null}>
        <planeGeometry args={[radius, 0.006]} />
        <meshBasicMaterial color={RADAR_GREEN} transparent opacity={0.7} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Radar screen on the bomb: click the spot in the image; the crosshair marks it. */
export default function RadarModule3D({ primitive, value, onChange, disabled, heading }: ModuleProps<'point'>) {
  const texture = useImageTexture(primitive.image)
  const aspect = texture?.aspect ?? 4 / 3
  const width = Math.min(MAX_WIDTH, MAX_HEIGHT * aspect)
  const height = width / aspect

  function aim(event: ThreeEvent<MouseEvent>) {
    event.stopPropagation()
    if (disabled || !event.uv) return
    const x = event.uv.x * 100
    const y = (1 - event.uv.y) * 100
    onChange({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
  }

  const marker = value && [(value.x / 100 - 0.5) * width, (0.5 - value.y / 100) * height]

  return (
    <group>
      <ModuleHeading text={heading} />
      <group position={[0, SCREEN_Y, FACE]}>
        {/* bezel */}
        <mesh position={[0, 0, 0.006]}>
          <boxGeometry args={[width + 0.04, height + 0.04, 0.012]} />
          <meshStandardMaterial color="#1a1d22" metalness={0.5} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, 0.013]} onClick={aim}>
          <planeGeometry args={[width, height]} />
          {/* keyed: a fresh material once the image is there (the dark placeholder colour would tint it) */}
          {texture ? (
            <meshBasicMaterial key="image" map={texture.map} toneMapped={false} />
          ) : (
            <meshBasicMaterial key="placeholder" color="#0d2a1c" toneMapped={false} />
          )}
        </mesh>
        <group position={[0, 0, 0.015]}>
          <Sweep radius={Math.min(width, height) / 2} />
        </group>
        {marker && (
          <group position={[marker[0], marker[1], 0.017]}>
            <mesh raycast={() => null}>
              <ringGeometry args={[0.018, 0.026, 24]} />
              <meshBasicMaterial color={ACTIVE} toneMapped={false} />
            </mesh>
            {[0, Math.PI / 2].map((angle) => (
              <mesh key={angle} rotation={[0, 0, angle]} raycast={() => null}>
                <planeGeometry args={[0.09, 0.005]} />
                <meshBasicMaterial color={ACTIVE} toneMapped={false} />
              </mesh>
            ))}
          </group>
        )}
      </group>
      <PlateText
        text={value ? `Ziel: ${value.x}% / ${value.y}%` : 'Kein Ziel markiert'}
        position={[-0.42, -0.405, FACE + 0.014]}
        fontSize={0.028}
        anchorX="left"
        color={value ? ACTIVE : '#d4d8de'}
      />
    </group>
  )
}
