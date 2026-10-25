import { useEffect } from 'react'
import { startAmbience, stopAmbience, type AmbienceKind } from './engine'
import { playSfx } from './sfx'

/**
 * Runs a procedural soundscape for as long as the page is mounted and sprinkles
 * a few one-shot wildlife sounds on top (birds, a passing car, a dog).
 */
export function useAmbience(kind: AmbienceKind, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    startAmbience(kind)

    const timers: number[] = []
    let stopped = false
    const every = (min: number, max: number, run: () => void) => {
      const schedule = () => {
        if (stopped) return
        timers.push(
          window.setTimeout(
            () => {
              if (stopped) return
              run()
              schedule()
            },
            min + Math.random() * (max - min),
          ),
        )
      }
      schedule()
    }

    if (kind === 'islands') {
      every(3000, 7500, () => playSfx('bird', { volume: 0.55, pan: Math.random() * 1.4 - 0.7 }))
      every(11000, 24000, () => playSfx('car', { volume: 0.45, pan: Math.random() * 1.2 - 0.6 }))
      every(17000, 35000, () =>
        playSfx(Math.random() < 0.6 ? 'dog' : 'cat', { volume: 0.32, pan: Math.random() * 1.2 - 0.6 }),
      )
    } else if (kind === 'house') {
      every(5000, 12000, () => playSfx('bird', { volume: 0.3, pan: Math.random() * 1.4 - 0.7 }))
    }

    return () => {
      stopped = true
      for (const timer of timers) window.clearTimeout(timer)
      stopAmbience(kind)
    }
  }, [kind, enabled])
}
