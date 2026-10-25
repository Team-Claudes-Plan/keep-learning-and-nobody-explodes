import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import {
  applyEnvironment,
  BOMB_SLOTS,
  createBombModel,
  FACE_Z,
  preloadBombModels,
  type BombModel,
  type ModuleStatus,
} from './bombModel'
import { loadXRExtras, loadXr8, type Xr8Api, type XrPipelineModule } from './eighthWall'
import type { ArLevel } from './levels'

// The 8th Wall three.js pipeline looks for a global THREE, as in their three.js examples. Set it
// while the module is imported so it is there before the engine finishes loading.
if (typeof window !== 'undefined') {
  ;(window as typeof window & { THREE?: typeof THREE }).THREE = THREE
}

export type ArExperienceCallbacks = {
  onPreviewReady: () => void
  onArReady: () => void
  onPlaced: (placed: boolean) => void
  onHint: (message: string) => void
  /** A non-fatal problem, e.g. one level could not be loaded. The app stays where it is. */
  onError: (message: string) => void
  /** The stage could not start (AR or preview); the experience has already cleaned up. */
  onFatal: (message: string) => void
  /** A module plate was tapped; `index` is its plan index (0-based). */
  onModuleTap: (index: number) => void
  /** Empty space beside the bomb was tapped; used to close an open module. */
  onBackgroundTap: () => void
}

type Mode = 'none' | 'preview' | 'ar'

type PreviewContext = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  canvas: HTMLCanvasElement
  environment: THREE.Texture
  rimLight: THREE.DirectionalLight
  rings: THREE.MeshBasicMaterial[]
  /** Preview-only objects (floor, grid, rings); the bomb's own cached assets are not touched. */
  ownedObjects: THREE.Object3D[]
  resizeObserver: ResizeObserver
  pointerCleanup: () => void
  lastFrame: number
  raf: number
  targetHeight: number
  baseScale: number
  zoom: number
  yaw: number
  yawVelocity: number
  dragging: boolean
  lastX: number
  pop: number
}

type ArContext = {
  XR8: Xr8Api
  canvas: HTMLCanvasElement
  scene: THREE.Scene | null
  camera: THREE.PerspectiveCamera | null
  renderer: THREE.WebGLRenderer | null
  environment: THREE.Texture | null
  projectedObjects: THREE.Object3D[]
  reticle: THREE.Group | null
  reticlePulse: THREE.Mesh | null
  reticleMaterial: THREE.MeshBasicMaterial | null
  placed: boolean
  /** Ground position the bomb returns to when no module is focused. */
  basePosition: THREE.Vector3
  userScale: number
  yaw: number
  pop: number
  lastHitTest: number
  lastHint: number
  lastUpdate: number
  pointerCleanup: () => void
  startedOnBomb: boolean
  dragBomb: boolean
  downModule: number | null
  lastX: number
  pinchStart: number
  pinchScaleStart: number
  downAt: number
  downX: number
  downY: number
  moved: number
}

/** World height of the bomb when placed in AR (the GLB is about 2.9 units tall). */
const AR_HEIGHT = 0.72
/** Height of the bomb on the preview stage. */
const PREVIEW_HEIGHT = 1.55
const MIN_USER_SCALE = 0.4
const MAX_USER_SCALE = 2.8
const GAME_SECONDS = 300

/** How far in front of the camera the focused module floats, and how much it grows. */
const AR_FOCUS_DISTANCE = 0.8
const PREVIEW_FOCUS_DISTANCE = 2.6
const AR_FOCUS_RAISE = 0.35
const PREVIEW_FOCUS_RAISE = 0.14
const AR_FOCUS_SCALE = 0.8
const PREVIEW_FOCUS_SCALE = 0.95
const WORLD_UP = new THREE.Vector3(0, 1, 0)

type Pose = {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: number
}

/** Cached slot transform relative to the bomb's placement root. */
type SlotLocal = { position: THREE.Vector3; quaternion: THREE.Quaternion }

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Pads/truncates a plan to eleven slot ids; missing slots become open empty bays. */
function normalizeSlots(slots: string[]) {
  return Array.from({ length: BOMB_SLOTS }, (_, index) => slots[index] ?? 'blank')
}

function yawQuaternion(yaw: number) {
  return new THREE.Quaternion().setFromAxisAngle(WORLD_UP, yaw)
}

/**
 * Owns the canvas and the bomb scene for both modes: a lit turntable preview in the browser, and
 * the 8th Wall camera feed with SLAM placement on the phone. The React page only draws the UI.
 */
export default class ArBombExperience {
  private container: HTMLElement
  private callbacks: ArExperienceCallbacks
  private mode: Mode = 'none'
  private level: ArLevel
  private bomb: BombModel | null = null
  private preview: PreviewContext | null = null
  private ar: ArContext | null = null
  /** Set while an AR failure is being handled, so camera/exception callbacks report only once. */
  private arFailed = false
  /** Async guard: only the latest start/stop may touch the stage. */
  private operation = 0
  private bombOperation = 0
  /** Current bomb configuration: eleven slot ids, the first one is Slot_1. */
  private slots: string[] = []
  /** Plan index of the module that has been pulled in front of the camera. */
  private focused: number | null = null
  private slotLocals: (SlotLocal | null)[] = []
  private statuses: ModuleStatus[] = []
  private timeLeft = GAME_SECONDS
  private strikes = 0

  constructor(container: HTMLElement, level: ArLevel, callbacks: ArExperienceCallbacks) {
    this.container = container
    this.level = level
    this.callbacks = callbacks
  }

  /** Shows the turntable preview. Safe to call while AR is running. */
  async showPreview(level: ArLevel, slots: string[]): Promise<void> {
    const operation = ++this.operation
    this.level = level
    this.slots = normalizeSlots(slots)
    this.focused = null
    this.mode = 'none'
    await this.stopAr()
    this.teardownPreview()
    if (operation !== this.operation) return

    this.mode = 'preview'
    try {
      const preview = this.createPreviewContext()
      this.preview = preview
      this.resizePreview()
      const bomb = await createBombModel(this.slots)
      if (operation !== this.operation || this.mode !== 'preview') return
      this.attachBomb(bomb)
      this.framePreview(preview)
      this.callbacks.onPreviewReady()
      // Pull in the remaining module models quietly, so switching level later is instant.
      void preloadBombModels().catch(() => undefined)
    } catch (error) {
      if (operation !== this.operation || this.mode !== 'preview') return
      const hadPreview = this.preview !== null
      this.teardownPreview()
      if (!hadPreview) this.container.querySelector('.ar-canvas-preview')?.remove()
      this.callbacks.onFatal(`Die 3D-Vorschau konnte nicht geladen werden: ${messageOf(error)}`)
    }
  }

  /** Loads the engine and opens the camera. The first tap on the floor places the bomb. */
  async startAr(level: ArLevel, slots: string[]): Promise<void> {
    const operation = ++this.operation
    this.level = level
    this.slots = normalizeSlots(slots)
    this.focused = null
    this.mode = 'none'
    this.teardownPreview()
    await this.stopAr()
    if (operation !== this.operation) return

    if (!window.isSecureContext) {
      this.callbacks.onFatal(
        'AR braucht HTTPS. Öffne die Demo auf dem Handy über eine HTTPS-Adresse (z. B. ngrok).',
      )
      await this.showPreview(level, this.slots)
      return
    }

    this.mode = 'ar'
    this.arFailed = false
    const slotsKey = this.slots.join(',')
    try {
      const [XR8, firstBomb, extras] = await Promise.all([
        loadXr8(),
        createBombModel(this.slots),
        loadXRExtras(),
      ])
      if (operation !== this.operation) {
        firstBomb.dispose()
        return
      }

      // The level or plan may have changed while the engine was loading.
      let bomb = firstBomb
      if (this.level.id !== level.id || this.slots.join(',') !== slotsKey) {
        bomb = await createBombModel(this.slots)
        firstBomb.dispose()
      }
      if (operation !== this.operation) {
        bomb.dispose()
        return
      }

      const canvas = document.createElement('canvas')
      canvas.className = 'ar-canvas ar-canvas-ar'
      canvas.setAttribute('aria-label', 'AR-Kamerabild')
      this.container.appendChild(canvas)

      const ar: ArContext = {
        XR8,
        canvas,
        scene: null,
        camera: null,
        renderer: null,
        environment: null,
        projectedObjects: [],
        reticle: null,
        reticlePulse: null,
        reticleMaterial: null,
        placed: false,
        basePosition: new THREE.Vector3(),
        userScale: 1,
        yaw: 0,
        pop: 0.65,
        lastHitTest: 0,
        lastHint: 0,
        lastUpdate: performance.now(),
        pointerCleanup: () => undefined,
        startedOnBomb: false,
        dragBomb: false,
        downModule: null,
        lastX: 0,
        pinchStart: 0,
        pinchScaleStart: 1,
        downAt: 0,
        downX: 0,
        downY: 0,
        moved: 0,
      }
      this.ar = ar
      this.bomb = bomb
      this.cacheSlotLocals()
      this.applyGameState()
      this.snapBombPose('ar')

      const sceneModule: XrPipelineModule = {
        name: 'bomb-ar-demo-scene',
        onStart: () => this.arOnStart(operation),
        onUpdate: () => this.arOnUpdate(),
        onDetach: () => this.arOnDetach(),
        onCameraStatusChange: ({ status }) => {
          if (status !== 'failed') return
          window.setTimeout(() => {
            if (operation === this.operation) {
              void this.failAr(
                'Die Kamera konnte nicht geöffnet werden. Erlaube den Kamerazugriff und versuche es erneut.',
              )
            }
          }, 0)
        },
        onException: (error) => {
          if (operation !== this.operation) return
          window.setTimeout(() => void this.failAr(`8th Wall meldet einen Fehler: ${messageOf(error)}`), 0)
        },
      }

      const pipelineModules = [
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(),
      ]
      // Keeps the camera canvas filling the window when the browser chrome collapses or rotates.
      if (extras?.FullWindowCanvas?.pipelineModule) {
        pipelineModules.push(extras.FullWindowCanvas.pipelineModule())
      }
      pipelineModules.push(sceneModule)
      XR8.addCameraPipelineModules(pipelineModules)

      await XR8.run({ canvas, allowedDevices: XR8.XrConfig?.device().ANY })
      if (operation !== this.operation) {
        this.stopAr()
      }
    } catch (error) {
      if (operation !== this.operation) return
      await this.failAr(`AR konnte nicht gestartet werden: ${messageOf(error)}`)
    }
  }

  /** Rebuilds the bomb for a new level/plan, keeping the current placement and orientation. */
  setBomb(level: ArLevel, slots: string[]): void {
    const next = normalizeSlots(slots)
    const levelChanged = this.level.id !== level.id
    const slotsChanged = next.join(',') !== this.slots.join(',')
    this.level = level
    this.slots = next

    if (levelChanged) {
      this.applyPreviewAccent()
      this.updateArReticleColor()
    }
    if (!slotsChanged) return

    this.focused = null
    const token = ++this.bombOperation

    if (this.mode === 'preview' && this.preview) {
      void createBombModel(next)
        .then((bomb) => {
          if (token !== this.bombOperation || this.mode !== 'preview' || !this.preview) return
          this.attachBomb(bomb)
          this.framePreview(this.preview)
          this.preview.pop = 0
        })
        .catch((error: unknown) => {
          if (token === this.bombOperation && this.mode === 'preview') {
            this.callbacks.onError(`Bombenplan konnte nicht geladen werden: ${messageOf(error)}`)
          }
        })
    }

    if (this.mode === 'ar') {
      void createBombModel(next)
        .then((bomb) => {
          if (token !== this.bombOperation || this.mode !== 'ar' || !this.ar) return
          const previous = this.bomb
          const ar = this.ar
          // Keep the bomb where it was placed on the floor; the focused pose is only temporary.
          bomb.group.position.copy(ar.basePosition)
          if (previous) {
            ar.scene?.remove(previous.group)
            previous.dispose()
          }
          this.bomb = bomb
          if (ar.scene) {
            ar.scene.add(bomb.group)
            if (ar.environment) applyEnvironment(bomb, ar.environment)
          }
          this.cacheSlotLocals()
          this.applyGameState()
          this.snapBombPose('ar')
          ar.pop = 0.72
        })
        .catch((error: unknown) => {
          if (token === this.bombOperation && this.mode === 'ar') {
            this.callbacks.onError(`Bombenplan konnte nicht geladen werden: ${messageOf(error)}`)
          }
        })
    }
  }

  /** Pulls a module in front of the camera (or lets it return to the floor with null). */
  setFocused(index: number | null): void {
    this.focused =
      index !== null && Number.isInteger(index) && index >= 0 && index < BOMB_SLOTS ? index : null
  }

  /** Live timer, strike marks and module LED colours. */
  setGameStatus(statuses: ModuleStatus[], timeLeft: number, strikes: number): void {
    this.statuses = statuses
    this.timeLeft = timeLeft
    this.strikes = strikes
    this.applyGameState()
  }

  placeAgain(): void {
    if (!this.ar) return
    this.focused = null
    this.ar.placed = false
    this.ar.pop = 0.8
    this.ar.basePosition.set(0, 0, 0)
    if (this.bomb) this.bomb.group.visible = false
    this.callbacks.onPlaced(false)
  }

  scaleBy(factor: number): void {
    const ar = this.ar
    if (!ar) return
    ar.userScale = THREE.MathUtils.clamp(ar.userScale * factor, MIN_USER_SCALE, MAX_USER_SCALE)
    ar.pop = Math.min(ar.pop, 0.95)
  }

  rotateBy(angle: number): void {
    const ar = this.ar
    if (!ar) return
    ar.yaw += angle
  }

  /** Stops the camera and removes everything the app added to the DOM or the AR scene. */
  async dispose(): Promise<void> {
    ++this.operation
    ++this.bombOperation
    this.focused = null
    this.slotLocals = []
    this.teardownPreview()
    await this.stopAr()
    this.mode = 'none'
    this.bomb = null
  }

  // ----- Preview -------------------------------------------------------------------------------

  private createPreviewContext(): PreviewContext {
    const canvas = document.createElement('canvas')
    canvas.className = 'ar-canvas ar-canvas-preview'
    canvas.setAttribute('aria-label', '3D-Vorschau der Bombe')
    this.container.appendChild(canvas)

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 100)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    scene.environment = environment

    const hemi = new THREE.HemisphereLight('#cfe8ff', '#101722', 1.15)
    const key = new THREE.DirectionalLight('#ffffff', 2.6)
    key.position.set(3.5, 5.5, 4)
    const fill = new THREE.DirectionalLight('#7da6ff', 0.85)
    fill.position.set(-3, 1.5, 4)
    const rimLight = new THREE.DirectionalLight(this.level.accent, 2)
    rimLight.position.set(-4, 2.6, -3.5)
    scene.add(hemi, key, fill, rimLight)

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.72, 96),
      new THREE.MeshStandardMaterial({ color: '#0c1623', roughness: 0.82, metalness: 0.32 }),
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const grid = new THREE.PolarGridHelper(2.58, 8, 7, 72, '#1c3049', '#1c3049')
    const gridMaterial = grid.material as THREE.LineBasicMaterial
    gridMaterial.transparent = true
    gridMaterial.opacity = 0.5
    grid.position.y = 0.002
    scene.add(grid)

    const rings: THREE.MeshBasicMaterial[] = []
    const ownedRings: THREE.Object3D[] = []
    for (const [inner, outer, opacity] of [
      [1.48, 1.505, 0.6],
      [2.42, 2.445, 0.36],
    ]) {
      const material = new THREE.MeshBasicMaterial({
        color: this.level.accent,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 128), material)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = 0.004
      rings.push(material)
      scene.add(ring)
      ownedRings.push(ring)
    }

    const context: PreviewContext = {
      renderer,
      scene,
      camera,
      canvas,
      environment,
      rimLight,
      rings,
      resizeObserver: new ResizeObserver(() => this.resizePreview()),
      pointerCleanup: () => undefined,
      lastFrame: performance.now(),
      raf: 0,
      targetHeight: PREVIEW_HEIGHT,
      baseScale: 1,
      zoom: 1,
      ownedObjects: [floor, grid, ...ownedRings],
      yaw: -0.35,
      yawVelocity: 0,
      dragging: false,
      lastX: 0,
      pop: 0,
    }

    this.resizePreview()
    context.resizeObserver.observe(this.container)
    context.pointerCleanup = this.bindPreviewPointers(context)
    context.raf = requestAnimationFrame(() => this.previewTick(context))
    return context
  }

  private resizePreview() {
    const preview = this.preview
    if (!preview) return
    const width = Math.max(1, this.container.clientWidth)
    const height = Math.max(1, this.container.clientHeight)
    preview.renderer.setSize(width, height, false)
    preview.camera.aspect = width / height
    preview.camera.updateProjectionMatrix()
    if (this.bomb) this.framePreview(preview)
  }

  private bindPreviewPointers(preview: PreviewContext): () => void {
    const canvas = preview.canvas
    const pointers = new Map<number, { x: number; y: number }>()
    let pinchStart = 0
    let pinchZoomStart = 1
    let downAt = 0
    let downX = 0
    let downY = 0
    let moved = 0

    canvas.style.touchAction = 'none'

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointers (tests, some embedded browsers) cannot be captured.
      }
      if (pointers.size === 1) {
        downAt = performance.now()
        downX = event.clientX
        downY = event.clientY
        moved = 0
        preview.dragging = true
        preview.lastX = event.clientX
        preview.yawVelocity = 0
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchStart = distanceBetween(a, b)
        pinchZoomStart = preview.zoom
        preview.dragging = false
      }
    }

    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      moved = Math.max(moved, Math.hypot(event.clientX - downX, event.clientY - downY))
      if (pointers.size === 2) {
        if (this.focused !== null) return
        const [a, b] = [...pointers.values()]
        const span = Math.max(1, distanceBetween(a, b))
        preview.zoom = THREE.MathUtils.clamp((pinchZoomStart * span) / Math.max(1, pinchStart), 0.72, 1.8)
        return
      }
      if (!preview.dragging || this.focused !== null) return
      const delta = event.clientX - preview.lastX
      preview.yaw += delta * 0.012
      preview.yawVelocity = THREE.MathUtils.clamp(delta * 0.6, -5, 5)
      preview.lastX = event.clientX
    }

    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinchStart = 0
      if (pointers.size === 1) {
        const remaining = [...pointers.values()][0]
        preview.lastX = remaining.x
        preview.dragging = true
        return
      }
      preview.dragging = false

      // A real tap (not the end of a drag) opens the module under the finger.
      if (pointers.size === 0 && moved < 9 && performance.now() - downAt < 550) {
        const index = this.moduleIndexAt(event.clientX, event.clientY, canvas, preview.camera)
        if (index !== null) this.callbacks.onModuleTap(index)
        else if (this.focused !== null) this.callbacks.onBackgroundTap()
      }
    }

    const wheel = (event: WheelEvent) => {
      if (this.focused !== null) return
      event.preventDefault()
      preview.zoom = THREE.MathUtils.clamp(preview.zoom * Math.exp(-event.deltaY * 0.0012), 0.72, 1.8)
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)

    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }

  private framePreview(preview: PreviewContext) {
    if (!this.bomb) return
    preview.baseScale = preview.targetHeight / this.bomb.height
    this.snapBombPose('preview')
    this.updatePreviewCamera(preview)
  }

  private updatePreviewCamera(preview: PreviewContext) {
    const targetHeight = preview.targetHeight
    const aspect = Math.max(0.35, preview.camera.aspect)
    const fit = Math.max(1, 0.9 / aspect)
    const distance = (targetHeight * 3.05 * fit) / preview.zoom
    // Narrow screens have the info card under the bomb: frame the bomb a little higher there.
    const lookHeight = targetHeight * (aspect < 0.9 ? 0.35 : 0.46)
    preview.camera.position.set(distance * 0.2, targetHeight * 0.48 + distance * 0.45, distance * 0.87)
    preview.camera.lookAt(0, lookHeight, 0)
  }

  private previewTick(preview: PreviewContext) {
    if (this.preview !== preview) return
    const now = performance.now()
    const delta = Math.min((now - preview.lastFrame) / 1000, 1 / 20)
    preview.lastFrame = now
    const elapsed = now / 1000

    if (!preview.dragging && this.focused === null) {
      preview.yaw += preview.yawVelocity * delta
      preview.yawVelocity *= Math.exp(-delta * 4.5)
      if (Math.abs(preview.yawVelocity) < 0.02) preview.yaw += delta * 0.12
    }
    preview.pop += (1 - preview.pop) * (1 - Math.exp(-delta * 7))

    this.applyBombPose('preview', delta)
    if (this.bomb) this.pulseLeds(this.bomb, elapsed)

    this.updatePreviewCamera(preview)
    preview.renderer.render(preview.scene, preview.camera)
    preview.raf = requestAnimationFrame(() => this.previewTick(preview))
  }

  private applyPreviewAccent() {
    const preview = this.preview
    if (!preview) return
    preview.rimLight.color.set(this.level.accent)
    for (const ring of preview.rings) ring.color.set(this.level.accent)
  }

  private attachBomb(bomb: BombModel) {
    const preview = this.preview
    if (preview) {
      if (this.bomb) {
        preview.scene.remove(this.bomb.group)
        this.bomb.dispose()
      }
      this.bomb = bomb
      applyEnvironment(bomb, preview.environment)
      preview.scene.add(bomb.group)
      this.cacheSlotLocals()
      this.applyGameState()
      this.applyPreviewAccent()
      this.framePreview(preview)
      return
    }

    const ar = this.ar
    if (this.bomb && ar) {
      ar.scene?.remove(this.bomb.group)
      this.bomb.dispose()
    }
    this.bomb = bomb
    if (ar?.scene) {
      ar.scene.add(bomb.group)
      if (ar.environment) applyEnvironment(bomb, ar.environment)
    }
    this.cacheSlotLocals()
    this.applyGameState()
    this.snapBombPose('ar')
  }

  private pulseLeds(bomb: BombModel, time: number) {
    bomb.leds.forEach((material, index) => {
      const base = typeof material.userData.baseIntensity === 'number' ? material.userData.baseIntensity : 1
      material.emissiveIntensity = base * (0.86 + Math.sin(time * 2.4 + index * 0.9) * 0.14)
    })
  }

  /** Remembers where each slot sits relative to the placement root, for the focus pose. */
  private cacheSlotLocals() {
    const bomb = this.bomb
    if (!bomb) {
      this.slotLocals = []
      return
    }
    bomb.group.updateMatrixWorld(true)
    const inverse = new THREE.Matrix4().copy(bomb.group.matrixWorld).invert()
    this.slotLocals = Array.from({ length: BOMB_SLOTS }, (_, index) => {
      const slot = bomb.group.getObjectByName(`Slot_${index + 1}`)
      if (!slot) return null
      const local = new THREE.Matrix4().multiplyMatrices(inverse, slot.matrixWorld)
      const position = new THREE.Vector3()
      const quaternion = new THREE.Quaternion()
      local.decompose(position, quaternion, new THREE.Vector3())
      return { position, quaternion }
    })
  }

  private applyGameState() {
    const bomb = this.bomb
    if (!bomb) return
    bomb.setSlotStatuses(this.statuses)
    bomb.setTime(this.timeLeft)
    bomb.setStrikes(this.strikes)
  }

  private basePose(mode: 'preview' | 'ar'): Pose | null {
    const bomb = this.bomb
    if (!bomb) return null

    if (mode === 'preview') {
      const preview = this.preview
      if (!preview) return null
      preview.baseScale = preview.targetHeight / bomb.height
      return {
        position: new THREE.Vector3(),
        quaternion: yawQuaternion(preview.yaw),
        scale: preview.baseScale * (0.86 + 0.14 * preview.pop),
      }
    }

    const ar = this.ar
    if (!ar) return null
    return {
      position: ar.basePosition.clone(),
      quaternion: yawQuaternion(ar.yaw),
      scale: (AR_HEIGHT / bomb.height) * ar.userScale * (0.72 + 0.28 * ar.pop),
    }
  }

  /**
   * Bomb pose that puts the focused module's face right in front of the camera, upright and
   * aligned with the screen. Recomputed every frame, so the module follows the phone.
   */
  private focusPose(mode: 'preview' | 'ar'): Pose | null {
    const bomb = this.bomb
    const camera = mode === 'preview' ? this.preview?.camera : this.ar?.camera
    if (!bomb || !camera || this.focused === null) return null
    const slot = this.slotLocals[this.focused]
    const base = this.basePose(mode)
    if (!slot || !base) return base

    const cameraPosition = camera.getWorldPosition(new THREE.Vector3())
    const cameraQuaternion = camera.getWorldQuaternion(new THREE.Quaternion())
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion)
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraQuaternion)

    const scale = base.scale * (mode === 'preview' ? PREVIEW_FOCUS_SCALE : AR_FOCUS_SCALE)
    const bombQuaternion = cameraQuaternion.clone().multiply(slot.quaternion.clone().invert())
    const face = slot.position
      .clone()
      .add(new THREE.Vector3(0, 0, FACE_Z))
      .applyQuaternion(bombQuaternion)
      .multiplyScalar(scale)

    const distance = mode === 'preview' ? PREVIEW_FOCUS_DISTANCE : AR_FOCUS_DISTANCE
    const raise = distance * (mode === 'preview' ? PREVIEW_FOCUS_RAISE : AR_FOCUS_RAISE)
    const point = cameraPosition.clone().addScaledVector(forward, distance).addScaledVector(up, raise)

    return { position: point.sub(face), quaternion: bombQuaternion, scale }
  }

  private snapBombPose(mode: 'preview' | 'ar') {
    const bomb = this.bomb
    if (!bomb) return
    const pose = (this.focused !== null ? this.focusPose(mode) : null) ?? this.basePose(mode)
    if (!pose) return
    bomb.group.position.copy(pose.position)
    bomb.group.quaternion.copy(pose.quaternion)
    bomb.group.scale.setScalar(pose.scale)
    bomb.group.visible = mode === 'preview' || Boolean(this.ar?.placed)
  }

  private applyBombPose(mode: 'preview' | 'ar', delta: number) {
    const bomb = this.bomb
    if (!bomb) return
    const pose = (this.focused !== null ? this.focusPose(mode) : null) ?? this.basePose(mode)
    if (!pose) return
    const k = 1 - Math.exp(-delta * (this.focused !== null ? 11 : 13))
    bomb.group.position.lerp(pose.position, k)
    bomb.group.quaternion.slerp(pose.quaternion, k)
    bomb.group.scale.setScalar(THREE.MathUtils.lerp(bomb.group.scale.x, pose.scale, k))
    bomb.group.visible = mode === 'preview' || Boolean(this.ar?.placed)
  }

  /** Plan index of the module under a screen point, or null if the hull/background was hit. */
  private moduleIndexAt(
    clientX: number,
    clientY: number,
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera,
  ): number | null {
    const bomb = this.bomb
    if (!bomb) return null
    const rect = canvas.getBoundingClientRect()
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
      ),
      camera,
    )
    for (const hit of raycaster.intersectObject(bomb.group, true)) {
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
        const index = object.userData.planIndex
        if (typeof index === 'number') return index
      }
    }
    return null
  }

  private teardownPreview() {
    const preview = this.preview
    if (!preview) return
    this.preview = null
    cancelAnimationFrame(preview.raf)
    preview.resizeObserver.disconnect()
    preview.pointerCleanup()
    if (this.bomb) {
      preview.scene.remove(this.bomb.group)
      this.bomb.dispose()
      this.bomb = null
    }
    // Only the stage furniture belongs to this preview; the bomb's geometry and materials are
    // cached and shared with the next level and with AR, so they must not be disposed here.
    for (const object of preview.ownedObjects) {
      object.removeFromParent()
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = mesh.material
        ? Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material]
        : []
      for (const material of materials) material.dispose()
    }
    preview.environment.dispose()
    preview.renderer.dispose()
    preview.canvas.remove()
  }

  // ----- AR ------------------------------------------------------------------------------------

  private arOnStart(operation: number) {
    const ar = this.ar
    if (!ar || operation !== this.operation) return

    const { scene, camera, renderer } = ar.XR8.Threejs.xrScene()
    ar.scene = scene
    ar.camera = camera
    ar.renderer = renderer

    camera.position.set(0, 1.55, 0)
    camera.quaternion.identity()
    ar.XR8.XrController.updateCameraProjectionMatrix({
      origin: camera.position.clone(),
      facing: camera.quaternion.clone(),
    })

    const hemi = new THREE.HemisphereLight('#ffffff', '#26313f', 1.5)
    const key = new THREE.DirectionalLight('#ffffff', 2.4)
    key.position.set(2.5, 4.5, 3)
    const fill = new THREE.DirectionalLight('#9bc1ff', 0.9)
    fill.position.set(-3, 2, -2.5)
    scene.add(hemi, key, fill)
    ar.projectedObjects.push(hemi, key, fill)

    const pmrem = new THREE.PMREMGenerator(renderer)
    ar.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()

    const { reticle, pulse, material } = this.createReticle()
    ar.reticle = reticle
    ar.reticlePulse = pulse
    ar.reticleMaterial = material
    reticle.visible = false
    scene.add(reticle)
    ar.projectedObjects.push(reticle)

    if (this.bomb) {
      scene.add(this.bomb.group)
      applyEnvironment(this.bomb, ar.environment)
      this.cacheSlotLocals()
      this.applyGameState()
      this.snapBombPose('ar')
      this.bomb.group.visible = ar.placed
    }

    ar.pointerCleanup = this.bindArPointers()
    this.callbacks.onArReady()
    this.callbacks.onPlaced(false)
  }

  private createReticle() {
    const reticle = new THREE.Group()
    const material = new THREE.MeshBasicMaterial({
      color: this.level.accent,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    })
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.155, 64), material)
    ring.rotation.x = -Math.PI / 2
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), material)
    dot.rotation.x = -Math.PI / 2
    const pulse = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.145, 64), material)
    pulse.rotation.x = -Math.PI / 2
    reticle.add(ring, pulse, dot)
    return { reticle, pulse, material }
  }

  private updateArReticleColor() {
    this.ar?.reticleMaterial?.color.set(this.level.accent)
  }

  private arOnUpdate() {
    const ar = this.ar
    if (!ar) return
    const now = performance.now()
    const time = now / 1000
    const delta = Math.min((now - ar.lastUpdate) / 1000, 1 / 20)
    ar.lastUpdate = now

    ar.pop += (1 - ar.pop) * (1 - Math.exp(-delta * 7))
    this.applyBombPose('ar', delta)
    if (this.bomb) this.pulseLeds(this.bomb, time)

    if (ar.placed || !ar.reticle || !ar.camera) return

    // The reticle follows the centre of the camera until the bomb is placed.
    if (now - ar.lastHitTest < 90) return
    ar.lastHitTest = now
    const hit = this.centerHit(ar)
    ar.reticle.visible = Boolean(hit)
    if (!hit) return
    ar.reticle.position.set(hit.position.x, hit.position.y + 0.004, hit.position.z)
    const scale = 1 + Math.sin(time * 3.2) * 0.07
    ar.reticlePulse?.scale.setScalar(scale)
  }

  private bindArPointers(): () => void {
    const ar = this.ar
    if (!ar) return () => undefined
    const canvas = ar.canvas
    const pointers = new Map<number, { x: number; y: number }>()
    canvas.style.touchAction = 'none'

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointers (tests, some embedded browsers) cannot be captured.
      }
      ar.moved = 0
      ar.downAt = performance.now()
      ar.downX = event.clientX
      ar.downY = event.clientY
      ar.lastX = event.clientX
      if (pointers.size === 1) {
        ar.downModule =
          ar.placed && ar.camera
            ? this.moduleIndexAt(event.clientX, event.clientY, canvas, ar.camera)
            : null
        ar.startedOnBomb =
          ar.downModule !== null || (ar.placed && this.pointerHitsBomb(event.clientX, event.clientY))
        ar.dragBomb = ar.startedOnBomb && this.focused === null
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        ar.pinchStart = Math.max(1, distanceBetween(a, b))
        ar.pinchScaleStart = ar.userScale
        ar.dragBomb = false
      }
    }

    const move = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      ar.moved = Math.max(ar.moved, Math.hypot(event.clientX - ar.downX, event.clientY - ar.downY))

      if (pointers.size === 2) {
        if (this.focused !== null) return
        const [a, b] = [...pointers.values()]
        const span = Math.max(1, distanceBetween(a, b))
        ar.userScale = THREE.MathUtils.clamp(
          (ar.pinchScaleStart * span) / ar.pinchStart,
          MIN_USER_SCALE,
          MAX_USER_SCALE,
        )
        return
      }

      if (!ar.dragBomb || this.focused !== null) return
      const delta = event.clientX - ar.lastX
      ar.lastX = event.clientX
      ar.yaw += delta * 0.012
    }

    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      pointers.delete(event.pointerId)
      if (pointers.size > 0) return

      const quick = performance.now() - ar.downAt < 550
      const tap = ar.moved < 9
      if (quick && tap) {
        if (!ar.placed) {
          if (!this.tryPlaceAt(event.clientX, event.clientY, true)) this.hintNoSurface()
        } else if (ar.downModule !== null) {
          this.callbacks.onModuleTap(ar.downModule)
        } else if (this.focused !== null) {
          this.callbacks.onBackgroundTap()
        } else if (!ar.startedOnBomb) {
          this.tryPlaceAt(event.clientX, event.clientY, false)
        }
      }
      ar.dragBomb = false
      ar.startedOnBomb = false
      ar.downModule = null
    }

    const cancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      ar.dragBomb = false
      ar.startedOnBomb = false
      ar.downModule = null
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', cancel)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', cancel)
    }
  }

  private pointerHitsBomb(clientX: number, clientY: number): boolean {
    const ar = this.ar
    if (!ar?.camera || !this.bomb) return false
    const rect = ar.canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    const y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(x, y), ar.camera)
    return raycaster.intersectObject(this.bomb.group, true).length > 0
  }

  private centerHit(ar: ArContext) {
    try {
      return this.pickHit(ar.XR8.XrController.hitTest(0.5, 0.5, ['FEATURE_POINT']))
    } catch {
      return undefined
    }
  }

  private tryPlaceAt(clientX: number, clientY: number, fallbackCenter: boolean): boolean {
    const ar = this.ar
    if (!ar) return false
    const rect = ar.canvas.getBoundingClientRect()
    const x = (clientX - rect.left) / Math.max(1, rect.width)
    const y = (clientY - rect.top) / Math.max(1, rect.height)
    try {
      let hit = this.pickHit(ar.XR8.XrController.hitTest(x, y, ['FEATURE_POINT']))
      if (!hit && fallbackCenter) hit = this.centerHit(ar)
      if (!hit) return false
      this.placeBomb(hit.position)
      return true
    } catch {
      return false
    }
  }

  private pickHit(hits: { position: { x: number; y: number; z: number }; distance: number }[] | undefined) {
    if (!hits || hits.length === 0) return undefined
    return [...hits]
      .filter((hit) => Number.isFinite(hit.distance) && hit.distance > 0.15 && hit.distance < 12)
      .sort((a, b) => a.distance - b.distance)[0]
  }

  private placeBomb(position: { x: number; y: number; z: number }) {
    const ar = this.ar
    if (!ar || !this.bomb) return
    ar.basePosition.set(position.x, position.y + 0.002, position.z)
    this.bomb.group.position.copy(ar.basePosition)
    this.bomb.group.visible = true
    if (ar.reticle) ar.reticle.visible = false
    ar.placed = true
    ar.pop = 0.55
    this.snapBombPose('ar')
    this.callbacks.onPlaced(true)
    this.callbacks.onHint('Platziert! Tippe ein Modul an, um es zu entschärfen.')
  }

  private hintNoSurface() {
    const ar = this.ar
    if (!ar) return
    const now = performance.now()
    if (now - ar.lastHint < 2400) return
    ar.lastHint = now
    this.callbacks.onHint('Noch keine Fläche erkannt. Bewege das Handy langsam über den Boden.')
  }

  private arOnDetach() {
    const ar = this.ar
    if (!ar) return
    ar.pointerCleanup()
    ar.pointerCleanup = () => undefined
  }

  private async failAr(message: string): Promise<void> {
    if (this.arFailed) return
    this.arFailed = true
    this.callbacks.onFatal(message)
    await this.showPreview(this.level, this.slots)
  }

  private async stopAr(): Promise<void> {
    const ar = this.ar
    if (!ar) return
    this.ar = null
    this.focused = null
    this.slotLocals = []
    ar.pointerCleanup()
    if (this.bomb) {
      ar.scene?.remove(this.bomb.group)
      this.bomb.dispose()
      this.bomb = null
    }
    for (const object of ar.projectedObjects) object.removeFromParent()
    ar.environment?.dispose()

    try {
      await ar.XR8.stop()
    } catch {
      // The engine may already have stopped itself.
    }
    try {
      ar.XR8.clearCameraPipelineModules()
    } catch {
      // Removing modules from an already stopped pipeline is harmless.
    }
    ar.canvas.remove()
    ar.scene = null
    ar.camera = null
    ar.renderer = null
    ar.reticle = null
    ar.reticlePulse = null
    ar.reticleMaterial = null
  }
}
