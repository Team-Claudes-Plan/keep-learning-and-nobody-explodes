// Generative background music: a slow, warm chord progression with a soft
// bass, sparse plucks and the occasional bell. It is scheduled against the
// AudioContext clock and never restarts on navigation — only the mix is ducked
// (e.g. on the sound test page), so the piece keeps flowing.

import { getAudioContext, getMasterBus, isAudioUnlocked, noiseBurst, tone } from './engine'

type Chord = {
  name: string
  /** Root, one octave below the pad. */
  bass: number
  /** Pad/arp notes in Hz. */
  notes: number[]
}

const CHORDS: Chord[] = [
  { name: 'Dmaj9', bass: 73.42, notes: [146.83, 185.0, 220.0, 277.18, 329.63] },
  { name: 'Bm9', bass: 61.74, notes: [146.83, 185.0, 220.0, 246.94, 293.66] },
  { name: 'Gmaj9', bass: 49.0, notes: [123.47, 146.83, 185.0, 220.0, 246.94] },
  { name: 'A7sus4', bass: 55.0, notes: [146.83, 164.81, 196.0, 220.0, 293.66] },
]

/** Sparkling high notes that fit the progression. */
const BELLS = [1046.5, 1174.66, 1318.51, 1567.98, 1760.0]

const CHORD_SECONDS = 12
const LOOKAHEAD_SECONDS = 1.6
const MUSIC_LEVEL = 0.36

let started = false
let ducked = false
let bus: GainNode | null = null
let context: AudioContext | null = null
let timer: number | null = null
let nextChordAt = 0
let chordIndex = 0

function ensureBus(): GainNode | null {
  if (bus && bus.context === context) return bus
  const ctx = getAudioContext()
  const master = getMasterBus()
  if (!ctx || !master) return null
  context = ctx
  bus ??= (() => {
    const node = ctx.createGain()
    node.gain.value = ducked ? 0.0001 : MUSIC_LEVEL
    node.connect(master)
    return node
  })()
  return bus
}

function maybeBell(delay: number, index: number) {
  if (index % 2 !== 0 || !bus) return
  const output = bus
  const when = delay + 3 + Math.random() * 6
  const freq = BELLS[Math.floor(Math.random() * BELLS.length)]
  tone({
    type: 'sine',
    freq,
    duration: 4.2,
    gain: 0.0065,
    attack: 0.02,
    bus: output,
    when,
    pan: Math.random() * 0.8 - 0.4,
  })
  // a quiet fifth above, like a small glass chime
  tone({
    type: 'sine',
    freq: freq * 1.5,
    duration: 3.2,
    gain: 0.0028,
    attack: 0.03,
    bus: output,
    when: when + 0.06,
    pan: Math.random() * 0.8 - 0.4,
  })
}

function scheduleChord(delay: number, index: number) {
  if (!bus) return
  const output = bus
  const chord = CHORDS[index % CHORDS.length]

  // Warm pad: every note doubled and slightly detuned, with a long, soft envelope.
  chord.notes.forEach((freq, noteIndex) => {
    for (const [detune, pan] of [
      [-5, -0.22],
      [5, 0.22],
    ]) {
      tone({
        type: noteIndex % 2 === 0 ? 'triangle' : 'sine',
        freq,
        duration: 13.6,
        gain: 0.017,
        attack: 3.4,
        detune,
        lowpass: 1500,
        bus: output,
        when: delay,
        pan,
      })
    }
  })

  // Root and a soft octave: the floor of the piece.
  tone({
    type: 'sine',
    freq: chord.bass,
    duration: 10.8,
    gain: 0.06,
    attack: 1.4,
    bus: output,
    when: delay,
  })
  tone({
    type: 'triangle',
    freq: chord.bass * 2,
    duration: 8.4,
    gain: 0.012,
    attack: 1.8,
    lowpass: 700,
    bus: output,
    when: delay + 0.04,
  })

  // Sparse plucks from the chord, with a soft echo.
  const plucks = 1 + (Math.random() < 0.55 ? 1 : 0) + (Math.random() < 0.25 ? 1 : 0)
  for (let i = 0; i < plucks; i++) {
    const freq = chord.notes[Math.floor(Math.random() * chord.notes.length)] * 2
    const when = delay + 0.6 + Math.random() * (CHORD_SECONDS - 2.6)
    const gain = 0.018 + Math.random() * 0.012
    const pan = Math.random() * 0.7 - 0.35
    tone({
      type: 'triangle',
      freq,
      duration: 0.8 + Math.random() * 0.6,
      gain,
      attack: 0.008,
      lowpass: 2600,
      bus: output,
      when,
      pan,
    })
    tone({
      type: 'sine',
      freq,
      duration: 0.9,
      gain: gain * 0.28,
      attack: 0.01,
      bus: output,
      when: when + 0.42,
      pan: -pan,
    })
    tone({
      type: 'sine',
      freq,
      duration: 0.8,
      gain: gain * 0.11,
      attack: 0.02,
      bus: output,
      when: when + 0.84,
      pan,
    })
  }

  // Airy movement every third chord.
  if (index % 3 === 0) {
    noiseBurst({
      duration: 7,
      gain: 0.007,
      type: 'lowpass',
      freq: 280,
      freqEnd: 520,
      q: 0.6,
      attack: 3.2,
      bus: output,
      when: delay,
    })
  }

  maybeBell(delay, index)
}

function tick() {
  const ctx = context
  if (!ctx || !bus) return
  if (ctx.state === 'suspended') return
  // The tab was asleep: do not dump a pile of overdue chords at once.
  if (nextChordAt < ctx.currentTime - 2) nextChordAt = ctx.currentTime + 0.4
  while (nextChordAt < ctx.currentTime + LOOKAHEAD_SECONDS) {
    scheduleChord(Math.max(0, nextChordAt - ctx.currentTime), chordIndex)
    chordIndex++
    nextChordAt += CHORD_SECONDS
  }
}

/** Starts the continuous piece once, after the first user gesture. */
export function startMusic() {
  if (started || !isAudioUnlocked()) return
  const ctx = getAudioContext()
  const musicBus = ensureBus()
  if (!ctx || !musicBus) return
  started = true
  context = ctx
  musicBus.gain.cancelScheduledValues(ctx.currentTime)
  musicBus.gain.setValueAtTime(0.0001, ctx.currentTime)
  musicBus.gain.exponentialRampToValueAtTime(ducked ? 0.0001 : MUSIC_LEVEL, ctx.currentTime + 3.5)
  nextChordAt = ctx.currentTime + 0.5
  tick()
  timer = window.setInterval(tick, 500)
}

/** Fades the music under other audio (e.g. while auditioning effects). */
export function setMusicDucked(value: boolean) {
  ducked = value
  if (!bus || !context) return
  bus.gain.cancelScheduledValues(context.currentTime)
  bus.gain.setTargetAtTime(value ? 0.0001 : MUSIC_LEVEL, context.currentTime, 0.45)
}

/** For diagnostics: whether the scheduler is running. */
export function isMusicRunning() {
  return started && timer !== null
}

export const MUSIC_CHORDS = CHORDS.map((chord) => chord.name)
