import { useEffect } from 'react'
import AudioToggle from './AudioToggle'
import { unlockAudio } from './engine'
import { startMusic } from './music'
import { isSoundName, playSfx } from './sfx'

/** Anything the browser would treat as a UI control. */
const CONTROL_SELECTOR = [
  'button',
  'a',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="radio"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(',')

/**
 * Global audio glue: unlocks the context on the first gesture, gives every
 * ordinary button/link a quiet click and hosts the mute switch. Interactive
 * elements can opt out with data-sfx="none" or name a specific effect with
 * data-sfx="…"; the bomb's module cards opt out because their state changes
 * already play the matching mechanical sound.
 */
export default function AudioRoot() {
  useEffect(() => {
    // Music continues across routes because this component never unmounts.
    startMusic()
    const unlock = () => {
      unlockAudio()
      startMusic()
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const control = target.closest<HTMLElement>(CONTROL_SELECTOR)
      if (!control) return
      if (control instanceof HTMLButtonElement && control.disabled) return
      if (control.getAttribute('aria-disabled') === 'true') return
      if (control.closest('[data-sfx="none"], .bomb-module, .bomb-zoom-panel')) return
      const custom = control.getAttribute('data-sfx')
      playSfx(isSoundName(custom) ? custom : 'uiClick')
    }

    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
    document.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true })
      window.removeEventListener('keydown', unlock, { capture: true })
      document.removeEventListener('click', onClick)
    }
  }, [])

  return <AudioToggle />
}
