/**
 * Record player hero: the tone from the real speaker, synthesized live (recordplayer-hero.md §3).
 *
 * An Audio Output track (AudioOutputProvider) on a spatial AudioComponent at the speaker marker:
 * every frame the lens enqueues as many samples as the output asks for. The tone is a warm sine
 * with a few soft harmonics, the same shape the groove, the signal and the cone draw
 * (RP_TONE_SHAPE). Frequency and gain glide per sample (no clicks), and the phase is continuous
 * across frames and frequency changes.
 */

export const RP_SAMPLE_RATE = 44100
const HIST_N = 8192

/** The tone's harmonics: [multiple, amplitude, phase]. The groove, signal and cone draw this same shape. */
const HARMONICS: [number, number, number][] = [
  [1, 1, 0],
  [2, 0.32, 0.9],
  [3, 0.12, 0.4],
  [4, 0.04, 1.3]
]
const NORM = HARMONICS.reduce((s, h) => s + h[1], 0) * 0.82

/** One period of the tone's shape (period 2π, peak about ±1). */
export function rpToneShape(x: number): number {
  let v = 0
  for (const [m, a, p] of HARMONICS) v += a * Math.sin(m * x + p)
  return v / NORM
}

/** Loudness 0..1 → linear gain: a perceptual curve from silence through quiet to comfortable. */
export function loudnessGain(l: number): number {
  const k = Math.max(0, Math.min(1, l))
  return 0.32 * Math.pow(k, 1.7)
}

export class RpTone {
  private provider: AudioOutputProvider | null = null
  private phase = 0
  private f = 440
  private g = 0
  private targetF = 440
  private targetG = 0
  private on = false
  /** Frames the output asked for (and got), and samples written: proof the output pulls audio. */
  private frames = 0
  private samples = 0
  private lastAsk = 0
  private lastBuf: Float32Array | null = null
  /** The most recent output samples, oldest first once full (tests measure the played frequency). */
  private hist = new Float32Array(HIST_N)
  private histAt = 0
  private histCount = 0
  readonly ok: boolean
  readonly why: string

  constructor(
    private audio: AudioComponent | null,
    track: AudioTrackAsset | null
  ) {
    let why = ""
    try {
      if (!audio || !track) throw new Error("tone audio or Audio Output track not wired")
      this.provider = track.control as AudioOutputProvider
      if (!this.provider || typeof this.provider.enqueueAudioFrame !== "function") throw new Error("the track is not an Audio Output")
      this.provider.sampleRate = RP_SAMPLE_RATE
      audio.audioTrack = track
    } catch (e) {
      this.provider = null
      why = "" + e
    }
    this.ok = !!this.provider
    this.why = why
  }

  /** Start the output (silent until a gain is set). */
  start(): void {
    if (!this.provider || !this.audio || this.on) return
    this.on = true
    this.phase = 0
    this.g = 0
    this.histCount = 0
    if (!this.audio.isPlaying()) this.audio.play(-1)
  }

  /** Stop the output at once (call after the gain has faded). */
  stop(): void {
    if (!this.audio) return
    this.on = false
    this.g = 0
    this.targetG = 0
    if (this.audio.isPlaying()) this.audio.stop(false)
  }

  set(freq: number, gain: number): void {
    this.targetF = freq
    this.targetG = Math.max(0, gain)
  }

  get isOn(): boolean {
    return this.on && !!this.audio && this.audio.isPlaying()
  }

  /** Current (glided) frequency and gain, and the targets. */
  getState(): {freq: number; gain: number; targetFreq: number; targetGain: number; playing: boolean; frames: number; samples: number; lastAsk: number} {
    return {freq: this.f, gain: this.g, targetFreq: this.targetF, targetGain: this.targetG, playing: this.isOn, frames: this.frames, samples: this.samples, lastAsk: this.lastAsk}
  }

  /** Where the sound comes from: the spatial audio source's world position. */
  position(): vec3 | null {
    return this.audio ? this.audio.getSceneObject().getTransform().getWorldPosition() : null
  }

  /** The last `n` samples sent to the output, in order (at most 8192). */
  getRecent(n: number): Float32Array {
    const m = Math.min(n, this.histCount)
    const out = new Float32Array(m)
    for (let i = 0; i < m; i++) out[i] = this.hist[(this.histAt - m + i + HIST_N * 2) % HIST_N]
    return out
  }

  /** The last block of samples sent to the output (tests measure its frequency). */
  getLastBlock(): Float32Array | null {
    return this.lastBuf
  }

  /** Per frame: fill what the output asks for. */
  update(): void {
    if (!this.provider || !this.on) return
    let n = 0
    try {
      n = this.provider.getPreferredFrameSize()
    } catch (e) {
      n = 0
    }
    this.lastAsk = n
    if (!(n > 0)) return
    const buf = new Float32Array(n)
    // Glide over ~20 ms (frequency) and ~30 ms (gain): one-pole smoothing per sample.
    const kf = 1 - Math.exp(-1 / (0.02 * RP_SAMPLE_RATE))
    const kg = 1 - Math.exp(-1 / (0.03 * RP_SAMPLE_RATE))
    const tau = Math.PI * 2
    for (let i = 0; i < n; i++) {
      this.f += (this.targetF - this.f) * kf
      this.g += (this.targetG - this.g) * kg
      this.phase += (tau * this.f) / RP_SAMPLE_RATE
      if (this.phase > tau) this.phase -= tau
      buf[i] = this.g * rpToneShape(this.phase)
      this.hist[this.histAt] = buf[i]
      this.histAt = (this.histAt + 1) % HIST_N
    }
    this.histCount = Math.min(HIST_N, this.histCount + n)
    this.provider.enqueueAudioFrame(buf, new vec3(n, 1, 1))
    this.frames++
    this.samples += n
    this.lastBuf = buf
  }
}
