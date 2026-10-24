import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { playBoom, playClank } from './boom'
import { shatterBomb, stepDebris, type Piece } from './debris'
import Explosion from './Explosion'

const BASE = '/models/bomb'
const BOMB_URL = `${BASE}/bomb.glb`
const moduleUrl = (id: string) => `${BASE}/modules/${id}.glb`

/** Module ids that have a model in public/models/bomb/modules; others fall back to the blank cover. */
const MODEL_IDS = new Set([
  'wires', 'fuses', 'switches', 'rotary', 'cables', 'sorter', 'lock', 'terminal', 'buttons', 'slider', 'radar',
])

/** Slot_0 holds the timer; question modules go into Slot_1 … Slot_11. */
export const BOMB_SLOTS = 11

export type SlotStatus = 'active' | 'sending' | 'solved' | 'failed' | 'submitted'

const LED_COLORS: Record<SlotStatus, string | null> = {
  active: null,
  sending: '#ffd23f',
  solved: '#3dff6e',
  failed: '#ff3b3b',
  submitted: '#3fe6ff',
}

type Bomb3DProps = {
  /** One entry per planned module, in plan order; entry i goes into Slot_{i+1}. */
  modules: {
    id: string
    status: SlotStatus
    /** 3D controls built for the task; replace the static parts of the module model. */
    content3d?: ReactNode
  }[]
  /** Module the camera is zoomed in on; null = free-rotating overview. */
  focused: number | null
  /** 'center': card over the module (2D modules); 'side': card beside it (3D modules are worked on directly). */
  overlay?: 'center' | 'side'
  onSelect: (index: number) => void
  onBack: () => void
  timeLeft: number
  strikes: number
  /** The bomb went off: the camera zooms out to a wide view, then the bomb blows apart. */
  exploded?: boolean
  /** Internal: called the moment the blast happens (after the camera has zoomed out). */
  onBlast?: () => void
  /** UI of the focused module, shown over the zoomed-in module. */
  children?: ReactNode
  /** Only the bomb: no hint, no back button (click beside the module or press Esc to zoom out). */
  bare?: boolean
}

/** Module face (1×1 m) plus a small margin; zoomed in, this fills the screen. */
const MODULE_FIT_SIZE = 1.04
const OVERVIEW_TARGET: [number, number, number] = [0, 1.4, 0]

/** Parts of a module model kept when its 3D controls are generated from the task. */
const MODULE_FRAME_PARTS = /Plate|Screw|StatusRing|StatusLED/

type CameraGoal = { position: THREE.Vector3; target: THREE.Vector3; up?: THREE.Vector3 }
type Flight = { from: CameraGoal; to: CameraGoal; fromUp: THREE.Vector3; toUp: THREE.Vector3; t: number; zoomingOut: boolean }

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/** Camera up vector during a flight: rolls from fromUp to toUp (around the view axis if they are opposite). */
function rotateUp(f: Flight, t: number) {
  const angle = f.fromUp.angleTo(f.toUp)
  if (angle < 1e-4) return f.toUp.clone()
  let axis = f.fromUp.clone().cross(f.toUp)
  if (axis.lengthSq() < 1e-8) axis = f.to.target.clone().sub(f.to.position)
  return f.fromUp.clone().applyAxisAngle(axis.normalize(), angle * t)
}

const FLIGHT_SECONDS = 0.9
const OVERVIEW_MIN_DISTANCE = 3.5
const OVERVIEW_MAX_DISTANCE = 10
const OVERVIEW_CAMERA: [number, number, number] = [2.6, 3.2, 5.6]
const ARC_CENTER = new THREE.Vector3(...OVERVIEW_TARGET)

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Point between a and b on an arc around the bomb centre: direction slerped, distance lerped. */
function arcPoint(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const da = a.clone().sub(ARC_CENTER)
  const db = b.clone().sub(ARC_CENTER)
  const radius = THREE.MathUtils.lerp(da.length(), db.length(), t)
  const ua = da.normalize()
  const ub = db.normalize()
  const angle = ua.angleTo(ub)
  const dir =
    angle < 1e-4
      ? ua.lerp(ub, t)
      : ua.multiplyScalar(Math.sin((1 - t) * angle)).add(ub.multiplyScalar(Math.sin(t * angle))).divideScalar(Math.sin(angle))
  return dir.normalize().multiplyScalar(radius).add(ARC_CENTER)
}

function formatTime(seconds: number) {
  const s = Math.max(0, seconds)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function RoomEnv() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  return null
}

const DIM_OPACITY = 0.7
const DIM_Z = 0.25
/** Front face of a module plate, in slot space. */
const FACE_Z = 0.08

/** Camera distance at which the module face just fits the viewport (height or width, whichever is tighter). */
function moduleDistance(camera: THREE.PerspectiveCamera, size: { width: number; height: number }) {
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2)
  const aspect = size.width / Math.max(size.height, 1)
  return (MODULE_FIT_SIZE / 2 / Math.tan(halfFov)) * Math.max(1, 1 / aspect)
}

/** Edge of the bright window (the module), and how far the darkness takes to fade in beyond it. */
const DIM_HOLE = 0.5
const DIM_SOFTNESS = 0.14
/** Seconds the darkness takes to come up (and, twice as fast, to go away again). */
const DIM_SECONDS = 0.35
/** The darkness starts while the camera is still landing (share of the flight), so both blend into each other. */
const DIM_START = 0.75

/**
 * Dark plane in front of the focused module that dims the rest of the bomb. The module stays bright;
 * the darkness fades in softly from the module edge instead of starting at a hard line.
 */
function makeDimFrame() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uOpacity: { value: 0 },
      uHole: { value: DIM_HOLE },
      uSoftness: { value: DIM_SOFTNESS },
      uColor: { value: new THREE.Color('#05070a') },
    },
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      uniform float uHole;
      uniform float uSoftness;
      uniform vec3 uColor;
      varying vec2 vPos;
      void main() {
        // Distance from the module square (rounded outside the corners).
        float d = length(max(abs(vPos) - vec2(uHole), 0.0));
        gl_FragColor = vec4(uColor, uOpacity * smoothstep(0.0, uSoftness, d));
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), material)
  // Only a visual: clicks and drags go through to the module and the bomb behind it.
  mesh.raycast = () => {}
  // In front of everything that sticks out of the bomb next to the module (rails, flanges, neighbours).
  mesh.position.z = DIM_Z
  mesh.visible = false
  return mesh
}

/** Orange frame shown around the hovered module. */
function makeSelectionFrame() {
  const frame = new THREE.Group()
  const material = new THREE.MeshBasicMaterial({ color: '#ff8a1f', toneMapped: false })
  const size = 1.04
  const bar = 0.035
  for (const [w, h, x, y] of [
    [size + bar, bar, 0, size / 2],
    [size + bar, bar, 0, -size / 2],
    [bar, size, size / 2, 0],
    [bar, size, -size / 2, 0],
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), material)
    mesh.position.set(x, y, 0.1)
    mesh.raycast = () => {}
    frame.add(mesh)
  }
  return frame
}

/** The timer digits in the model are static; this draws the live time onto a canvas texture. */
function makeTimerDisplay() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.26),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  )
  const draw = (text: string, low: boolean) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#05070a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = low ? '#ff4d4d' : '#3fe6ff'
    ctx.font = 'bold 72px ui-monospace, "SF Mono", Menlo, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4)
    texture.needsUpdate = true
  }
  return { mesh, draw }
}

/**
 * Overview turning snaps lightly when you let go: around the bomb to quarter turns, up and down to
 * the hull faces (60° apart). Up and down has no stop, it carries on over the top and underneath.
 */
const YAW_STEP = Math.PI / 2
const PITCH_STEP = Math.PI / 3
/** How hard the view is pulled into the nearest stop once released (per second). */
const SNAP_STRENGTH = 7
/** How quickly a flick coasts out (per second). */
const COAST_DAMPING = 6

/**
 * Turning weights per input. A finger sweeps far over a small screen and swipes fast, so on touch
 * the bomb turns less per pixel, a flick carries less speed (capped) and coasts out sooner.
 */
const TURN_WEIGHTS = {
  mouse: { perPixel: 1, maxFlick: 8, coast: COAST_DAMPING },
  touch: { perPixel: 0.45, maxFlick: 3, coast: 9 },
} as const
type TurnWeights = (typeof TURN_WEIGHTS)[keyof typeof TURN_WEIGHTS]

/** Camera orbit around the bomb centre: angles in radians, pitch unbounded. */
type Orbit = {
  target: THREE.Vector3
  yaw: number
  pitch: number
  distance: number
  enabled: boolean
  dragging: boolean
  /** Weights of the input that turned the view last (mouse or touch). */
  weights: TurnWeights
  /** Snapping starts after the first real turn, so the opening view stays as it is. */
  snap: boolean
  x: number
  y: number
  t: number
  vYaw: number
  vPitch: number
}

function initialOrbit(): Orbit {
  const target = new THREE.Vector3(...OVERVIEW_TARGET)
  const offset = new THREE.Vector3(...OVERVIEW_CAMERA).sub(target)
  const distance = offset.length()
  return {
    target,
    yaw: Math.atan2(offset.x, offset.z),
    pitch: Math.asin(offset.y / distance),
    distance,
    enabled: true,
    dragging: false,
    weights: TURN_WEIGHTS.mouse,
    snap: false,
    x: 0,
    y: 0,
    t: 0,
    vYaw: 0,
    vPitch: 0,
  }
}

/** Puts the camera on the orbit. Past the top or bottom it looks at the bomb upside down from the other side. */
function applyOrbit(o: Orbit, camera: THREE.Camera) {
  const [cp, sp, cy, sy] = [Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.yaw), Math.sin(o.yaw)]
  camera.position.set(cp * sy, sp, cp * cy).multiplyScalar(o.distance).add(o.target)
  camera.up.set(-sp * sy, cp, -sp * cy)
  camera.lookAt(o.target)
}

const noRaycast = () => {}

/**
 * Shows or hides a static part of a module model. Hidden parts must not catch clicks either:
 * three.js raycasts invisible meshes too, and they sit in front of the 3D controls that replace them.
 */
function showPart(part: THREE.Object3D, visible: boolean) {
  part.visible = visible
  part.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) object.raycast = visible ? THREE.Mesh.prototype.raycast : noRaycast
  })
}

const BAY_SIZE = 1.02
const BAY_RIM = 0.035
const BAY_DEPTH = 0.06

/**
 * Unused slot: no module screwed in, just the open bay. A rim around a dark pit, the four empty
 * mounting posts and the bare connector a module would plug into.
 */
function makeEmptyBay() {
  const bay = new THREE.Group()
  bay.userData.planIndex = null
  const rim = new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.7, roughness: 0.45 })
  const pit = new THREE.MeshStandardMaterial({ color: '#08090b', roughness: 0.95 })
  const wall = new THREE.MeshStandardMaterial({ color: '#16181c', metalness: 0.3, roughness: 0.8 })
  const brass = new THREE.MeshStandardMaterial({ color: '#b08d57', metalness: 0.9, roughness: 0.3 })
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    bay.add(mesh)
    return mesh
  }

  // floor of the pit, just above the hull's recess plate
  add(new THREE.BoxGeometry(BAY_SIZE - BAY_RIM, BAY_SIZE - BAY_RIM, 0.004), pit, 0, 0, 0.007)
  // rim on all four sides; its dark inner face reads as the pit wall
  const half = BAY_SIZE / 2 - BAY_RIM / 2
  for (const [w, h, x, y] of [
    [BAY_SIZE, BAY_RIM, 0, half],
    [BAY_SIZE, BAY_RIM, 0, -half],
    [BAY_RIM, BAY_SIZE - BAY_RIM * 2, half, 0],
    [BAY_RIM, BAY_SIZE - BAY_RIM * 2, -half, 0],
  ]) {
    add(new THREE.BoxGeometry(w, h, BAY_DEPTH), rim, x, y, BAY_DEPTH / 2 + 0.005)
    const inset = (BAY_RIM / 2 + 0.004) * (x === 0 ? Math.sign(y) : Math.sign(x))
    add(
      new THREE.BoxGeometry(x === 0 ? w - BAY_RIM * 2 : 0.006, x === 0 ? 0.006 : h, BAY_DEPTH - 0.008),
      wall,
      x === 0 ? 0 : x - inset,
      x === 0 ? y - inset : 0,
      BAY_DEPTH / 2 + 0.006,
    )
  }
  // empty threaded posts where the module screws would go
  const post = new THREE.CylinderGeometry(0.03, 0.034, 0.04, 20).rotateX(Math.PI / 2)
  const hole = new THREE.CylinderGeometry(0.012, 0.012, 0.002, 16).rotateX(Math.PI / 2)
  for (const x of [-0.44, 0.44]) {
    for (const y of [-0.44, 0.44]) {
      add(post, rim, x, y, 0.029)
      add(hole, pit, x, y, 0.05)
    }
  }
  // bare connector at the bottom of the pit
  add(new THREE.BoxGeometry(0.34, 0.07, 0.03), wall, 0, -0.3, 0.024)
  const pin = new THREE.BoxGeometry(0.012, 0.012, 0.024)
  for (let k = 0; k < 10; k++) add(pin, brass, -0.135 + k * 0.03, -0.3, 0.045)
  return bay
}

/** Camera for the explosion: far enough out to see the bomb blow apart and its parts land, from a little above. */
const BLAST_DISTANCE = 11
const BLAST_PITCH = 0.5
/** Seconds between the camera being out of the module and the blast, so it is pulled back by then. */
const BLAST_DELAY = 0.9

/** Height of the bomb's centre, where the explosion starts. */
const BOMB_CENTER: [number, number, number] = [0, 1.55, 0]

function BombModel({ modules, focused, onSelect, onBack, timeLeft, strikes, exploded = false, onBlast }: Bomb3DProps) {
  const { scene } = useGLTF(BOMB_URL)
  const bomb = useMemo(() => scene.clone(true), [scene])

  const idsKey = modules
    .slice(0, BOMB_SLOTS)
    .map((m) => (MODEL_IDS.has(m.id) ? m.id : 'blank'))
    .join(',')
  const framesKey = modules.map((m) => (m.content3d ? 1 : 0)).join('')
  const ids = useMemo(() => [...new Set([...idsKey.split(',').filter(Boolean), 'blank'])], [idsKey])
  const gltfs = useGLTF(ids.map(moduleUrl)) as unknown as { scene: THREE.Group }[]

  // One model per slot: the planned module, or an open, empty bay for unused slots.
  const instances = useMemo(() => {
    const sources = new Map(ids.map((id, i) => [id, gltfs[i].scene]))
    const planned = idsKey ? idsKey.split(',') : []
    return Array.from({ length: BOMB_SLOTS }, (_, i) => {
      if (i >= planned.length) return { root: makeEmptyBay(), leds: [] }
      const root = sources.get(planned[i])!.clone(true)
      root.userData.planIndex = i < planned.length ? i : null
      if (framesKey[i] === '1') {
        // The GLB scene wraps one module node; hide its static controls, keep plate, screws and LED.
        const module = root.getObjectByProperty('name', root.children[0]?.name) ?? root
        for (const part of module.children) showPart(part, MODULE_FRAME_PARTS.test(part.name))
      }
      const leds: THREE.MeshStandardMaterial[] = []
      root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (mesh.isMesh && object.name.includes('StatusLED')) {
          const material = (mesh.material as THREE.MeshStandardMaterial).clone()
          mesh.material = material
          leds.push(material)
        }
      })
      return { root, leds }
    })
  }, [ids, gltfs, idsKey, framesKey])

  useEffect(() => {
    instances.forEach((inst, i) => bomb.getObjectByName(`Slot_${i + 1}`)?.add(inst.root))
    return () => instances.forEach((inst) => inst.root.removeFromParent())
  }, [bomb, instances])

  // Status LEDs
  useEffect(() => {
    instances.forEach((inst, i) => {
      const color = modules[i] ? LED_COLORS[modules[i].status] : null
      for (const led of inst.leds) {
        led.emissive.set(color ?? '#000000')
        led.emissiveIntensity = color ? 1.2 : 0
        led.color.set(color ?? '#0d140d')
      }
    })
  }, [instances, modules])

  // Hover frame (overview only)
  const [hovered, setHovered] = useState<number | null>(null)
  const frame = useMemo(() => makeSelectionFrame(), [])
  useEffect(() => {
    if (hovered === null || focused !== null) return
    bomb.getObjectByName(`Slot_${hovered + 1}`)?.add(frame)
    return () => {
      frame.removeFromParent()
    }
  }, [bomb, frame, hovered, focused])

  // Camera: fly to the focused module's face, and back to where the overview was left.
  // The flight is an eased arc around the bomb centre, so the camera never cuts through the bomb.
  // Zoomed in, the rest of the bomb is dimmed by a dark frame with a module-sized hole in front of the module.
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const orbit = useRef(initialOrbit())
  const flight = useRef<Flight | null>(null)
  const overview = useRef<CameraGoal | null>(null)
  /** The camera has reached the focused module; only then is it dimmed and playable. */
  const [arrived, setArrived] = useState(false)
  /** Darkness requested: set shortly before the camera lands. */
  const dimOn = useRef(false)

  const isolate = useCallback(
    (index: number | null) => {
      // A focused 2D module shows its minigame on a blank plate: hide its static controls meanwhile.
      instances.forEach((inst, i) => {
        if (framesKey[i] === '1') return
        for (const part of inst.root.children[0]?.children ?? []) {
          showPart(part, i !== index || MODULE_FRAME_PARTS.test(part.name))
        }
      })
    },
    [instances, framesKey],
  )

  useEffect(() => {
    const controls = orbit.current
    let to: CameraGoal | null = null
    let toUp = WORLD_UP
    if (focused !== null) {
      const slot = bomb.getObjectByName(`Slot_${focused + 1}`)
      if (!slot) return
      bomb.updateMatrixWorld(true)
      overview.current ??= { position: camera.position.clone(), target: controls.target.clone(), up: camera.up.clone() }
      const center = slot.getWorldPosition(new THREE.Vector3())
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(slot.getWorldQuaternion(new THREE.Quaternion()))
      const distance = moduleDistance(camera as THREE.PerspectiveCamera, size)
      const face = center.clone().addScaledVector(normal, FACE_Z)
      to = { target: face, position: face.clone().addScaledVector(normal, distance) }
      // Keep the module upright on screen, also on the back and underside of the bomb.
      toUp = new THREE.Vector3(0, 1, 0).applyQuaternion(slot.getWorldQuaternion(new THREE.Quaternion()))
    } else if (overview.current) {
      isolate(null)
      to = overview.current
      toUp = overview.current.up ?? WORLD_UP
      overview.current = null
    }
    if (!to) return
    setArrived(false)
    dimOn.current = false
    controls.enabled = false
    flight.current = {
      from: { position: camera.position.clone(), target: controls.target.clone() },
      to,
      fromUp: camera.up.clone(),
      toUp,
      t: 0,
      zoomingOut: focused === null,
    }
  }, [bomb, camera, focused, isolate, size])

  const dim = useMemo(() => makeDimFrame(), [])
  useEffect(() => {
    if (focused === null) return
    bomb.getObjectByName(`Slot_${focused + 1}`)?.add(dim)
    dim.visible = true
    // The frame sits closer to the camera than the module face, so shrink it until its hole
    // lines up with the module edge on screen.
    const distance = moduleDistance(camera as THREE.PerspectiveCamera, size)
    dim.scale.setScalar((distance - (DIM_Z - FACE_Z)) / distance)
  }, [bomb, camera, dim, focused, size])

  useFrame((_, delta) => {
    // Sequence: fly to the module first, then bring up the darkness; on the way back it goes first.
    const opacity = (dim.material as THREE.ShaderMaterial).uniforms.uOpacity
    const goal = focused !== null && dimOn.current ? DIM_OPACITY : 0
    const step = (DIM_OPACITY / DIM_SECONDS) * delta
    opacity.value = goal > opacity.value ? Math.min(goal, opacity.value + step) : Math.max(goal, opacity.value - step * 2)
    if (focused === null && opacity.value === 0) {
      dim.visible = false
      dim.removeFromParent()
    }
  })

  useFrame((_, delta) => {
    const f = flight.current
    const controls = orbit.current
    if (!f) return
    f.t = Math.min(1, f.t + delta / FLIGHT_SECONDS)
    const e = easeInOutCubic(f.t)
    controls.target.lerpVectors(f.from.target, f.to.target, e)
    camera.position.copy(arcPoint(f.from.position, f.to.position, e))
    camera.up.copy(rotateUp(f, e))
    camera.lookAt(controls.target)
    if (!f.zoomingOut && f.t >= DIM_START) dimOn.current = true
    if (f.t < 1) return
    flight.current = null
    camera.up.copy(f.toUp)
    camera.lookAt(controls.target)
    if (f.zoomingOut) {
      controls.enabled = true
    } else {
      isolate(focused)
      setArrived(true)
    }
  })

  // Overview: drag to turn the camera around the bomb centre (as fast as the usual orbit controls),
  // scroll to zoom. Once let go, a flick coasts out and the view eases into the nearest stop.
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const canvas = gl.domElement
    const o = orbit.current
    canvas.style.touchAction = 'none'
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !o.enabled) return
      const weights = e.pointerType === 'mouse' ? TURN_WEIGHTS.mouse : TURN_WEIGHTS.touch
      Object.assign(o, { dragging: true, weights, x: e.clientX, y: e.clientY, t: e.timeStamp, vYaw: 0, vPitch: 0 })
    }
    const move = (e: PointerEvent) => {
      if (!o.dragging) return
      const perPixel = ((2 * Math.PI) / Math.max(canvas.clientHeight, 1)) * o.weights.perPixel
      // upside down (past the top or bottom), sideways turns the other way round
      const dYaw = -(e.clientX - o.x) * perPixel * (Math.cos(o.pitch) >= 0 ? 1 : -1)
      const dPitch = (e.clientY - o.y) * perPixel
      const dt = Math.max(1, e.timeStamp - o.t) / 1000
      o.vYaw = o.vYaw * 0.6 + (dYaw / dt) * 0.4
      o.vPitch = o.vPitch * 0.6 + (dPitch / dt) * 0.4
      if (Math.abs(e.clientX - o.x) + Math.abs(e.clientY - o.y) > 0) o.snap = true
      Object.assign(o, { yaw: o.yaw + dYaw, pitch: o.pitch + dPitch, x: e.clientX, y: e.clientY, t: e.timeStamp })
    }
    const up = (e: PointerEvent) => {
      if (!o.dragging) return
      o.dragging = false
      // pointer held still before letting go: no flick
      if (e.timeStamp - o.t > 80) [o.vYaw, o.vPitch] = [0, 0]
      // a flick never spins it wildly
      const max = o.weights.maxFlick
      o.vYaw = THREE.MathUtils.clamp(o.vYaw, -max, max)
      o.vPitch = THREE.MathUtils.clamp(o.vPitch, -max, max)
    }
    const wheel = (e: WheelEvent) => {
      if (!o.enabled) return
      e.preventDefault()
      o.distance = THREE.MathUtils.clamp(o.distance * Math.exp(e.deltaY * 0.001), OVERVIEW_MIN_DISTANCE, OVERVIEW_MAX_DISTANCE)
    }
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
    const o = orbit.current
    if (!o.enabled || flight.current) return
    if (!o.dragging) {
      const dt = Math.min(delta, 1 / 20)
      o.yaw += o.vYaw * dt
      o.pitch += o.vPitch * dt
      const coast = Math.exp(-dt * o.weights.coast)
      o.vYaw *= coast
      o.vPitch *= coast
      if (!o.snap) return applyOrbit(o, camera)
      const k = 1 - Math.exp(-dt * SNAP_STRENGTH)
      o.yaw += (Math.round(o.yaw / YAW_STEP) * YAW_STEP - o.yaw) * k
      o.pitch += (Math.round(o.pitch / PITCH_STEP) * PITCH_STEP - o.pitch) * k
    }
    applyOrbit(o, camera)
  })

  // Explosion, in two steps so it can be watched: first the camera leaves the module and pulls back
  // to a wide view, then the bomb is torn apart (see debris.ts) and the pieces crash onto the floor
  // and clatter. The bomb is a fresh clone for every round, so nothing has to be put back.
  const [blasted, setBlasted] = useState(false)
  const countdown = useRef(0)
  /** The player grabbed the view during the explosion: stop steering the camera. */
  const cameraTaken = useRef(false)
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
    const o = orbit.current
    if (o.dragging) cameraTaken.current = true
    if (!flight.current && !cameraTaken.current) {
      // wide view on the bomb (no snapping meanwhile, it would pull against this and jitter)
      o.snap = false
      const k = 1 - Math.exp(-dt * 2.2)
      o.distance += (BLAST_DISTANCE - o.distance) * k
      o.pitch += (BLAST_PITCH - o.pitch) * k
    }
    if (!blasted) {
      // out of the module and pulled back first, then it goes off
      if (!flight.current) countdown.current += dt
      if (countdown.current > BLAST_DELAY) {
        setBlasted(true)
        onBlast?.()
      }
      return
    }
    // at most a few clangs per frame, or it turns into noise
    clanks.current = 0
    stepDebris(debris.current, dt, (speed) => {
      if (clanks.current++ < 3) playClank(speed)
    })
  })

  // Live timer and strike marks on the fixed timer module
  const timer = useMemo(() => makeTimerDisplay(), [])
  useEffect(() => {
    const digits = bomb.getObjectByName('Timer_Digits')
    if (!digits?.parent) return
    digits.visible = false
    timer.mesh.position.copy(digits.position)
    timer.mesh.position.z += 0.005
    digits.parent.add(timer.mesh)
    return () => {
      timer.mesh.removeFromParent()
      digits.visible = true
    }
  }, [bomb, timer])

  useEffect(() => {
    timer.draw(formatTime(timeLeft), timeLeft <= 30)
  }, [timer, timeLeft])

  useEffect(() => {
    ;['Timer_Strike0', 'Timer_Strike1'].forEach((name, i) => {
      const mesh = bomb.getObjectByName(name) as THREE.Mesh | undefined
      if (!mesh?.isMesh) return
      const material = mesh.material as THREE.MeshStandardMaterial
      const hit = strikes > i
      material.emissive.set(hit ? '#ff2020' : '#000000')
      material.emissiveIntensity = hit ? 4 : 0
    })
  }, [bomb, strikes])

  function planIndexOf(object: THREE.Object3D | null): number | null {
    for (let o = object; o; o = o.parent) {
      if (o.userData.planIndex !== undefined) return o.userData.planIndex
    }
    return null
  }

  function handleClick(event: ThreeEvent<MouseEvent>) {
    const index = planIndexOf(event.object)
    event.stopPropagation()
    if (exploded) return
    // Inside the focused module the click belongs to its controls (they handled it before it bubbled
    // up here). Stopping it also keeps it from reaching the hull behind the module, which would zoom out.
    if (focused !== null && index === focused) return
    // A drag (turning the bomb, or a cable/block dragged out of the module) is never a click.
    if (event.delta > 4) return
    if (focused !== null) return onBack() // zoomed in: a click beside the module zooms out
    if (index !== null) onSelect(index)
  }

  /** Whether the object (or a part it belongs to) reacts to clicks or drags: a control of a module. */
  function isControl(object: THREE.Object3D | null) {
    for (let o = object; o && o !== bomb; o = o.parent) {
      const handlers = (o as THREE.Object3D & { __r3f?: { handlers?: Record<string, unknown> } }).__r3f?.handlers
      if (handlers && (handlers.onClick || handlers.onPointerDown || handlers.onWheel)) return true
    }
    return false
  }

  function handleHover(event: ThreeEvent<PointerEvent>) {
    if (exploded) return
    event.stopPropagation()
    // Zoomed in: a hand over every control of the open module, the plain pointer elsewhere.
    // (The wire cutter hides the pointer over its module; it sets the cursor itself.)
    if (focused !== null) {
      document.body.style.cursor = planIndexOf(event.object) === focused && isControl(event.object) ? 'pointer' : ''
      return
    }
    const index = planIndexOf(event.object)
    setHovered(index)
    document.body.style.cursor = index !== null ? 'pointer' : ''
  }

  useEffect(() => () => void (document.body.style.cursor = ''), [])

  const slotObjects = useMemo(
    () => Array.from({ length: BOMB_SLOTS }, (_, i) => bomb.getObjectByName(`Slot_${i + 1}`)),
    [bomb],
  )

  return (
    <>
      {modules.slice(0, BOMB_SLOTS).map((m, i) => {
        const slot = slotObjects[i]
        if (!m.content3d || !slot) return null
        return (
          <Fragment key={i}>
            {createPortal(
              <group userData={{ planIndex: i }}>
                {m.content3d}
                {/* Until the camera has arrived, a clear shield in front of the module swallows clicks. */}
                {focused === i && !arrived && (
                  <mesh position={[0, 0, 0.3]} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <planeGeometry args={[1.1, 1.1]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                )}
                {/* Any other module: a clear cover keeps its controls out of reach, so a click on it
                    always reaches the bomb (zoom in, or out when another module is open) instead of
                    being swallowed by a control that is not active yet. */}
                {focused !== i && (
                  <mesh position={[0, 0, 0.3]}>
                    <planeGeometry args={[1.04, 1.04]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                )}
              </group>,
              slot,
            )}
          </Fragment>
        )
      })}
      {blasted && <Explosion center={BOMB_CENTER} />}
      <primitive
        object={bomb}
        onClick={handleClick}
        onPointerMove={handleHover}
        onPointerOut={() => {
          setHovered(null)
          document.body.style.cursor = ''
        }}
      />
    </>
  )
}

/** One view: rotate the bomb, click a module to zoom in on it and show its UI on top. */
export default function Bomb3D(props: Bomb3DProps) {
  const { focused, overlay = 'center', onBack, children, bare = false } = props
  /** The blast itself happened (comes a moment after `exploded`, once the camera has zoomed out). */
  const [blasted, setBlasted] = useState(false)

  useEffect(() => {
    if (focused === null) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, onBack])

  // Clicks into empty space (beside the bomb) zoom out too, but only real clicks: the pointer must
  // not have moved between press and release, so drags that end out there do not count.
  const downAt = useRef({ x: 0, y: 0 })

  return (
    <div
      className={`bomb-stage-3d ${focused !== null ? 'is-focused' : ''}`}
      onPointerDownCapture={(e) => void (downAt.current = { x: e.clientX, y: e.clientY })}
    >
      <Canvas
        camera={{ position: OVERVIEW_CAMERA, fov: 40 }}
        dpr={[1, 2]}
        onPointerMissed={(e) => {
          const moved = Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y)
          if (focused !== null && moved <= 4) onBack()
        }}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 6]} intensity={1.6} />
        <directionalLight position={[-5, 3, -4]} intensity={0.5} />
        <RoomEnv />
        {/* floor the bomb stands on (and its parts land on when it blows up) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} raycast={() => null}>
          <circleGeometry args={[80, 64]} />
          <meshStandardMaterial color="#15181d" roughness={0.95} />
        </mesh>
        <Suspense fallback={null}>
          <BombModel {...props} onBlast={() => setBlasted(true)} />
        </Suspense>
      </Canvas>
      {/* blinding flash over the whole screen when it goes off */}
      {blasted && <div className="bomb-flash" aria-hidden />}

      {focused === null
        ? !bare && <span className="bomb-stage-hint">Ziehen zum Drehen · Modul anklicken</span>
        : (!bare || children) && (
            <div className={`bomb-zoom is-${overlay}`}>
              {!bare && (
                <button className="mg-button bomb-zoom-back" onClick={onBack}>
                  ← Zurück zur Bombe
                </button>
              )}
              {children && <div className="bomb-zoom-panel">{children}</div>}
            </div>
          )}
    </div>
  )
}

useGLTF.preload(BOMB_URL)
