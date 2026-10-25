import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { makeEmptyBay } from '../game/emptyBay'
import type { ArLevel } from './levels'

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
  /** Frees the per-bomb shadow texture; the hull and module assets are shared and stay cached. */
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
 * Builds the bomb for a level: the hull from bomb.glb, the planned module in every slot and an
 * open empty bay where a level leaves a slot unused. The result stands on y = 0.
 */
export async function createBombModel(level: ArLevel): Promise<BombModel> {
  const ids = level.slots.map((id) => (MODEL_IDS.has(id) ? id : 'blank'))
  const [hull, ...moduleScenes] = await Promise.all([
    loadScene(BOMB_URL),
    ...[...new Set(ids)].map((id) => loadScene(moduleUrl(id))),
  ])
  const sources = new Map([...new Set(ids)].map((id, index) => [id, moduleScenes[index]]))

  const bomb = hull.clone(true)
  for (let slot = 0; slot < BOMB_SLOTS; slot++) {
    const target = bomb.getObjectByName(`Slot_${slot + 1}`)
    if (!target) continue
    const id = ids[slot]
    target.add(id === 'blank' ? makeEmptyBay() : sources.get(id)!.clone(true))
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

  const leds: THREE.MeshStandardMaterial[] = []
  const seen = new Set<THREE.Material>()
  bomb.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh || !object.name.includes('StatusLED')) return
    const material = mesh.material as THREE.MeshStandardMaterial
    if (!material?.isMeshStandardMaterial || seen.has(material)) return
    seen.add(material)
    material.emissive.set('#3dff6e')
    material.emissiveIntensity = 1.1
    leds.push(material)
  })

  const shadowMaterial = shadow.material as THREE.MeshBasicMaterial
  return {
    group,
    height: Math.max(size.y, 0.001),
    width: Math.max(size.x, size.z, 0.001),
    leds,
    dispose: () => {
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
