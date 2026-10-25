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

const SOUND_NAMES: ReadonlySet<string> = new Set<SoundName>([
  'uiClick',
  'uiHover',
  'uiToggle',
  'uiSuccess',
  'uiError',
  'pageFlip',
  'whoosh',
  'whooshBack',
  'cloud',
  'launch',
  'distantBoom',
  'copy',
  'arm',
  'select',
  'back',
  'hoverModule',
  'tick',
  'tickUrgent',
  'send',
  'correct',
  'wrong',
  'strike',
  'boom',
  'clank',
  'fanfare',
  'testDone',
  'door',
  'pickup',
  'putdown',
  'snip',
  'fuse',
  'switch',
  'ratchet',
  'plug',
  'servo',
  'dial',
  'key',
  'buttonPress',
  'slide',
  'radar',
  'bird',
  'dog',
  'cat',
  'car',
  'bridge',
  'house',
  'uploadOpen',
  'uploadClose',
  'uploadDone',
  'uploadError',
])

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
      noiseAt({ duration: 0.22, gain: 0.05, type: 'bandpass', freq: 1050, freqEnd: 3400, q: 0.7 })
      noiseAt({ duration: 0.16, gain: 0.026, type: 'highpass', freq: 2200, freqEnd: 900, when: 0.07 })
      break
    case 'whoosh':
      noiseAt({ duration: 0.42, gain: 0.09, type: 'bandpass', freq: 280, freqEnd: 2200, q: 0.6 })
      break
    case 'whooshBack':
      noiseAt({ duration: 0.38, gain: 0.08, type: 'bandpass', freq: 2200, freqEnd: 260, q: 0.6 })
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
      ;[440, 554, 659].forEach((hz, i) =>
        toneAt({ type: 'square', freq: f(hz), duration: 0.07, gain: 0.04, lowpass: 2200, when: i * 0.11 }),
      )
      noiseAt({ duration: 0.03, gain: 0.05, type: 'highpass', freq: 2400, when: 0.34 })
      break
    case 'select':
      toneAt({ type: 'sine', freq: f(640), freqEnd: f(980), duration: 0.12, gain: 0.035 })
      noiseAt({ duration: 0.25, gain: 0.055, type: 'bandpass', freq: 480, freqEnd: 1900, q: 0.7 })
      break
    case 'back':
      toneAt({ type: 'sine', freq: f(760), freqEnd: f(340), duration: 0.14, gain: 0.035 })
      noiseAt({ duration: 0.27, gain: 0.055, type: 'bandpass', freq: 1900, freqEnd: 420, q: 0.7 })
      break
    case 'hoverModule':
      toneAt({ type: 'sine', freq: f(920), freqEnd: f(1080), duration: 0.03, gain: 0.017 })
      break
    case 'tick':
      noiseAt({ duration: 0.022, gain: 0.03, type: 'highpass', freq: 2800 })
      toneAt({ type: 'sine', freq: f(1550), duration: 0.018, gain: 0.015 })
      break
    case 'tickUrgent':
      toneAt({ type: 'sine', freq: f(1320), duration: 0.055, gain: 0.06 })
      toneAt({ type: 'sine', freq: f(990), duration: 0.05, gain: 0.035, when: 0.08 })
      break
    case 'send':
      toneAt({ type: 'square', freq: f(880), freqEnd: f(1400), duration: 0.07, gain: 0.045, lowpass: 4200 })
      toneAt({ type: 'sine', freq: f(1760), duration: 0.05, gain: 0.03, when: 0.055 })
      noiseAt({ duration: 0.03, gain: 0.025, type: 'highpass', freq: 2600 })
      break
    case 'correct':
      ;[523.25, 659.25, 783.99, 1046.5].forEach((hz, i) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: i === 3 ? 0.24 : 0.13, gain: 0.075, when: i * 0.085 }),
      )
      break
    case 'wrong':
      toneAt({ type: 'sawtooth', freq: f(220), duration: 0.25, gain: 0.05, lowpass: 900 })
      toneAt({ type: 'sawtooth', freq: f(233), duration: 0.25, gain: 0.045, lowpass: 900 })
      toneAt({ type: 'square', freq: f(110), duration: 0.18, gain: 0.035, when: 0.03 })
      break
    case 'strike':
      ;[0, 0.22, 0.44].forEach((when) => {
        toneAt({ type: 'square', freq: f(880), duration: 0.1, gain: 0.06, lowpass: 3000, when })
        toneAt({ type: 'square', freq: f(620), duration: 0.1, gain: 0.05, lowpass: 3000, when: when + 0.11 })
      })
      break
    case 'boom': {
      noiseAt({ duration: 2.2, gain: 0.42, type: 'lowpass', freq: 1800, freqEnd: 120, q: 0.5, attack: 0.004 })
      noiseAt({ duration: 0.4, gain: 0.1, type: 'highpass', freq: 1600, freqEnd: 260, q: 0.6 })
      toneAt({ type: 'sine', freq: f(115), freqEnd: f(28), duration: 0.9, gain: 0.28 })
      toneAt({ type: 'sine', freq: f(55), freqEnd: f(24), duration: 1.3, gain: 0.16 })
      break
    }
    case 'clank': {
      const base = f(300 + Math.random() * 500)
      for (const ratio of [1, 2.76, 5.4]) {
        toneAt({ type: 'triangle', freq: base * ratio, duration: 0.3, gain: 0.055 })
      }
      noiseAt({ duration: 0.05, gain: 0.04, type: 'highpass', freq: 2600 })
      break
    }
    case 'fanfare': {
      ;[523.25, 659.25, 783.99, 1046.5].forEach((hz, i) =>
        toneAt({ type: 'square', freq: f(hz), duration: 0.18, gain: 0.06, lowpass: 5000, when: i * 0.11 }),
      )
      ;[523.25, 659.25, 783.99, 1046.5].forEach((hz) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: 1.35, gain: 0.04, when: 0.5 }),
      )
      toneAt({ type: 'sine', freq: f(261.63), duration: 1.35, gain: 0.055, when: 0.5 })
      break
    }
    case 'testDone':
      ;[440, 554.37, 659.25].forEach((hz, i) =>
        toneAt({ type: 'triangle', freq: f(hz), duration: i === 2 ? 0.28 : 0.13, gain: 0.06, when: i * 0.09 }),
      )
      break
    case 'door':
      toneAt({ type: 'sawtooth', freq: f(135), freqEnd: f(72), duration: 0.35, gain: 0.045, lowpass: 600 })
      noiseAt({ duration: 0.3, gain: 0.035, type: 'lowpass', freq: 520 })
      toneAt({ type: 'sine', freq: f(92), freqEnd: f(46), duration: 0.22, gain: 0.07, when: 0.24 })
      break
    case 'pickup':
      noiseAt({ duration: 0.2, gain: 0.04, type: 'bandpass', freq: 500, freqEnd: 1700, q: 0.7 })
      toneAt({ type: 'sine', freq: f(420), freqEnd: f(700), duration: 0.12, gain: 0.035 })
      break
    case 'putdown':
      noiseAt({ duration: 0.18, gain: 0.035, type: 'bandpass', freq: 1700, freqEnd: 420, q: 0.7 })
      toneAt({ type: 'sine', freq: f(110), freqEnd: f(55), duration: 0.18, gain: 0.06 })
      break

    /* -------------------------------------------------------------- modules */
    case 'snip':
      noiseAt({ duration: 0.032, gain: 0.075, type: 'highpass', freq: 2300 })
      noiseAt({ duration: 0.03, gain: 0.06, type: 'highpass', freq: 3100, when: 0.045 })
      toneAt({ type: 'triangle', freq: f(2300), freqEnd: f(840), duration: 0.09, gain: 0.05 })
      break
    case 'fuse':
      noiseAt({ duration: 0.022, gain: 0.045, type: 'highpass', freq: 1900 })
      toneAt({ type: 'triangle', freq: f(430), freqEnd: f(300), duration: 0.05, gain: 0.05 })
      break
    case 'switch':
      noiseAt({ duration: 0.024, gain: 0.06, type: 'lowpass', freq: 950 })
      toneAt({ type: 'square', freq: f(170), duration: 0.035, gain: 0.035, lowpass: 900 })
      break
    case 'ratchet':
      toneAt({ type: 'square', freq: f(1250), duration: 0.022, gain: 0.035, lowpass: 4200 })
      noiseAt({ duration: 0.018, gain: 0.035, type: 'highpass', freq: 2600 })
      break
    case 'plug':
      toneAt({ type: 'sine', freq: f(520), freqEnd: f(175), duration: 0.07, gain: 0.06 })
      noiseAt({ duration: 0.035, gain: 0.04, type: 'lowpass', freq: 900 })
      break
    case 'servo':
      toneAt({ type: 'sawtooth', freq: f(110), freqEnd: f(195), duration: 0.22, gain: 0.03, lowpass: 1300 })
      noiseAt({ duration: 0.18, gain: 0.025, type: 'bandpass', freq: 520, q: 1.1 })
      break
    case 'dial':
      toneAt({ type: 'square', freq: f(1600), duration: 0.02, gain: 0.03, lowpass: 4800 })
      noiseAt({ duration: 0.014, gain: 0.026, type: 'highpass', freq: 3200 })
      break
    case 'key':
      noiseAt({ duration: 0.018, gain: 0.032, type: 'highpass', freq: 2500 })
      toneAt({ type: 'triangle', freq: f(1120), duration: 0.02, gain: 0.022 })
      break
    case 'buttonPress':
      toneAt({ type: 'square', freq: f(500), duration: 0.08, gain: 0.042, lowpass: 2600 })
      toneAt({ type: 'sine', freq: f(1000), duration: 0.035, gain: 0.022 })
      break
    case 'slide':
      noiseAt({ duration: 0.18, gain: 0.04, type: 'bandpass', freq: 500, freqEnd: 1700, q: 0.8 })
      noiseAt({ duration: 0.15, gain: 0.025, type: 'bandpass', freq: 1700, freqEnd: 480, when: 0.06 })
      break
    case 'radar':
      toneAt({ type: 'sine', freq: f(1050), duration: 0.8, gain: 0.055 })
      toneAt({ type: 'sine', freq: f(1050), duration: 0.68, gain: 0.022, when: 0.18 })
      toneAt({ type: 'sine', freq: f(1050), duration: 0.55, gain: 0.01, when: 0.36 })
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
