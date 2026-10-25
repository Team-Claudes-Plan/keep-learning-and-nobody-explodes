// Central Web Audio engine: one AudioContext, one master bus and a small
// library of helpers that synthesise every sound effect on the fly. Keeping
// the context around (instead of creating one per sound) avoids the browser's
// limit for audio contexts and makes the mute switch instantaneous.

const STORAGE_KEY = 'keep-learning.audio.muted'
const MASTER_VOLUME = 0.62

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noise: AudioBuffer | null = null
let muted = readMuted()
/** Set by the first real pointer/keyboard gesture; one-shots are silent before that. */
let unlocked = false
const listeners = new Set<() => void>()

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function storeMuted(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    // private mode / storage disabled: the setting only lasts for this visit
  }
}

/** Current mute state, also used by the settings toggle. */
export function isMuted() {
  return muted
}

export function subscribeMuted(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setMuted(value: boolean) {
  if (muted === value) return
  muted = value
  storeMuted(value)
  if (ctx && master) master.gain.setTargetAtTime(value ? 0 : MASTER_VOLUME, ctx.currentTime, 0.015)
  for (const listener of listeners) listener()
}

export function toggleMuted() {
  setMuted(!muted)
  return muted
}

/**
 * Lazily creates the context (browsers only allow it after a user gesture)
 * and resumes it when the tab was suspended. Returns null when Web Audio is
 * unavailable, in which case the game simply stays silent.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return null
    try {
      ctx = new AudioCtx()
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = -18
      compressor.knee.value = 18
      compressor.ratio.value = 6
      compressor.attack.value = 0.003
      compressor.release.value = 0.24
      master = ctx.createGain()
      master.gain.value = muted ? 0 : MASTER_VOLUME
      master.connect(compressor).connect(ctx.destination)
    } catch {
      ctx = null
      master = null
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Call once on the first pointer/keyboard gesture so the context is allowed to play. */
export function unlockAudio() {
  unlocked = true
  getAudioContext()
}

/** Whether a user gesture has allowed audio yet. */
export function isAudioUnlocked() {
  return unlocked
}

/** Master output, for sub-mixes such as the procedural music. */
export function getMasterBus(): GainNode | null {
  getAudioContext()
  return master
}

/** Shared two second noise buffer; every noise sound reads from it. */
export function noiseBuffer(context: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === context.sampleRate) return noise
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noise = buffer
  return buffer
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

type OutputOptions = {
  gain: number
  pan?: number
  /** Optional sub-mix (e.g. the music bus) instead of the master output. */
  bus?: AudioNode
}

/** Gain node (already scheduled) into the master bus, optionally panned. */
function output(context: AudioContext, options: OutputOptions) {
  const gain = context.createGain()
  let tail: AudioNode = gain
  if (options.pan && context.createStereoPanner) {
    const panner = context.createStereoPanner()
    panner.pan.value = clamp(options.pan, -1, 1)
    gain.connect(panner)
    tail = panner
  }
  tail.connect(options.bus ?? master!)
  return gain
}

export type ToneOptions = {
  type?: OscillatorType
  /** Start frequency in Hz. */
  freq: number
  /** Glide to this frequency over the duration. */
  freqEnd?: number
  duration: number
  gain?: number
  attack?: number
  release?: number
  /** Delay relative to now, in seconds. */
  when?: number
  pan?: number
  /** Optional low-pass that softens harsh waveforms. */
  lowpass?: number
  detune?: number
  /** Optional sub-mix (e.g. the music bus) instead of the master output. */
  bus?: AudioNode
}

export function tone(options: ToneOptions) {
  const context = getAudioContext()
  if (!context) return
  const now = context.currentTime + (options.when ?? 0)
  const duration = Math.max(0.02, options.duration)
  const gain = output(context, { gain: options.gain ?? 0.14, pan: options.pan, bus: options.bus })
  const peak = Math.max(0.0002, options.gain ?? 0.14)
  const attack = Math.max(0.002, options.attack ?? 0.006)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  const osc = context.createOscillator()
  osc.type = options.type ?? 'sine'
  osc.frequency.setValueAtTime(Math.max(1, options.freq), now)
  if (options.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.freqEnd), now + duration)
  }
  if (options.detune) osc.detune.value = options.detune

  let head: AudioNode = osc
  if (options.lowpass) {
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = options.lowpass
    filter.Q.value = 0.7
    osc.connect(filter)
    head = filter
  }
  head.connect(gain)
  osc.start(now)
  osc.stop(now + duration + 0.04)
}

export type NoiseOptions = {
  duration: number
  gain?: number
  type?: BiquadFilterType
  freq?: number
  freqEnd?: number
  q?: number
  attack?: number
  when?: number
  pan?: number
  /** Playback rate, e.g. 1.5 for a brighter hiss. */
  rate?: number
  /** Optional sub-mix (e.g. the music bus) instead of the master output. */
  bus?: AudioNode
}

export function noiseBurst(options: NoiseOptions) {
  const context = getAudioContext()
  if (!context) return
  const now = context.currentTime + (options.when ?? 0)
  const duration = Math.max(0.02, options.duration)
  const peak = Math.max(0.0002, options.gain ?? 0.12)
  const gain = output(context, { gain: peak, pan: options.pan, bus: options.bus })
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(peak, now + Math.max(0.002, options.attack ?? 0.004))
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context)
  source.loop = true
  source.playbackRate.value = options.rate ?? 1

  const filter = context.createBiquadFilter()
  filter.type = options.type ?? 'bandpass'
  filter.Q.value = options.q ?? 0.9
  const start = Math.max(20, options.freq ?? 900)
  filter.frequency.setValueAtTime(start, now)
  if (options.freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.freqEnd), now + duration)
  }

  source.connect(filter).connect(gain)
  source.start(now)
  source.stop(now + duration + 0.04)
}

/* ------------------------------------------------------------------ ambience */

export type AmbienceKind = 'islands' | 'house' | 'room' | 'bomb' | 'book'

type Ambience = {
  kind: AmbienceKind
  bus: GainNode
  nodes: AudioScheduledSourceNode[]
}

let ambience: Ambience | null = null

function ambienceBed(
  context: AudioContext,
  bus: GainNode,
  options: {
    gain: number
    type: BiquadFilterType
    freq: number
    q?: number
    lfoRate?: number
    lfoDepth?: number
    rate?: number
  },
) {
  const source = context.createBufferSource()
  source.buffer = noiseBuffer(context)
  source.loop = true
  source.playbackRate.value = options.rate ?? 1

  const filter = context.createBiquadFilter()
  filter.type = options.type
  filter.frequency.value = options.freq
  filter.Q.value = options.q ?? 0.7

  const gain = context.createGain()
  gain.gain.value = options.gain

  source.connect(filter).connect(gain).connect(bus)

  const nodes: AudioScheduledSourceNode[] = [source]
  if (options.lfoRate && options.lfoDepth) {
    const lfo = context.createOscillator()
    lfo.frequency.value = options.lfoRate
    const depth = context.createGain()
    depth.gain.value = options.lfoDepth
    lfo.connect(depth).connect(filter.frequency)
    lfo.start()
    nodes.push(lfo)
  }
  source.start()
  return nodes
}

function drone(context: AudioContext, bus: GainNode, freq: number, gainValue: number, pulseRate = 0) {
  const osc = context.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const gain = context.createGain()
  gain.gain.value = gainValue
  osc.connect(gain).connect(bus)

  const nodes: AudioScheduledSourceNode[] = [osc]
  if (pulseRate > 0) {
    const lfo = context.createOscillator()
    lfo.frequency.value = pulseRate
    const depth = context.createGain()
    depth.gain.value = gainValue * 0.45
    lfo.connect(depth).connect(gain.gain)
    lfo.start()
    nodes.push(lfo)
  }
  osc.start()
  return nodes
}

/**
 * Starts a quiet procedural soundscape. Mounting the same kind twice is a
 * no-op, so React StrictMode's double effects do not stack layers.
 */
export function startAmbience(kind: AmbienceKind) {
  if (ambience?.kind === kind) return
  stopAmbience()
  const context = getAudioContext()
  if (!context || !master) return

  const bus = context.createGain()
  bus.gain.value = 0.0001
  bus.connect(master)
  bus.gain.exponentialRampToValueAtTime(0.9, context.currentTime + 1.6)

  let nodes: AudioScheduledSourceNode[] = []

  if (kind === 'islands') {
    nodes = nodes.concat(
      ambienceBed(context, bus, { gain: 0.05, type: 'lowpass', freq: 520, lfoRate: 0.07, lfoDepth: 190 }),
      ambienceBed(context, bus, { gain: 0.022, type: 'bandpass', freq: 1050, q: 0.8, lfoRate: 0.13, lfoDepth: 240 }),
    )
  } else if (kind === 'house') {
    nodes = nodes.concat(
      ambienceBed(context, bus, { gain: 0.032, type: 'lowpass', freq: 430, lfoRate: 0.09, lfoDepth: 130 }),
      ambienceBed(context, bus, { gain: 0.008, type: 'highpass', freq: 1900, lfoRate: 0.21, lfoDepth: 500 }),
    )
  } else if (kind === 'room') {
    nodes = nodes.concat(
      ambienceBed(context, bus, { gain: 0.024, type: 'lowpass', freq: 300, lfoRate: 0.05, lfoDepth: 70 }),
      drone(context, bus, 57, 0.0055),
      drone(context, bus, 114, 0.0025),
    )
  } else if (kind === 'bomb') {
    nodes = nodes.concat(
      drone(context, bus, 46, 0.016, 0.34),
      drone(context, bus, 92, 0.004, 0.17),
      ambienceBed(context, bus, { gain: 0.018, type: 'lowpass', freq: 380, lfoRate: 0.11, lfoDepth: 120 }),
    )
  } else {
    nodes = nodes.concat(
      drone(context, bus, 98, 0.0045),
      drone(context, bus, 147, 0.0032, 0.12),
      ambienceBed(context, bus, { gain: 0.01, type: 'bandpass', freq: 1600, q: 1.2, lfoRate: 0.17, lfoDepth: 380 }),
    )
  }

  ambience = { kind, bus, nodes }
}

export function stopAmbience(kind?: AmbienceKind) {
  const current = ambience
  if (!current || (kind && current.kind !== kind)) return
  ambience = null
  const context = ctx
  if (context) current.bus.gain.setTargetAtTime(0.0001, context.currentTime, 0.28)
  for (const node of current.nodes) {
    try {
      node.stop(context ? context.currentTime + 1.1 : 0)
    } catch {
      // already stopped
    }
  }
  window.setTimeout(() => {
    try {
      current.bus.disconnect()
    } catch {
      // already disconnected
    }
  }, 1400)
}
