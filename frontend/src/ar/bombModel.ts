import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { makeEmptyBay } from '../game/emptyBay'

export const BOMB_BASE = '/models/bomb'
const BOMB_URL = `${BOMB_BASE}/bomb.glb`
const moduleUrl = (id: string) => `${BOMB_BASE}/modules/${id}.glb`

/** Module ids that have their own model; anything else falls back to an open empty bay. */
const MODEL_IDS = new Set([
  'wires',
  'fuses',
  'switches',
  'rotary',
  'cables',
  'sorter',
  'lock',
  'terminal',
  'buttons',
  'slider',
  'radar',
])

export const BOMB_SLOTS = 11
/** Front face of a module plate, in slot space. */
export const FACE_Z = 0.08

export type ModuleStatus = 'active' | 'sending' | 'solved' | 'failed' | 'submitted'

const STATUS_COLOR: Record<ModuleStatus, { color: string; intensity: number }> = {
  active: { color: '#3dff6e', intensity: 0.9 },
  sending: { color: '#ffd23f', intensity: 1.4 },
  solved: { color: '#3dff6e', intensity: 2 },
  failed: { color: '#ff3b3b', intensity: 2.3 },
  submitted: { color: '#3fe6ff', intensity: 1.5 },
}

/** One assembled bomb, ready to be put into a scene. */
export type BombModel = {
  /** Placement root: the model stands on y = 0, centred on x/z, turned around its own y axis. */
  group: THREE.Group
  /** Height of the unscaled model (world units of the GLB). */
  height: number
  /** Widest horizontal side of the unscaled model. */
  width: number
  /** Materials of the little status LEDs, so the app can let them breathe. */
  leds: THREE.MeshStandardMaterial[]
  /** Status LED materials per plan index (module in Slot_1, Slot_2, …). */
  slotLeds: THREE.MeshStandardMaterial[][]
  /** Live countdown on the fixed timer module. */
  setTime: (seconds: number) => void
  /** Red LEDs on the timer module for the strikes taken. */
  setStrikes: (strikes: number) => void
  /** Colours the module LEDs by game status. */
  setSlotStatuses: (statuses: ModuleStatus[]) => void
  /** Frees the per-bomb textures; the hull and module assets are shared and stay cached. */
  dispose: () => void
}

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Group>>()

function loadScene(url: string): Promise<THREE.Group> {
  const cached = cache.get(url)
  if (cached) return cached
  const promise = loader.loadAsync(url).then((gltf) => gltf.scene)
  cache.set(url, promise)
  // A failed request should not poison the cache for the retry.
  promise.catch(() => cache.delete(url))
  return promise
}

/** Loads the hull and every module model once, so switching levels is instant. */
export function preloadBombModels(): Promise<void> {
  return Promise.all([BOMB_URL, ...[...MODEL_IDS].map(moduleUrl)].map(loadScene)).then(() => undefined)
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** The timer digits in the model are static; this draws the live game time onto a canvas texture. */
function makeTimerDisplay(bomb: THREE.Group) {
  const digits = bomb.getObjectByName('Timer_Digits')
  const parent = digits?.parent
  if (!digits || !parent) {
    return { setTime: () => undefined, setStrikes: () => undefined, dispose: () => undefined }
  }

  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), material)
  digits.visible = false
  mesh.position.copy(digits.position)
  mesh.position.z += 0.005
  parent.add(mesh)

  const draw = (seconds: number) => {
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#05070a'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = seconds <= 30 ? '#ff4d4d' : '#3fe6ff'
    context.font = 'bold 72px ui-monospace, "SF Mono", Menlo, monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(formatTime(seconds), canvas.width / 2, canvas.height / 2 + 4)
    texture.needsUpdate = true
  }
  draw(300)

  const strikeMaterials = [0, 1]
    .map((index) => {
      const strike = bomb.getObjectByName(`Timer_Strike${index}`) as THREE.Mesh | undefined
      return strike?.isMesh ? (strike.material as THREE.MeshStandardMaterial) : undefined
    })
    .filter((entry): entry is THREE.MeshStandardMaterial => Boolean(entry?.isMeshStandardMaterial))

  const setStrikes = (strikes: number) => {
    strikeMaterials.forEach((strike, index) => {
      const hit = strikes > index
      strike.emissive.set(hit ? '#ff2020' : '#000000')
      strike.emissiveIntensity = hit ? 4 : 0
    })
  }
  setStrikes(0)

  return {
    setTime: draw,
    setStrikes,
    dispose: () => {
      mesh.removeFromParent()
      mesh.geometry.dispose()
      material.dispose()
      texture.dispose()
      digits.visible = true
    },
  }
}

/** A soft round shadow, drawn as a texture so it costs nothing and grounds the bomb in AR. */
function makeContactShadow(width: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.62)')
    gradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.3)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 128, 128)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const size = Math.max(width * 1.55, 2.4)
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.004
  shadow.renderOrder = 1
  shadow.raycast = () => undefined
  return shadow
}

/**
 * Builds the bomb from eleven slot ids (the first slot is Slot_1, the timer is fixed in Slot_0).
 * An unknown or empty id becomes an open empty bay. The result stands on y = 0.
 */
export async function createBombModel(slots: string[]): Promise<BombModel> {
  const ids = Array.from({ length: BOMB_SLOTS }, (_, index) => {
    const id = slots[index] ?? 'blank'
    return MODEL_IDS.has(id) ? id : 'blank'
  })
  const [hull, ...moduleScenes] = await Promise.all([
    loadScene(BOMB_URL),
    ...[...new Set(ids)].map((id) => loadScene(moduleUrl(id))),
  ])
  const sources = new Map([...new Set(ids)].map((id, index) => [id, moduleScenes[index]]))

  const bomb = hull.clone(true)
  const slotLeds: THREE.MeshStandardMaterial[][] = Array.from({ length: BOMB_SLOTS }, () => [])
  const emptyBays: THREE.Object3D[] = []
  for (let slot = 0; slot < BOMB_SLOTS; slot++) {
    const target = bomb.getObjectByName(`Slot_${slot + 1}`)
    if (!target) continue
    const id = ids[slot]
    if (id === 'blank') {
      const bay = makeEmptyBay()
      target.add(bay)
      emptyBays.push(bay)
      continue
    }

    const module = sources.get(id)!.clone(true)
    // Lets the experience find the planned module from a raycast hit.
    module.userData.planIndex = slot
    module.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh || !object.name.includes('StatusLED')) return
      const material = mesh.material as THREE.MeshStandardMaterial
      if (!material?.isMeshStandardMaterial) return
      slotLeds[slot].push(material)
    })
    target.add(module)
  }

  bomb.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(bomb)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  // Centre the hull over its own footprint and put its lowest point on y = 0.
  bomb.position.set(-center.x, -box.min.y, -center.z)

  const group = new THREE.Group()
  group.add(bomb)
  const shadow = makeContactShadow(Math.max(size.x, size.z))
  group.add(shadow)
  const timer = makeTimerDisplay(bomb)

  const leds: THREE.MeshStandardMaterial[] = []
  const seen = new Set<THREE.Material>()
  for (const materials of slotLeds) {
    for (const material of materials) {
      if (seen.has(material)) continue
      seen.add(material)
      material.emissive.set(STATUS_COLOR.active.color)
      material.color.set(STATUS_COLOR.active.color)
      material.emissiveIntensity = STATUS_COLOR.active.intensity
      material.userData.baseIntensity = STATUS_COLOR.active.intensity
      leds.push(material)
    }
  }

  const setSlotStatuses = (statuses: ModuleStatus[]) => {
    slotLeds.forEach((materials, index) => {
      const status = statuses[index]
      if (!status) return
      const { color, intensity } = STATUS_COLOR[status]
      for (const material of materials) {
        material.emissive.set(color)
        material.color.set(color)
        material.emissiveIntensity = intensity
        material.userData.baseIntensity = intensity
      }
    })
  }

  const shadowMaterial = shadow.material as THREE.MeshBasicMaterial
  return {
    group,
    height: Math.max(size.y, 0.001),
    width: Math.max(size.x, size.z, 0.001),
    leds,
    slotLeds,
    setTime: timer.setTime,
    setStrikes: timer.setStrikes,
    setSlotStatuses,
    dispose: () => {
      timer.dispose()
      for (const bay of emptyBays) {
        const materials = new Set<THREE.Material>()
        bay.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.geometry.dispose()
          const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          for (const material of list) materials.add(material)
        })
        for (const material of materials) material.dispose()
      }
      shadow.geometry.dispose()
      shadowMaterial.map?.dispose()
      shadowMaterial.dispose()
    },
  }
}

/** Lets every standard material in the bomb reflect the room environment. */
export function applyEnvironment(model: BombModel, environment: THREE.Texture) {
  model.group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial
      if (!standard.isMeshStandardMaterial) continue
      standard.envMap = environment
      standard.envMapIntensity = 1.1
      standard.needsUpdate = true
    }
  })
}
