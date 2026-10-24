import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

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
  /** UI of the focused module, shown over the zoomed-in module. */
  children?: ReactNode
  /** Only the bomb: no hint, no back button (press Esc to zoom out). */
  bare?: boolean
}

/** Module face (1×1 m) plus a small margin; zoomed in, this fills the screen. */
const MODULE_FIT_SIZE = 1.04
const OVERVIEW_TARGET: [number, number, number] = [0, 1.4, 0]

/** Parts of a module model kept when its 3D controls are generated from the task. */
const MODULE_FRAME_PARTS = /Plate|Screw|StatusRing|StatusLED/

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean; minDistance: number }
type CameraGoal = { position: THREE.Vector3; target: THREE.Vector3 }
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

function BombModel({ modules, focused, onSelect, timeLeft, strikes }: Bomb3DProps) {
  const { scene } = useGLTF(BOMB_URL)
  const bomb = useMemo(() => scene.clone(true), [scene])

  const idsKey = modules
    .slice(0, BOMB_SLOTS)
    .map((m) => (MODEL_IDS.has(m.id) ? m.id : 'blank'))
    .join(',')
  const framesKey = modules.map((m) => (m.content3d ? 1 : 0)).join('')
  const ids = useMemo(() => [...new Set([...idsKey.split(',').filter(Boolean), 'blank'])], [idsKey])
  const gltfs = useGLTF(ids.map(moduleUrl)) as unknown as { scene: THREE.Group }[]

  // One model per slot: the planned module, or a blank cover for unused slots.
  const instances = useMemo(() => {
    const sources = new Map(ids.map((id, i) => [id, gltfs[i].scene]))
    const planned = idsKey ? idsKey.split(',') : []
    return Array.from({ length: BOMB_SLOTS }, (_, i) => {
      const root = sources.get(planned[i] ?? 'blank')!.clone(true)
      root.userData.planIndex = i < planned.length ? i : null
      if (framesKey[i] === '1') {
        // The GLB scene wraps one module node; hide its static controls, keep plate, screws and LED.
        const module = root.getObjectByProperty('name', root.children[0]?.name) ?? root
        for (const part of module.children) part.visible = MODULE_FRAME_PARTS.test(part.name)
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
  const controls = useThree((state) => state.controls) as unknown as Controls | null
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
          part.visible = i !== index || MODULE_FRAME_PARTS.test(part.name)
        }
      })
    },
    [instances, framesKey],
  )

  useEffect(() => {
    if (!controls) return
    let to: CameraGoal | null = null
    let toUp = WORLD_UP
    if (focused !== null) {
      const slot = bomb.getObjectByName(`Slot_${focused + 1}`)
      if (!slot) return
      bomb.updateMatrixWorld(true)
      overview.current ??= { position: camera.position.clone(), target: controls.target.clone() }
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
      overview.current = null
    }
    if (!to) return
    setArrived(false)
    dimOn.current = false
    controls.enabled = false
    controls.minDistance = 0
    flight.current = {
      from: { position: camera.position.clone(), target: controls.target.clone() },
      to,
      fromUp: camera.up.clone(),
      toUp,
      t: 0,
      zoomingOut: focused === null,
    }
  }, [bomb, camera, controls, focused, isolate, size])

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
    if (!f || !controls) return
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
      controls.update()
      controls.minDistance = OVERVIEW_MIN_DISTANCE
      controls.enabled = true
    } else {
      isolate(focused)
      setArrived(true)
    }
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
    // Inside the focused module the click belongs to its controls: let it reach them untouched.
    if (focused !== null && index === focused) return
    event.stopPropagation()
    if (event.delta > 4) return // was a drag to rotate
    if (focused !== null) return // zoomed in, only Esc (or the back button) zooms out
    if (index !== null) onSelect(index)
  }

  function handleHover(event: ThreeEvent<PointerEvent>) {
    if (focused !== null) return // zoomed in: hovering is for the module's own controls
    event.stopPropagation()
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
              </group>,
              slot,
            )}
          </Fragment>
        )
      })}
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

  useEffect(() => {
    if (focused === null) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onBack()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, onBack])

  return (
    <div className={`bomb-stage-3d ${focused !== null ? 'is-focused' : ''}`}>
      <Canvas
        camera={{ position: [2.6, 3.2, 5.6], fov: 40 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.35} />
        <directionalLight position={[4, 8, 6]} intensity={1.6} />
        <directionalLight position={[-5, 3, -4]} intensity={0.5} />
        <RoomEnv />
        <Suspense fallback={null}>
          <BombModel {...props} />
        </Suspense>
        <OrbitControls
          makeDefault
          target={OVERVIEW_TARGET}
          enablePan={false}
          minDistance={OVERVIEW_MIN_DISTANCE}
          maxDistance={10}
        />
      </Canvas>

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
