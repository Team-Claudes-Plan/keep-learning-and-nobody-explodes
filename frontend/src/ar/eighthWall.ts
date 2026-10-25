import type * as THREE from 'three'

/** The tiny slice of the 8th Wall engine API this demo uses. */
export type XrHit = {
  type: 'FEATURE_POINT' | 'ESTIMATED_SURFACE' | 'DETECTED_SURFACE' | 'UNSPECIFIED'
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  distance: number
}

export type XrPipelineModule = {
  name: string
  onStart?: (options: { canvas: HTMLCanvasElement }) => void
  onUpdate?: () => void
  onDetach?: () => void
  onCameraStatusChange?: (options: { status: string }) => void
  onException?: (error: unknown) => void
  [key: string]: unknown
}

export type XrScene = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
}

export type XRExtrasApi = {
  FullWindowCanvas?: { pipelineModule: () => XrPipelineModule }
}

export type Xr8Api = {
  addCameraPipelineModules: (modules: XrPipelineModule[]) => void
  clearCameraPipelineModules: () => void
  run: (options: { canvas: HTMLCanvasElement; allowedDevices?: unknown }) => Promise<void>
  stop: () => void | Promise<void>
  GlTextureRenderer: { pipelineModule: () => XrPipelineModule }
  Threejs: {
    pipelineModule: () => XrPipelineModule
    xrScene: () => XrScene
  }
  XrController: {
    pipelineModule: () => XrPipelineModule
    updateCameraProjectionMatrix: (options: { origin: THREE.Vector3; facing: THREE.Quaternion }) => void
    hitTest: (x: number, y: number, includedTypes?: string[]) => XrHit[]
    recenter: () => void
  }
  XrConfig?: {
    device: () => { ANY: unknown }
  }
}

declare global {
  interface Window {
    XR8?: Xr8Api
    XRExtras?: XRExtrasApi
  }
}

const ENGINE_URL = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js'
const XREXTRAS_URL = 'https://cdn.jsdelivr.net/npm/@8thwall/xrextras@1/dist/xrextras.js'

let loading: Promise<Xr8Api> | null = null
let extrasLoading: Promise<XRExtrasApi | undefined> | null = null

function injectScript(src: string, attributes: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-ar-src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Script konnte nicht geladen werden: ${src}`)), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.arSrc = src
    for (const [key, value] of Object.entries(attributes)) script.setAttribute(key, value)
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true'
        resolve()
      },
      { once: true },
    )
    script.addEventListener(
      'error',
      () => {
        // Remove the broken tag, so a retry injects it again instead of waiting forever.
        script.remove()
        reject(new Error(`Script konnte nicht geladen werden: ${src}`))
      },
      { once: true },
    )
    document.head.appendChild(script)
  })
}

/**
 * Loads the 8th Wall engine from the CDN. The engine is free and open source and needs no app key.
 * The promise is shared, so the page can warm the engine up before the user taps "AR starten".
 */
export function loadXr8(): Promise<Xr8Api> {
  if (window.XR8) return Promise.resolve(window.XR8)
  if (loading) return loading

  loading = new Promise<Xr8Api>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Die 8th-Wall-Engine hat zu lange zum Laden gebraucht.'))
    }, 45000)

    const ready = () => {
      window.clearTimeout(timeout)
      if (window.XR8) resolve(window.XR8)
      else reject(new Error('Die 8th-Wall-Engine wurde geladen, ist aber nicht verfügbar.'))
    }

    window.addEventListener('xrloaded', ready, { once: true })

    injectScript(ENGINE_URL, { 'data-preload-chunks': 'slam' }).catch((error: unknown) => {
      window.clearTimeout(timeout)
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  }).catch((error: unknown) => {
    // Allow a retry after a network hiccup.
    loading = null
    throw error
  })

  return loading
}

/**
 * XRExtras is optional: its FullWindowCanvas module keeps the camera canvas filling the window
 * across orientation changes and browser chrome. If it cannot load, the demo still runs.
 */
export function loadXRExtras(): Promise<XRExtrasApi | undefined> {
  if (window.XRExtras) return Promise.resolve(window.XRExtras)
  if (extrasLoading) return extrasLoading
  const loaded = injectScript(XREXTRAS_URL, {})
    .then(() => window.XRExtras)
    .catch(() => undefined)
  // Optional extra: never hold up the AR start on a slow or blocked CDN.
  const timeout = new Promise<undefined>((resolve) => {
    window.setTimeout(() => resolve(undefined), 8000)
  })
  extrasLoading = Promise.race([loaded, timeout])
  return extrasLoading
}

/** Starts loading the engine in the background, without asking for the camera yet. */
export function preloadXr8(): void {
  void loadXr8().catch(() => undefined)
  void loadXRExtras()
}
