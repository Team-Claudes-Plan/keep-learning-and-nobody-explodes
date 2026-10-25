import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { setMusicDucked } from '../audio/music'
import { playSfx, SOUND_LIBRARY, type SoundName } from '../audio/sfx'

const ALL_GAP_MS = 380

/** Dev/demo page: every sound in the library, one click away. */
export default function SoundTestPage() {
  const [playing, setPlaying] = useState<SoundName | null>(null)
  const [all, setAll] = useState(false)
  const run = useRef(0)

  useEffect(() => () => void run.current++, [])

  // Keep the background music out of the way while auditioning effects.
  useEffect(() => {
    setMusicDucked(true)
    return () => setMusicDucked(false)
  }, [])

  function play(name: SoundName) {
    playSfx(name)
    setPlaying(name)
    window.setTimeout(() => setPlaying((current) => (current === name ? null : current)), 320)
  }

  async function playAll() {
    if (all) return
    const token = ++run.current
    setAll(true)
    for (const group of SOUND_LIBRARY) {
      for (const sound of group.sounds) {
        if (run.current !== token) return
        play(sound.name)
        await new Promise((resolve) => window.setTimeout(resolve, ALL_GAP_MS))
      }
    }
    if (run.current === token) setAll(false)
  }

  const count = SOUND_LIBRARY.reduce((sum, group) => sum + group.sounds.length, 0)

  return (
    <div className="mg-page mg-page-wide sound-test">
      <header className="mg-header">
        <h1>🔊 Sound-Test</h1>
        <Link to="/minigames">← Minigames</Link>
      </header>

      <p className="mg-muted">
        {count} Effekte, alle live synthetisiert. Der erste Klick schaltet Audio frei; oben rechts kannst du
        stummschalten. Die Sounds laufen auch in der echten Umgebung: Inseln, Häuser, Räume, Handbuch und Bombe.
      </p>

      <button type="button" className="mg-button mg-primary" onClick={playAll} disabled={all} data-sfx="none">
        {all ? 'Spielt alle Sounds …' : 'Alle nacheinander abspielen'}
      </button>

      {SOUND_LIBRARY.map((group) => (
        <section key={group.title} className="sound-group">
          <div className="sound-group-head">
            <h2>{group.title}</h2>
            <span className="mg-muted">{group.hint}</span>
          </div>
          <div className="sound-grid">
            {group.sounds.map((sound) => (
              <button
                key={sound.name}
                type="button"
                className={`sound-button${playing === sound.name ? ' is-playing' : ''}`}
                onClick={() => play(sound.name)}
                data-sfx="none"
              >
                <span className="sound-button-label">{sound.label}</span>
                <code>{sound.name}</code>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
