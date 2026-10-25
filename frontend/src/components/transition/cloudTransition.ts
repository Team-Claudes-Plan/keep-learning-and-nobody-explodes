import { playSfx } from '../../audio/sfx'

export type CloudPhase = 'idle' | 'in' | 'hold' | 'out'

// Milliseconds per phase. Keep in sync with the CSS animation durations.
export const CLOUD_TIMING = { in: 650, hold: 500, out: 900 }

let phase: CloudPhase = 'idle'
const listeners = new Set<() => void>()

function setPhase(next: CloudPhase) {
  phase = next
  for (const listener of listeners) listener()
}

export function subscribeCloudPhase(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getCloudPhase() {
  return phase
}

/**
 * Clouds rush in, `onCovered` runs once the screen is fully hidden
 * (navigate there), then the clouds part again.
 */
export function playCloudTransition(onCovered: () => void) {
  if (phase !== 'idle') return
  playSfx('cloud')
  setPhase('in')
  window.setTimeout(() => {
    setPhase('hold')
    onCovered()
    window.setTimeout(() => {
      playSfx('whooshBack', { volume: 0.5 })
      setPhase('out')
      window.setTimeout(() => setPhase('idle'), CLOUD_TIMING.out + 150)
    }, CLOUD_TIMING.hold)
  }, CLOUD_TIMING.in)
}
