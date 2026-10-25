import { useSyncExternalStore } from 'react'
import { isMuted, setMuted, subscribeMuted } from './engine'
import { playSfx } from './sfx'

/** Fixed speaker button in the top right corner; the setting is remembered. */
export default function AudioToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false)

  const toggle = () => {
    if (muted) {
      setMuted(false)
      playSfx('uiToggle')
    } else {
      playSfx('uiToggle')
      setMuted(true)
    }
  }

  return (
    <button
      type="button"
      className={`audio-toggle${muted ? ' is-muted' : ''}`}
      onClick={toggle}
      data-sfx="none"
      aria-pressed={!muted}
      aria-label={muted ? 'Sound einschalten' : 'Sound ausschalten'}
      title={muted ? 'Sound einschalten' : 'Sound ausschalten'}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M4 9v6h4l5 4V5L8 9H4Z" />
        {muted ? (
          <path className="audio-toggle-cross" d="M16 9.5l4.5 5M20.5 9.5l-4.5 5" />
        ) : (
          <>
            <path className="audio-toggle-wave" d="M16 8.2a5.2 5.2 0 0 1 0 7.6" />
            <path className="audio-toggle-wave" d="M18.6 5.8a8.6 8.6 0 0 1 0 12.4" />
          </>
        )}
      </svg>
    </button>
  )
}
