// The sound library. Every effect is synthesised with the Web Audio helpers in
// engine.ts, so there are no audio files to load or keep in sync.

import { isAudioUnlocked, isMuted, noiseBurst, tone, type NoiseOptions, type ToneOptions } from './engine'

export type SoundName =
  // interface
  | 'uiClick'
  | 'uiHover'
  | 'uiToggle'
  | 'uiSuccess'
  | 'uiError'
  | 'pageFlip'
  | 'whoosh'
  | 'whooshBack'
  | 'cloud'
  | 'launch'
  | 'distantBoom'
  | 'copy'
  // bomb
  | 'arm'
  | 'select'
  | 'back'
  | 'hoverModule'
  | 'tick'
  | 'tickUrgent'
  | 'send'
  | 'correct'
  | 'wrong'
  | 'strike'
  | 'boom'
  | 'clank'
  | 'fanfare'
  | 'testDone'
  | 'door'
  | 'pickup'
  | 'putdown'
  // modules
  | 'snip'
  | 'fuse'
  | 'switch'
  | 'ratchet'
  | 'plug'
  | 'servo'
  | 'dial'
  | 'key'
  | 'buttonPress'
  | 'slide'
  | 'radar'
  // world / uploads
  | 'bird'
  | 'dog'
  | 'cat'
  | 'car'
  | 'bridge'
  | 'house'
  | 'uploadOpen'
  | 'uploadClose'
  | 'uploadDone'
  | 'uploadError'

export type SoundEntry = { name: SoundName; label: string }
export type SoundGroup = { title: string; hint: string; sounds: SoundEntry[] }

/** Catalogue used by the in-game sound test page (`/soundtest`). */
export const SOUND_LIBRARY: SoundGroup[] = [
  {
    title: 'Interface',
    hint: 'Klicks, Übergänge und Rückmeldung',
    sounds: [
      { name: 'uiClick', label: 'UI-Klick' },
      { name: 'uiHover', label: 'UI-Hover' },
      { name: 'uiToggle', label: 'UI-Umschalten' },
      { name: 'uiSuccess', label: 'Erfolg' },
      { name: 'uiError', label: 'Fehler' },
      { name: 'pageFlip', label: 'Buchseite' },
      { name: 'whoosh', label: 'Whoosh hin' },
      { name: 'whooshBack', label: 'Whoosh zurück' },
      { name: 'cloud', label: 'Wolken-Übergang' },
      { name: 'launch', label: 'Spielstart' },
      { name: 'distantBoom', label: 'Ferne Explosion' },
      { name: 'copy', label: 'Kopiert' },
    ],
  },
  {
    title: 'Bombe',
    hint: 'Timer, Antworten, Explosion und Fanfare',
    sounds: [
      { name: 'arm', label: 'Scharfmachen' },
      { name: 'select', label: 'Modul auswählen' },
      { name: 'back', label: 'Modul verlassen' },
      { name: 'hoverModule', label: 'Modul-Hover' },
      { name: 'tick', label: 'Timer-Tick' },
      { name: 'tickUrgent', label: 'Timer-Tick (letzte 10 s)' },
      { name: 'send', label: 'Antwort senden' },
      { name: 'correct', label: 'Richtig' },
      { name: 'wrong', label: 'Falsch' },
      { name: 'strike', label: 'Strike-Alarm' },
      { name: 'boom', label: 'Explosion' },
      { name: 'clank', label: 'Trümmer-Clank' },
      { name: 'fanfare', label: 'Fanfare' },
      { name: 'testDone', label: 'Test fertig' },
      { name: 'door', label: 'Tür' },
      { name: 'pickup', label: 'Bombe hochheben' },
      { name: 'putdown', label: 'Bombe absetzen' },
    ],
  },
  {
    title: 'Module',
    hint: 'Jedes Modul hat seine eigene Mechanik',
    sounds: [
      { name: 'snip', label: 'Kabel schneiden' },
      { name: 'fuse', label: 'Sicherung' },
      { name: 'switch', label: 'Schalter' },
      { name: 'ratchet', label: 'Drehschalter' },
      { name: 'plug', label: 'Kabel einstecken' },
      { name: 'servo', label: 'Sortier-Servo' },
      { name: 'dial', label: 'Zahlenschloss' },
      { name: 'key', label: 'Tastatur' },
      { name: 'buttonPress', label: 'Knopf' },
      { name: 'slide', label: 'Slider' },
      { name: 'radar', label: 'Radar' },
    ],
  },
  {
    title: 'Welt & Uploads',
    hint: 'Inseln, Gebäude und Dokumente',
    sounds: [
      { name: 'bird', label: 'Vogel' },
      { name: 'dog', label: 'Hund' },
      { name: 'cat', label: 'Katze' },
      { name: 'car', label: 'Auto' },
      { name: 'bridge', label: 'Brücke' },
      { name: 'house', label: 'Haus betreten' },
      { name: 'uploadOpen', label: 'Upload öffnen' },
      { name: 'uploadClose', label: 'Upload schließen' },
      { name: 'uploadDone', label: 'Upload fertig' },
      { name: 'uploadError', label: 'Upload-Fehler' },
    ],
  },
]

const SOUND_NAMES: ReadonlySet<string> = new Set(
  SOUND_LIBRARY.flatMap((group) => group.sounds.map((sound) => sound.name)),
)

export function isSoundName(value: string | null | undefined): value is SoundName {
  return value !== null && value !== undefined && SOUND_NAMES.has(value)
}

export type PlaySfxOptions = {
  /** Multiplies the sound's own level, 0…2. */
  volume?: number
  /** Stereo position, -1 (left) … 1 (right). */
  pan?: number
  /** Pitch multiplier for repeated sounds (button steps, wildlife variation). */
  rate?: number
}

const lastPlayed = new Map<SoundName, number>()

/** Plays one named effect. Safe to call from any event handler; never throws. */
export function playSfx(name: SoundName, options: PlaySfxOptions = {}) {
  if (!isAudioUnlocked() || isMuted()) return
  const stamp = performance.now()
  const throttle = name === 'uiClick' ? 28 : name === 'uiHover' || name === 'hoverModule' ? 55 : 0
  if (throttle > 0) {
    const previous = lastPlayed.get(name) ?? -Infinity
    if (stamp - previous < throttle) return
    lastPlayed.set(name, stamp)
  }

  const vol = Math.max(0, options.volume ?? 1)
  const pan = options.pan
  const rate = Math.max(0.25, options.rate ?? 1)
  const f = (hz: number) => hz * rate
  const toneAt = (settings: ToneOptions) =>
    tone({ ...settings, gain: (settings.gain ?? 0.1) * vol, pan })
  const noiseAt = (settings: NoiseOptions) =>
    noiseBurst({ ...settings, gain: (settings.gain ?? 0.1) * vol, pan })

  switch (name) {
    /* ------------------------------------------------------------ interface */
    case 'uiClick':
      noiseAt({ duration: 0.03, gain: 0.045, type: 'highpass', freq: 1700, q: 0.7 })
      toneAt({ type: 'square', freq: f(520), freqEnd: f(430), duration: 0.035, gain: 0.03, lowpass: 2600 })
      break
    case 'uiHover':
      toneAt({ type: 'sine', freq: f(900), freqEnd: f(1040), duration: 0.032, gain: 0.018 })
      break
    case 'uiToggle':
      toneAt({ type: 'triangle', freq: f(660), duration: 0.05, gain: 0.052 })
      toneAt({ type: 'triangle', freq: f(990), duration: 0.06, gain: 0.045, when: 0.055 })
      break
    case 'uiSuccess':
      ;[660, 880, 1320].forEach((hz, i) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: i === 2 ? 0.22 : 0.12, gain: 0.075, when: i * 0.08 }),
      )
      toneAt({ type: 'sine', freq: f(1760), duration: 0.24, gain: 0.025, when: 0.17 })
      break
    case 'uiError':
      toneAt({ type: 'sawtooth', freq: f(185), freqEnd: f(120), duration: 0.27, gain: 0.055, lowpass: 800 })
      toneAt({ type: 'square', freq: f(120), freqEnd: f(88), duration: 0.22, gain: 0.04, when: 0.03 })
      break
    case 'pageFlip':
      // Paper bending: bright rustle plus a soft low body.
      noiseAt({ duration: 0.22, gain: 0.05, type: 'bandpass', freq: 1050, freqEnd: 3400, q: 0.7, pan: -0.15 })
      noiseAt({ duration: 0.16, gain: 0.026, type: 'highpass', freq: 2200, freqEnd: 900, when: 0.07, pan: 0.2 })
      noiseAt({ duration: 0.18, gain: 0.018, type: 'lowpass', freq: 520, when: 0.02 })
      break
    case 'whoosh':
      // Wider whoosh: two bands sweeping in opposite stereo positions.
      noiseAt({ duration: 0.42, gain: 0.08, type: 'bandpass', freq: 280, freqEnd: 2200, q: 0.6, pan: -0.25 })
      noiseAt({ duration: 0.36, gain: 0.035, type: 'bandpass', freq: 380, freqEnd: 1700, q: 0.8, when: 0.03, pan: 0.25 })
      toneAt({ type: 'sine', freq: f(110), freqEnd: f(180), duration: 0.38, gain: 0.015 })
      break
    case 'whooshBack':
      noiseAt({ duration: 0.38, gain: 0.075, type: 'bandpass', freq: 2200, freqEnd: 260, q: 0.6, pan: 0.25 })
      noiseAt({ duration: 0.32, gain: 0.032, type: 'bandpass', freq: 1700, freqEnd: 320, q: 0.8, when: 0.03, pan: -0.25 })
      toneAt({ type: 'sine', freq: f(180), freqEnd: f(100), duration: 0.34, gain: 0.014 })
      break
    case 'cloud':
      noiseAt({ duration: 0.7, gain: 0.085, type: 'lowpass', freq: 240, freqEnd: 1500, q: 0.6 })
      noiseAt({ duration: 0.55, gain: 0.04, type: 'highpass', freq: 600, freqEnd: 2600, when: 0.08 })
      break
    case 'launch':
      toneAt({ type: 'sine', freq: f(115), freqEnd: f(32), duration: 0.6, gain: 0.16 })
      noiseAt({ duration: 0.5, gain: 0.07, type: 'lowpass', freq: 320, freqEnd: 2200, q: 0.6 })
      noiseAt({ duration: 0.35, gain: 0.04, type: 'bandpass', freq: 700, freqEnd: 2800, when: 0.08 })
      break
    case 'distantBoom':
      noiseAt({ duration: 0.8, gain: 0.11, type: 'lowpass', freq: 520, freqEnd: 80, q: 0.5 })
      toneAt({ type: 'sine', freq: f(70), freqEnd: f(28), duration: 0.7, gain: 0.07 })
      break
    case 'copy':
      toneAt({ type: 'triangle', freq: f(880), duration: 0.06, gain: 0.045 })
      toneAt({ type: 'triangle', freq: f(1320), duration: 0.08, gain: 0.04, when: 0.07 })
      break

    /* ----------------------------------------------------------------- bomb */
    case 'arm':
      // Power comes up: relay clicks, a low hum and a rising ready signal.
      toneAt({ type: 'sine', freq: f(58), duration: 0.5, gain: 0.025, attack: 0.05 })
      ;[440, 554, 659, 880].forEach((hz, i) =>
        toneAt({ type: 'square', freq: f(hz), duration: 0.07, gain: 0.035, lowpass: 2400, when: i * 0.1 }),
      )
      ;[0, 0.1, 0.2, 0.31].forEach((when) =>
        noiseAt({ duration: 0.015, gain: 0.03, type: 'highpass', freq: 2600, when }),
      )
      toneAt({ type: 'triangle', freq: f(220), freqEnd: f(330), duration: 0.35, gain: 0.015, when: 0.1 })
      break
    case 'select':
      // Latch the module into view: mechanical click plus a short air sweep.
      noiseAt({ duration: 0.02, gain: 0.04, type: 'highpass', freq: 1800 })
      toneAt({ type: 'triangle', freq: f(190), freqEnd: f(140), duration: 0.06, gain: 0.03 })
      toneAt({ type: 'sine', freq: f(640), freqEnd: f(980), duration: 0.14, gain: 0.03 })
      noiseAt({ duration: 0.26, gain: 0.05, type: 'bandpass', freq: 480, freqEnd: 1900, q: 0.7 })
      break
    case 'back':
      // The same latch, but the air rushes back out.
      noiseAt({ duration: 0.02, gain: 0.035, type: 'highpass', freq: 1700 })
      toneAt({ type: 'triangle', freq: f(170), freqEnd: f(110), duration: 0.06, gain: 0.025 })
      toneAt({ type: 'sine', freq: f(760), freqEnd: f(340), duration: 0.15, gain: 0.03 })
      noiseAt({ duration: 0.28, gain: 0.05, type: 'bandpass', freq: 1900, freqEnd: 420, q: 0.7 })
      break
    case 'hoverModule':
      toneAt({ type: 'sine', freq: f(920), freqEnd: f(1080), duration: 0.03, gain: 0.017 })
      break
    case 'tick':
      // Wooden clock tick: short body plus a little top-end.
      noiseAt({ duration: 0.016, gain: 0.028, type: 'bandpass', freq: 1800, q: 1.2 })
      toneAt({ type: 'triangle', freq: f(720), freqEnd: f(520), duration: 0.028, gain: 0.025 })
      break
    case 'tickUrgent':
      // Loud, sharp clock tick for the last ten seconds: it has to cut through
      // the music and the module sounds.
      noiseAt({ duration: 0.025, gain: 0.1, type: 'highpass', freq: 3000 })
      toneAt({ type: 'square', freq: f(1850), freqEnd: f(1250), duration: 0.045, gain: 0.075, lowpass: 5200 })
      toneAt({ type: 'sine', freq: f(140), freqEnd: f(78), duration: 0.08, gain: 0.09 })
      toneAt({ type: 'triangle', freq: f(2650), duration: 0.04, gain: 0.03, when: 0.004 })
      break
    case 'send':
      // Uplink chirp with a relay click underneath.
      toneAt({ type: 'square', freq: f(880), freqEnd: f(1400), duration: 0.07, gain: 0.045, lowpass: 4200 })
      toneAt({ type: 'sine', freq: f(1760), duration: 0.05, gain: 0.03, when: 0.055 })
      toneAt({ type: 'triangle', freq: f(1500), duration: 0.08, gain: 0.018, when: 0.09 })
      noiseAt({ duration: 0.03, gain: 0.025, type: 'highpass', freq: 2600 })
      break
    case 'correct':
      // Bright four-note arpeggio with a glassy sparkle on top.
      ;[523.25, 659.25, 783.99, 1046.5].forEach((hz, i) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: i === 3 ? 0.26 : 0.14, gain: 0.075, when: i * 0.085 }),
      )
      ;[1046.5, 1318.51, 1567.98].forEach((hz, i) =>
        toneAt({ type: 'sine', freq: f(hz), duration: 0.28, gain: 0.018, when: 0.28 + i * 0.05 }),
      )
      break
    case 'wrong':
      // Dissonant two-tone buzz, a low thump and a dry error click.
      toneAt({ type: 'sawtooth', freq: f(220), duration: 0.26, gain: 0.05, lowpass: 900 })
      toneAt({ type: 'sawtooth', freq: f(233), duration: 0.26, gain: 0.045, lowpass: 900 })
      toneAt({ type: 'square', freq: f(110), duration: 0.2, gain: 0.035, when: 0.03 })
      toneAt({ type: 'sine', freq: f(70), freqEnd: f(45), duration: 0.24, gain: 0.05, when: 0.02 })
      noiseAt({ duration: 0.018, gain: 0.03, type: 'highpass', freq: 2200, when: 0.02 })
      break
    case 'strike':
      // Klaxon hits with a low thump; the last one rings out.
      ;[0, 0.22, 0.44].forEach((when, i) => {
        toneAt({ type: 'square', freq: f(880), duration: 0.1, gain: 0.055, lowpass: 3000, when })
        toneAt({ type: 'square', freq: f(620), duration: 0.1, gain: 0.045, lowpass: 3000, when: when + 0.11 })
        toneAt({ type: 'sine', freq: f(70), freqEnd: f(45), duration: 0.2, gain: 0.06, when })
        if (i === 2) {
          toneAt({ type: 'sawtooth', freq: f(620), freqEnd: f(430), duration: 0.7, gain: 0.025, lowpass: 2200, when: 0.55 })
        }
      })
      break
    case 'boom': {
      // Crack, body, sub drop, flying debris and a faint ringing in the ears.
      noiseAt({ duration: 0.16, gain: 0.16, type: 'highpass', freq: 2200, q: 0.6, attack: 0.002 })
      noiseAt({ duration: 2.6, gain: 0.46, type: 'lowpass', freq: 2200, freqEnd: 90, q: 0.45, attack: 0.004 })
      noiseAt({ duration: 1.2, gain: 0.12, type: 'bandpass', freq: 700, freqEnd: 120, q: 0.5, when: 0.02, pan: -0.25 })
      noiseAt({ duration: 1.1, gain: 0.1, type: 'bandpass', freq: 900, freqEnd: 150, q: 0.5, when: 0.06, pan: 0.3 })
      toneAt({ type: 'sine', freq: f(120), freqEnd: f(24), duration: 1.2, gain: 0.32 })
      toneAt({ type: 'sine', freq: f(54), freqEnd: f(20), duration: 1.8, gain: 0.18 })
      toneAt({ type: 'triangle', freq: f(240), freqEnd: f(45), duration: 0.5, gain: 0.06 })
      ;[0.35, 0.55, 0.72, 0.95, 1.2, 1.5].forEach((when, i) =>
        noiseAt({
          duration: 0.05,
          gain: 0.05 - i * 0.006,
          type: 'highpass',
          freq: 1800 + Math.random() * 1800,
          when,
          pan: Math.random() * 1.4 - 0.7,
        }),
      )
      toneAt({ type: 'sine', freq: f(3200), duration: 1.8, gain: 0.008, attack: 0.2, when: 0.1 })
      break
    }
    case 'clank': {
      // Sheet metal: inharmonic partials, a bright scrape and a low body thud.
      const base = f(260 + Math.random() * 600)
      ;[1, 2.4, 4.1, 6.2].forEach((ratio, i) =>
        toneAt({ type: 'triangle', freq: base * ratio, duration: 0.32 - i * 0.03, gain: 0.032 - i * 0.005 }),
      )
      noiseAt({ duration: 0.04, gain: 0.04, type: 'highpass', freq: 2200 })
      toneAt({ type: 'sine', freq: f(90), freqEnd: f(55), duration: 0.14, gain: 0.05 })
      break
    }
    case 'fanfare': {
      // Timpani hit, a bright fanfare, then a warm held chord and a sparkle.
      toneAt({ type: 'sine', freq: f(130), freqEnd: f(60), duration: 0.45, gain: 0.1, when: 0.5 })
      noiseAt({ duration: 0.25, gain: 0.05, type: 'lowpass', freq: 260, when: 0.5 })
      ;[523.25, 659.25, 783.99, 1046.5].forEach((hz, i) =>
        toneAt({ type: 'square', freq: f(hz), duration: 0.18, gain: 0.06, lowpass: 5000, when: i * 0.11 }),
      )
      ;[523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((hz) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: 1.5, gain: 0.038, when: 0.5 }),
      )
      toneAt({ type: 'sine', freq: f(261.63), duration: 1.5, gain: 0.055, when: 0.5 })
      toneAt({ type: 'sine', freq: f(2093), duration: 0.9, gain: 0.012, when: 0.85 })
      break
    }
    case 'testDone':
      ;[440, 554.37, 659.25].forEach((hz, i) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: i === 2 ? 0.28 : 0.13, gain: 0.06, when: i * 0.09 }),
      )
      break
    case 'door':
      // Creak, latch and a soft low thud as it swings shut.
      toneAt({ type: 'sawtooth', freq: f(135), freqEnd: f(72), duration: 0.35, gain: 0.045, lowpass: 600 })
      noiseAt({ duration: 0.3, gain: 0.035, type: 'lowpass', freq: 520 })
      toneAt({ type: 'sine', freq: f(92), freqEnd: f(46), duration: 0.22, gain: 0.07, when: 0.24 })
      noiseAt({ duration: 0.02, gain: 0.035, type: 'highpass', freq: 2200, when: 0.26 })
      break
    case 'pickup':
      // Cloth/air as the bomb comes off the table plus a metal grip.
      noiseAt({ duration: 0.24, gain: 0.045, type: 'bandpass', freq: 400, freqEnd: 1900, q: 0.7 })
      toneAt({ type: 'sine', freq: f(420), freqEnd: f(700), duration: 0.12, gain: 0.035 })
      noiseAt({ duration: 0.015, gain: 0.02, type: 'highpass', freq: 2500, when: 0.02 })
      break
    case 'putdown':
      // Setting it back down: descending air, a low thud and a metal tick.
      noiseAt({ duration: 0.2, gain: 0.04, type: 'bandpass', freq: 1900, freqEnd: 350, q: 0.7 })
      toneAt({ type: 'sine', freq: f(110), freqEnd: f(50), duration: 0.2, gain: 0.07 })
      noiseAt({ duration: 0.015, gain: 0.03, type: 'highpass', freq: 2200, when: 0.18 })
      break

    /* -------------------------------------------------------------- modules */
    case 'snip':
      // Sharp jaws, a metallic ring and a tiny spark of copper.
      noiseAt({ duration: 0.022, gain: 0.08, type: 'highpass', freq: 3000 })
      toneAt({ type: 'triangle', freq: f(2500), freqEnd: f(900), duration: 0.09, gain: 0.055 })
      noiseAt({ duration: 0.018, gain: 0.05, type: 'highpass', freq: 4200, when: 0.045 })
      toneAt({ type: 'sine', freq: f(1200), duration: 0.05, gain: 0.02, when: 0.05 })
      break
    case 'fuse':
      // Ceramic/metal click as the fuse seats, with a little contact ring.
      noiseAt({ duration: 0.018, gain: 0.05, type: 'highpass', freq: 2000 })
      toneAt({ type: 'triangle', freq: f(420), freqEnd: f(280), duration: 0.06, gain: 0.06, lowpass: 1600 })
      noiseAt({ duration: 0.04, gain: 0.035, type: 'lowpass', freq: 700, when: 0.012 })
      toneAt({ type: 'sine', freq: f(900), duration: 0.035, gain: 0.018, when: 0.008 })
      break
    case 'switch':
      // A proper toggle: high tick, body clack, spring ring and a low thump.
      {
        const body = 190 + Math.random() * 40
        noiseAt({ duration: 0.018, gain: 0.05, type: 'highpass', freq: 2800 })
        noiseAt({ duration: 0.055, gain: 0.07, type: 'lowpass', freq: 1300 })
        toneAt({ type: 'triangle', freq: f(body), freqEnd: f(body * 0.58), duration: 0.085, gain: 0.05, lowpass: 1500 })
        toneAt({ type: 'sine', freq: f(780 + Math.random() * 240), duration: 0.07, gain: 0.014, when: 0.006 })
        toneAt({ type: 'sine', freq: f(120), duration: 0.06, gain: 0.025, when: 0.012 })
      }
      break
    case 'ratchet':
      // Detent of a rotary switch: crisp tick with a small metal ring.
      {
        const base = 1050 + Math.random() * 500
        toneAt({ type: 'square', freq: f(base), duration: 0.018, gain: 0.03, lowpass: 5200 })
        toneAt({ type: 'triangle', freq: f(base * 1.9), duration: 0.05, gain: 0.012 })
        noiseAt({ duration: 0.012, gain: 0.035, type: 'highpass', freq: 3400 })
        toneAt({ type: 'sine', freq: f(160), duration: 0.03, gain: 0.025 })
      }
      break
    case 'plug':
      // Rubber pop, contact click and a small cable thump.
      toneAt({ type: 'sine', freq: f(380), freqEnd: f(160), duration: 0.075, gain: 0.07 })
      noiseAt({ duration: 0.04, gain: 0.055, type: 'lowpass', freq: 800 })
      toneAt({ type: 'triangle', freq: f(220), duration: 0.06, gain: 0.03, when: 0.01 })
      noiseAt({ duration: 0.012, gain: 0.03, type: 'highpass', freq: 2600, when: 0.05 })
      break
    case 'servo':
      // Little motor spins up, moves the part and hits the end stop.
      toneAt({ type: 'sawtooth', freq: f(90), freqEnd: f(175), duration: 0.24, gain: 0.03, lowpass: 1100 })
      noiseAt({ duration: 0.2, gain: 0.022, type: 'bandpass', freq: 420, q: 1.1 })
      toneAt({ type: 'square', freq: f(300), duration: 0.04, gain: 0.012, when: 0.21 })
      noiseAt({ duration: 0.018, gain: 0.025, type: 'highpass', freq: 1800, when: 0.21 })
      break
    case 'dial':
      // Heavier number-wheel detent than the small rotary switch.
      {
        const base = 700 + Math.random() * 300
        toneAt({ type: 'square', freq: f(base), duration: 0.025, gain: 0.03, lowpass: 4200 })
        noiseAt({ duration: 0.012, gain: 0.025, type: 'highpass', freq: 2600 })
        toneAt({ type: 'sine', freq: f(120), duration: 0.04, gain: 0.03 })
        toneAt({ type: 'triangle', freq: f(base * 2.4), duration: 0.06, gain: 0.008 })
      }
      break
    case 'key':
      // Typewriter / terminal key: small plastic click with a short tone.
      noiseAt({ duration: 0.016, gain: 0.032, type: 'highpass', freq: 2500 })
      toneAt({ type: 'triangle', freq: f(1120), duration: 0.02, gain: 0.022 })
      noiseAt({ duration: 0.02, gain: 0.02, type: 'lowpass', freq: 700, when: 0.012 })
      break
    case 'buttonPress':
      // Arcade button: low thump, plastic click and a clear beep.
      toneAt({ type: 'sine', freq: f(150), freqEnd: f(85), duration: 0.07, gain: 0.055 })
      noiseAt({ duration: 0.018, gain: 0.045, type: 'highpass', freq: 2100 })
      toneAt({ type: 'square', freq: f(500), duration: 0.09, gain: 0.04, lowpass: 2800 })
      toneAt({ type: 'sine', freq: f(1000), duration: 0.04, gain: 0.018, when: 0.005 })
      break
    case 'slide':
      // Friction along the rail, then a soft stop.
      noiseAt({ duration: 0.2, gain: 0.04, type: 'bandpass', freq: 380, freqEnd: 1600, q: 0.7 })
      noiseAt({ duration: 0.16, gain: 0.025, type: 'bandpass', freq: 1600, freqEnd: 420, when: 0.05 })
      toneAt({ type: 'sine', freq: f(150), freqEnd: f(110), duration: 0.18, gain: 0.02 })
      noiseAt({ duration: 0.014, gain: 0.028, type: 'highpass', freq: 2200, when: 0.19 })
      break
    case 'radar':
      // Sonar ping with a low sweep and three decaying echoes.
      toneAt({ type: 'sine', freq: f(1050), duration: 0.9, gain: 0.055 })
      toneAt({ type: 'sine', freq: f(1050), duration: 0.7, gain: 0.018, when: 0.18 })
      toneAt({ type: 'sine', freq: f(1050), duration: 0.5, gain: 0.008, when: 0.36 })
      toneAt({ type: 'sine', freq: f(180), freqEnd: f(120), duration: 0.6, gain: 0.012 })
      break

    /* ---------------------------------------------------------------- world */
    case 'bird':
      toneAt({ type: 'sine', freq: f(1900), freqEnd: f(2650), duration: 0.075, gain: 0.03 })
      toneAt({ type: 'sine', freq: f(2350), freqEnd: f(3100), duration: 0.065, gain: 0.024, when: 0.09 })
      break
    case 'dog':
      toneAt({ type: 'sawtooth', freq: f(285), freqEnd: f(115), duration: 0.12, gain: 0.06, lowpass: 1000 })
      toneAt({ type: 'sawtooth', freq: f(320), freqEnd: f(125), duration: 0.11, gain: 0.05, lowpass: 1000, when: 0.22 })
      break
    case 'cat':
      toneAt({ type: 'triangle', freq: f(540), freqEnd: f(860), duration: 0.12, gain: 0.035 })
      toneAt({ type: 'triangle', freq: f(860), freqEnd: f(470), duration: 0.22, gain: 0.03, when: 0.12 })
      break
    case 'car':
      noiseAt({ duration: 0.7, gain: 0.03, type: 'bandpass', freq: 220, freqEnd: 950, q: 0.7 })
      noiseAt({ duration: 0.5, gain: 0.022, type: 'bandpass', freq: 900, freqEnd: 170, q: 0.7, when: 0.36 })
      toneAt({ type: 'sawtooth', freq: f(68), freqEnd: f(84), duration: 0.8, gain: 0.012, lowpass: 420 })
      break
    case 'bridge':
      toneAt({ type: 'sawtooth', freq: f(115), freqEnd: f(82), duration: 0.4, gain: 0.025, lowpass: 650 })
      noiseAt({ duration: 0.34, gain: 0.03, type: 'lowpass', freq: 430 })
      toneAt({ type: 'square', freq: f(170), duration: 0.05, gain: 0.035, lowpass: 800, when: 0.04 })
      break
    case 'house':
      playSfx('door', options)
      playSfx('whoosh', { ...options, volume: vol * 0.7 })
      break
    case 'uploadOpen':
      noiseAt({ duration: 0.3, gain: 0.06, type: 'bandpass', freq: 380, freqEnd: 1750, q: 0.7 })
      break
    case 'uploadClose':
      noiseAt({ duration: 0.28, gain: 0.055, type: 'bandpass', freq: 1750, freqEnd: 360, q: 0.7 })
      break
    case 'uploadDone':
      playSfx('uiSuccess', options)
      break
    case 'uploadError':
      playSfx('uiError', options)
      break
  }
}

/** Short, deep boom for the bomb explosion. */
export function playBoom() {
  playSfx('boom')
}

/** Metal part crashing onto the floor: a short, bright clang, louder for harder hits. */
export function playClank(speed: number) {
  playSfx('clank', { volume: Math.min(1, Math.max(0.15, speed / 35)) })
}

/** Victory fanfare when the bomb is defused. */
export function playFanfare() {
  playSfx('fanfare')
}
