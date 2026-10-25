import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  BLAST_DELAY,
  BOMB_CENTER,
  COAST_DAMPING,
  DIM_START,
  easeInOutCubic,
  FACE_Z,
  FLIGHT_SECONDS,
  MODULE_FIT_SIZE,
  PITCH_STEP,
  SNAP_STRENGTH,
  useBombContent,
  YAW_STEP,
  type BombContentProps,
} from '../../game/Bomb3D'
import { playBoom, playClank } from '../../game/boom'
import { shatterBomb, stepDebris, type FloorAt, type Piece } from '../../game/debris'
import Explosion from '../../game/Explosion'
import { isDrag } from '../interaction'
import { roomZoom } from '../cameras'

/** Width of the bomb lying on the table, and once picked up (it comes towards the camera). */
const REST_WIDTH = 0.9
const LIFT_WIDTH = 1.5
/** Picked up, the bomb floats this far in front of the camera, a bit above its line of sight (clear of the table). */
const LIFT_DISTANCE = 2.6
const LIFT_RAISE = 0.28
/** Clicks that miss the picked-up bomb land on an invisible wall behind it and put it back. */
const BACKDROP_DISTANCE = LIFT_DISTANCE + 2
/** Scroll range for the picked-up bomb, as a factor on its size. */
const MIN_ZOOM = 0.6
const MAX_ZOOM = 1.8
/** How quickly the size follows the scroll wheel (per second). */
const ZOOM_EASE = 12
const HOVER_SCALE = 1.04

/** Where the bomb is, how it is turned and how large, plus the camera zoom that goes with it. */
type Pose = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: number; zoom: number }
type Flight = { from: Pose; to: Pose; t: number; focusing: boolean }

/** Turning the picked-up bomb, same feel as turning the camera on the bomb page. */
type Spin = {
  yaw: number
  pitch: number
  /** Size factor set by the scroll wheel. */
  zoom: number
  enabled: boolean
  dragging: boolean
  snap: boolean
  x: number
  y: number
  t: number
  vYaw: number
  vPitch: number
}

const newSpin = (): Spin => ({
  yaw: 0,
  pitch: 0,
  zoom: 1,
  enabled: false,
  dragging: false,
  snap: false,
  x: 0,
  y: 0,
  t: 0,
  vYaw: 0,
  vPitch: 0,
})

const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)

/** Pitch around the screen's horizontal axis, yaw around the bomb's own up axis. */
function spinQuaternion(s: Spin) {
  return new THREE.Quaternion()
    .setFromAxisAngle(X_AXIS, s.pitch)
    .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, s.yaw))
}

/** Reflections for the bomb's metal parts only; the room itself keeps its plain lighting. */
function useBombEnvironment() {
  const gl = useThree((state) => state.gl)
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    return texture
  }, [gl])
  useEffect(() => () => env.dispose(), [env])
  return env
}

export type RoomBombProps = Omit<BombContentProps, 'interactive' | 'ownMaterials'> & {
  /** Middle of the bomb's underside while it lies on the table. */
  rest: [number, number, number]
  /** Picked up: floats in front of the camera and can be turned by dragging. */
  lifted: boolean
  onLift: () => void
  onPutDown: () => void
  /** Called the moment the bomb blows up (a moment after `exploded`, once it lies on the table again). */
  onBlast?: () => void
  /** Where the pieces of a blown-up bomb land (world height under a point); the room floor otherwise. */
  floorAt?: FloorAt
}

/**
 * The bomb in a room. On the table it is a prop: hover and click to pick it up. Picked up, it floats
 * in front of the camera; drag to turn it, click a module to bring that module in front of the camera.
 * The camera never moves; it only zooms in while a module is open, as on the bomb page.
 */
export default function RoomBomb({ rest, lifted, onLift, onPutDown, onBlast, floorAt, ...content }: RoomBombProps) {
  const { focused, exploded = false } = content
  const { bomb, setArrived, dimOn, portals, handlers } = useBombContent({
    ...content,
    interactive: lifted,
    ownMaterials: true,
  })
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera
  const size = useThree((state) => state.size)
  const gl = useThree((state) => state.gl)
  const env = useBombEnvironment()

  // Bounds of the bare hull: the bomb turns around its centre.
  const bounds = useMemo(() => {
    const box = new THREE.Box3().setFromObject(bomb)
    const center = box.getCenter(new THREE.Vector3())
    const extent = box.getSize(new THREE.Vector3())
    return { center, extent, width: Math.max(extent.x, extent.z) }
  }, [bomb])

  // Follows the viewport, so small screens zoom out and keep the table in view.
  const baseZoom = roomZoom(size)
  const [restX, restY, restZ] = rest

  const poses = useMemo(() => {
    const forward = camera.getWorldDirection(new THREE.Vector3())
    const liftScale = LIFT_WIDTH / bounds.width
    const sight = camera.position.clone().addScaledVector(forward, LIFT_DISTANCE)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    const liftCenter = sight.clone().addScaledVector(up, LIFT_RAISE)
    const restScale = REST_WIDTH / bounds.width
    return {
      forward,
      liftScale,
      rest: (): Pose => ({
        position: new THREE.Vector3(restX, restY + (bounds.extent.y / 2) * restScale, restZ),
        quaternion: new THREE.Quaternion(),
        scale: restScale,
        zoom: baseZoom,
      }),
      lift: (spin: Spin): Pose => ({
        position: liftCenter.clone(),
        quaternion: spinQuaternion(spin),
        scale: liftScale * spin.zoom,
        zoom: baseZoom,
      }),
      /** Module turned to face the camera, upright, its face on the line of sight (the zoom centre); zoomed in until it fills the screen. */
      focus: (index: number): Pose | null => {
        const slot = bomb.getObjectByName(`Slot_${index + 1}`)
        if (!slot) return null
        bomb.updateMatrixWorld(true)
        const local = bomb.matrixWorld.clone().invert().multiply(slot.matrixWorld)
        const slotPosition = new THREE.Vector3()
        const slotQuaternion = new THREE.Quaternion()
        local.decompose(slotPosition, slotQuaternion, new THREE.Vector3())
        const quaternion = camera.quaternion.clone().multiply(slotQuaternion.clone().invert())
        const face = slotPosition
          .sub(bounds.center)
          .addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(slotQuaternion), FACE_Z)
          .applyQuaternion(quaternion)
          .multiplyScalar(liftScale)
        return {
          position: sight.clone().sub(face),
          quaternion,
          scale: liftScale,
          zoom: Math.min(size.width, size.height) / (MODULE_FIT_SIZE * liftScale),
        }
      },
    }
  }, [bomb, bounds, camera, baseZoom, restX, restY, restZ, size])

  const holder = useRef<THREE.Group>(null)
  const [pose] = useState(() => poses.rest())
  const spin = useRef(newSpin())
  const flight = useRef<Flight | null>(null)
  const wasLifted = useRef(false)

  // Pick up, put down, open and close a module: each one an eased move from where the bomb is now.
  // When it goes off, it goes back onto the table first, so the whole room sees it blow up.
  useEffect(() => {
    const s = spin.current
    if (lifted && !wasLifted.current) Object.assign(s, newSpin())
    wasLifted.current = lifted
    const to = exploded || !lifted ? poses.rest() : focused !== null ? poses.focus(focused) : poses.lift(s)
    if (!to) return
    setArrived(false)
    dimOn.current = false
    s.enabled = false
    s.dragging = false
    flight.current = {
      from: { ...pose, position: pose.position.clone(), quaternion: pose.quaternion.clone() },
      to,
      t: 0,
      focusing: !exploded && lifted && focused !== null,
    }
  }, [lifted, focused, exploded, poses, pose, setArrived, dimOn])

  // Drag anywhere to turn the picked-up bomb. Once let go, a flick coasts out and it eases into the nearest stop.
  useEffect(() => {
    const canvas = gl.domElement
    const s = spin.current
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !s.enabled) return
      Object.assign(s, { dragging: true, x: e.clientX, y: e.clientY, t: e.timeStamp, vYaw: 0, vPitch: 0 })
    }
    const move = (e: PointerEvent) => {
      if (!s.dragging) return
      const perPixel = (2 * Math.PI) / Math.max(canvas.clientHeight, 1)
      // upside down, sideways turns the other way round
      const dYaw = (e.clientX - s.x) * perPixel * (Math.cos(s.pitch) >= 0 ? 1 : -1)
      const dPitch = (e.clientY - s.y) * perPixel
      const dt = Math.max(1, e.timeStamp - s.t) / 1000
      s.vYaw = s.vYaw * 0.6 + (dYaw / dt) * 0.4
      s.vPitch = s.vPitch * 0.6 + (dPitch / dt) * 0.4
      if (Math.abs(e.clientX - s.x) + Math.abs(e.clientY - s.y) > 0) s.snap = true
      Object.assign(s, { yaw: s.yaw + dYaw, pitch: s.pitch + dPitch, x: e.clientX, y: e.clientY, t: e.timeStamp })
    }
    const up = (e: PointerEvent) => {
      if (!s.dragging) return
      s.dragging = false
      // pointer held still before letting go: no flick
      if (e.timeStamp - s.t > 80) [s.vYaw, s.vPitch] = [0, 0]
    }
    // Scroll: bring the picked-up bomb closer or push it away (it grows and shrinks; the room stays put).
    const wheel = (e: WheelEvent) => {
      if (!s.enabled) return
      e.preventDefault()
      s.zoom = THREE.MathUtils.clamp(s.zoom * Math.exp(-e.deltaY * 0.001), MIN_ZOOM, MAX_ZOOM)
    }
    canvas.style.touchAction = 'none'
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('wheel', wheel)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [gl])

  useFrame((_, delta) => {
    const f = flight.current
    const s = spin.current
    if (f) {
      f.t = Math.min(1, f.t + delta / FLIGHT_SECONDS)
      const e = easeInOutCubic(f.t)
      pose.position.lerpVectors(f.from.position, f.to.position, e)
      pose.quaternion.slerpQuaternions(f.from.quaternion, f.to.quaternion, e)
      pose.scale = THREE.MathUtils.lerp(f.from.scale, f.to.scale, e)
      pose.zoom = THREE.MathUtils.lerp(f.from.zoom, f.to.zoom, e)
      if (f.focusing && f.t >= DIM_START) dimOn.current = true
      if (f.t >= 1) {
        flight.current = null
        if (f.focusing) setArrived(true)
        else if (lifted && !exploded) s.enabled = true
      }
    } else if (s.enabled) {
      if (!s.dragging) {
        const dt = Math.min(delta, 1 / 20)
        s.yaw += s.vYaw * dt
        s.pitch += s.vPitch * dt
        const coast = Math.exp(-dt * COAST_DAMPING)
        s.vYaw *= coast
        s.vPitch *= coast
        if (s.snap) {
          const k = 1 - Math.exp(-dt * SNAP_STRENGTH)
          s.yaw += (Math.round(s.yaw / YAW_STEP) * YAW_STEP - s.yaw) * k
          s.pitch += (Math.round(s.pitch / PITCH_STEP) * PITCH_STEP - s.pitch) * k
        }
      }
      pose.quaternion.copy(spinQuaternion(s))
      const scale = poses.liftScale * s.zoom
      pose.scale += (scale - pose.scale) * (1 - Math.exp(-Math.min(delta, 1 / 20) * ZOOM_EASE))
    }

    const g = holder.current
    if (g) {
      g.position.copy(pose.position)
      g.quaternion.copy(pose.quaternion)
      g.scale.setScalar(pose.scale)
    }
    if (camera.zoom !== pose.zoom) {
      camera.zoom = pose.zoom
      camera.updateProjectionMatrix()
    }

    // The bomb's own reflections, also for module controls that appear later.
    bomb.traverse((object) => {
      const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
      if (!material?.isMeshStandardMaterial || material.envMap === env) return
      material.envMap = env
      material.envMapIntensity = 0.9
      material.needsUpdate = true
    })
  })

  // Explosion, as on the bomb page: back on the table, a short pause, then the bomb is torn apart
  // (see debris.ts) and its pieces land on the table and the floor. The bomb is a fresh clone per game.
  const [blasted, setBlasted] = useState(false)
  const countdown = useRef(0)
  const debris = useRef<Piece[]>([])
  const clanks = useRef(0)
  useEffect(() => {
    if (!blasted) return
    playBoom()
    debris.current = shatterBomb(bomb)
  }, [blasted, bomb])

  useFrame((_, delta) => {
    if (!exploded) return
    const dt = Math.min(delta, 1 / 30)
    if (!blasted) {
      if (!flight.current) countdown.current += dt
      if (countdown.current > BLAST_DELAY) {
        setBlasted(true)
        onBlast?.()
      }
      return
    }
    // at most a few clangs per frame, or it turns into noise
    clanks.current = 0
    stepDebris(
      debris.current,
      dt,
      (speed) => {
        if (clanks.current++ < 3) playClank(speed)
      },
      floorAt,
    )
  })

  useEffect(
    () => () => {
      camera.zoom = baseZoom
      camera.updateProjectionMatrix()
    },
    [camera, baseZoom],
  )

  // Lying on the table: one invisible box catches the pointer, so the gaps between modules don't break hovering.
  const [hovered, setHovered] = useState(false)
  const resting = !lifted && !exploded
  useEffect(() => {
    if (!hovered || !resting) return
    document.body.style.cursor = 'pointer'
    return () => void (document.body.style.cursor = '')
  }, [hovered, resting])

  const lift = (event: ThreeEvent<MouseEvent>) => {
    if (isDrag(event)) return
    event.stopPropagation()
    setHovered(false)
    onLift()
  }

  const backdrop = useMemo(
    () => ({
      position: camera.position.clone().addScaledVector(poses.forward, BACKDROP_DISTANCE),
      quaternion: camera.quaternion.clone(),
    }),
    [camera, poses],
  )

  return (
    <>
      <group ref={holder}>
        <group scale={resting && hovered ? HOVER_SCALE : 1}>
          {portals}
          <primitive object={bomb} position={bounds.center.clone().negate()} {...handlers} />
          {blasted && (
            <group position={bounds.center.clone().negate()}>
              <Explosion center={BOMB_CENTER} />
            </group>
          )}
        </group>
        {resting && (
          <mesh
            scale={HOVER_SCALE}
            onClick={lift}
            onPointerOver={(event) => {
              event.stopPropagation()
              setHovered(true)
            }}
            onPointerOut={() => setHovered(false)}
          >
            <boxGeometry args={[bounds.extent.x, bounds.extent.y, bounds.extent.z]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
      </group>

      {lifted && !exploded && focused === null && (
        <mesh
          position={backdrop.position}
          quaternion={backdrop.quaternion}
          onClick={(event) => {
            if (event.delta > 4) return // was a drag to turn the bomb
            onPutDown()
          }}
        >
          <planeGeometry args={[60, 60]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </>
  )
}
