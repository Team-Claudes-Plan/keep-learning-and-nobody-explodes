/** A short, deep boom, made on the fly (no audio file needed). */
export function playBoom() {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const seconds = 2.2
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      const t = i / ctx.sampleRate
      // noise with a sharp attack and a long tail
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3) * (t < 0.01 ? t / 0.01 : 1)
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    const lowpass = ctx.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.setValueAtTime(1800, ctx.currentTime)
    lowpass.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 1.2)
    const gain = ctx.createGain()
    gain.gain.value = 0.9
    // a falling sine underneath for the thump
    const thump = ctx.createOscillator()
    thump.frequency.setValueAtTime(110, ctx.currentTime)
    thump.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.6)
    const thumpGain = ctx.createGain()
    thumpGain.gain.setValueAtTime(0.9, ctx.currentTime)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    noise.connect(lowpass).connect(gain).connect(ctx.destination)
    thump.connect(thumpGain).connect(ctx.destination)
    noise.start()
    thump.start()
    thump.stop(ctx.currentTime + 0.8)
    noise.onended = () => void ctx.close()
  } catch {
    // no audio available: the explosion still shows
  }
}

let clankContext: AudioContext | null = null

/** Metal part crashing onto the floor: a short, bright clang, louder for harder hits. */
export function playClank(speed: number) {
  try {
    clankContext ??= new AudioContext()
    const ctx = clankContext
    const now = ctx.currentTime
    const volume = Math.min(0.5, speed / 30)
    const out = ctx.createGain()
    out.gain.setValueAtTime(volume, now)
    out.gain.exponentialRampToValueAtTime(0.001, now + 0.35)
    out.connect(ctx.destination)
    // a few inharmonic partials make it sound like sheet metal
    const base = 300 + Math.random() * 500
    for (const ratio of [1, 2.76, 5.4]) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = base * ratio
      osc.connect(out)
      osc.start(now)
      osc.stop(now + 0.35)
    }
  } catch {
    // no audio available
  }
}

/** Victory fanfare: a quick rising arpeggio and a held major chord, made on the fly. */
export function playFanfare() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = 0.22
    out.connect(ctx.destination)
    const note = (freq: number, start: number, length: number) => {
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = freq
      const env = ctx.createGain()
      env.gain.setValueAtTime(0, now + start)
      env.gain.linearRampToValueAtTime(1, now + start + 0.02)
      env.gain.exponentialRampToValueAtTime(0.001, now + start + length)
      osc.connect(env).connect(out)
      osc.start(now + start)
      osc.stop(now + start + length + 0.05)
    }
    // C E G C', then a C major chord held
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.11, 0.18))
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f) => note(f, 0.5, 1.2))
    setTimeout(() => void ctx.close(), 2200)
  } catch {
    // no audio available
  }
}
