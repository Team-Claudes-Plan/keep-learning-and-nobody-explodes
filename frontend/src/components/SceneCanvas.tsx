import { useEffect, useRef } from 'react'
import type { ReactNode, ComponentProps, ComponentRef, RefObject } from 'react'
import { Canvas, type CameraProps, useThree, useFrame } from '@react-three/fiber'
import { MapControls } from '@react-three/drei'
import type { Camera, OrthographicCamera } from 'three'
import Ground from './Ground'
import { ISO_CAMERA } from './cameras'

const ZOOM_REFERENCE = 1080

function setCursor(element: HTMLElement, cursor: string) {
  element.style.cursor = cursor
}

function setOrthographicZoom(camera: OrthographicCamera, zoom: number) {
  camera.zoom = zoom
  camera.updateProjectionMatrix()
}

function shiftCameraXZ(camera: Camera, dx: number, dz: number) {
  camera.position.x += dx
  camera.position.z += dz
}

type MapControlsProps = ComponentProps<typeof MapControls>
type ControlsImpl = ComponentRef<typeof MapControls>

type VerticalScrollOptions = {
  min: number
  max: number
  step?: number
}

type SceneCanvasProps = {
  children: ReactNode
  camera?: CameraProps
  orthographic?: boolean
  controls?: Partial<MapControlsProps> | false
  onPointerMissed?: () => void
  verticalScroll?: VerticalScrollOptions
  panBounds?: { clamp: (x: number, z: number) => [number, number] }
  responsiveZoom?: boolean
  grid?: boolean
}

function VerticalScroll({
  controlsRef,
  min,
  max,
  step = 0.5,
}: {
  controlsRef: RefObject<ControlsImpl | null>
  min: number
  max: number
  step?: number
}) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const drag = useRef<{ pointerId: number; lastY: number } | null>(null)

  useEffect(() => {
    const element = gl.domElement

    const scrollBy = (worldDelta: number) => {
      const controls = controlsRef.current
      if (!controls || worldDelta === 0) return
      const nextY = Math.min(max, Math.max(min, controls.target.y + worldDelta))
      const applied = nextY - controls.target.y
      controls.target.y = nextY
      camera.position.y += applied
      controls.update()
    }

    const zoom = () => (camera as OrthographicCamera).zoom || 1

    const setCanvasCursor = (cursor: string) => {
      setCursor(element, cursor)
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      scrollBy(-Math.sign(event.deltaY) * step)
    }

    const handlePointerDown = (event: PointerEvent) => {
      drag.current = { pointerId: event.pointerId, lastY: event.clientY }
      element.setPointerCapture(event.pointerId)
      setCanvasCursor('grabbing')
    }

    const handlePointerMove = (event: PointerEvent) => {
      const state = drag.current
      if (!state || state.pointerId !== event.pointerId) return
      const delta = event.clientY - state.lastY
      state.lastY = event.clientY
      scrollBy(delta / zoom())
    }

    const endDrag = (event: PointerEvent) => {
      if (drag.current?.pointerId !== event.pointerId) return
      drag.current = null
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId)
      }
      setCanvasCursor('grab')
    }

    setCanvasCursor('grab')
    element.addEventListener('wheel', handleWheel, { passive: false })
    element.addEventListener('pointerdown', handlePointerDown)
    element.addEventListener('pointermove', handlePointerMove)
    element.addEventListener('pointerup', endDrag)
    element.addEventListener('pointercancel', endDrag)
    return () => {
      element.removeEventListener('wheel', handleWheel)
      element.removeEventListener('pointerdown', handlePointerDown)
      element.removeEventListener('pointermove', handlePointerMove)
      element.removeEventListener('pointerup', endDrag)
      element.removeEventListener('pointercancel', endDrag)
    }
  }, [camera, controlsRef, gl, max, min, step])

  return null
}

function PanBounds({
  controlsRef,
  clamp,
}: {
  controlsRef: RefObject<ControlsImpl | null>
  clamp: (x: number, z: number) => [number, number]
}) {
  const camera = useThree((state) => state.camera)

  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    const target = controls.target
    const [nextX, nextZ] = clamp(target.x, target.z)
    if (nextX === target.x && nextZ === target.z) return
    shiftCameraXZ(camera, nextX - target.x, nextZ - target.z)
    target.x = nextX
    target.z = nextZ
    controls.update()
  })

  return null
}

function ResponsiveZoom({
  baseZoom,
  reference = ZOOM_REFERENCE,
}: {
  baseZoom: number
  reference?: number
}) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  useEffect(() => {
    const apply = () => {
      const orthographic = camera as OrthographicCamera
      if (typeof orthographic.zoom !== 'number') return
      setOrthographicZoom(orthographic, baseZoom * (Math.min(size.width, size.height) / reference))
    }
    apply()
  }, [camera, size, baseZoom, reference])

  return null
}

export default function SceneCanvas({
  children,
  camera = { position: ISO_CAMERA.position, zoom: ISO_CAMERA.zoom, near: 0.1, far: 1000 },
  orthographic = true,
  controls = {},
  onPointerMissed,
  verticalScroll,
  panBounds,
  responsiveZoom = true,
  grid = true,
}: SceneCanvasProps) {
  const controlsRef = useRef<ControlsImpl>(null)
  const baseZoom = camera.zoom ?? ISO_CAMERA.zoom

  const mergedControls: Partial<MapControlsProps> = verticalScroll
    ? { enablePan: false, enableZoom: false, enableRotate: false, ...controls }
    : {
        enableRotate: false,
        screenSpacePanning: false,
        enableDamping: true,
        dampingFactor: 0.15,
        minZoom: 20,
        maxZoom: 400,
        target: [0, 0, 0],
        ...controls,
      }

  return (
    <Canvas
      orthographic={orthographic}
      camera={camera}
      gl={{ alpha: true, antialias: true }}
      onPointerMissed={onPointerMissed}
    >
      <hemisphereLight args={['#cfe6ff', '#9fb98a', 0.75]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 14, 6]} intensity={1.7} color="#fff6e2" />
      <directionalLight position={[-6, 4, -8]} intensity={0.3} color="#cfe0ff" />

      {grid && <Ground />}

      {children}

      {orthographic && responsiveZoom && <ResponsiveZoom baseZoom={baseZoom} />}

      {controls !== false && <MapControls ref={controlsRef} makeDefault {...mergedControls} />}

      {panBounds && <PanBounds controlsRef={controlsRef} clamp={panBounds.clamp} />}

      {verticalScroll && (
        <VerticalScroll
          controlsRef={controlsRef}
          min={verticalScroll.min}
          max={verticalScroll.max}
          step={verticalScroll.step}
        />
      )}
    </Canvas>
  )
}
