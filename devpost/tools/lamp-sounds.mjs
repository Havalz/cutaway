// Lamp hero sounds (lamp-hero.md "Sound"), generated in code, no dependencies:
//   node devpost/tools/lamp-sounds.mjs
// Writes 44.1 kHz 16-bit mono WAVs (mono, so the spatial AudioComponents place them) to
// Assets/GeneratedSFX/:
//   LampSwitchClick.wav  a soft click at the foot switch (on and off)
//   LampBulbRise.wav     a gentle rising power-up tone at the bulb as it lights
//   LampRustle.wav       a faint paper rustle when the shade lifts and when it sets down
import {writeFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const SR = 44100
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../Assets/GeneratedSFX")

// A small deterministic PRNG (mulberry32), so the files are the same on every run.
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One-pole low-pass and high-pass, and a two-pole resonant band-pass (RBJ). */
function lowpass(x, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR)
  let y = 0
  return x.map((v) => (y += a * (v - y)))
}
function highpass(x, fc) {
  const lp = lowpass(x, fc)
  return x.map((v, i) => v - lp[i])
}
function bandpass(x, f0, q) {
  const w = (2 * Math.PI * f0) / SR
  const al = Math.sin(w) / (2 * q)
  const b0 = al, b2 = -al
  const a0 = 1 + al, a1 = -2 * Math.cos(w), a2 = 1 - al
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return x.map((v) => {
    const y = (b0 * v + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = v
    y2 = y1
    y1 = y
    return y
  })
}

function normalize(x, peak) {
  let m = 0
  for (const v of x) m = Math.max(m, Math.abs(v))
  return m > 0 ? x.map((v) => (v / m) * peak) : x
}

/** Short fades at both ends, so no file starts or stops with a click of its own. */
function edges(x, inMs = 1.5, outMs = 8) {
  const ni = Math.round((inMs / 1000) * SR)
  const no = Math.round((outMs / 1000) * SR)
  return x.map((v, i) => v * Math.min(1, i / Math.max(1, ni)) * Math.min(1, (x.length - 1 - i) / Math.max(1, no)))
}

function writeWav(name, x) {
  const n = x.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write("RIFF", 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write("WAVE", 8)
  buf.write("fmt ", 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write("data", 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2)
  writeFileSync(join(OUT, name), buf)
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  console.log(`${name}: ${(n / SR).toFixed(3)} s, peak ${peak.toFixed(3)}`)
}

// ---------------- The foot switch: a soft, small plastic click ----------------
// Two quick contacts 9 ms apart (the button's latch, then its seat): each a damped resonance of the
// small plastic housing (~2.4 kHz and ~1.1 kHz) over a breath of filtered noise. Soft, not sharp.
function switchClick() {
  const n = Math.round(0.11 * SR)
  const r = rng(7)
  const x = new Array(n).fill(0)
  const hit = (t0, amp, f1, f2, dec) => {
    const i0 = Math.round(t0 * SR)
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / SR
      const e = Math.exp(-t / dec)
      x[i] += amp * e * (0.65 * Math.sin(2 * Math.PI * f1 * t) + 0.35 * Math.sin(2 * Math.PI * f2 * t + 0.7))
    }
  }
  hit(0.002, 1, 2400, 1150, 0.006)
  hit(0.011, 0.55, 2150, 980, 0.009)
  const noise = new Array(n).fill(0).map((_, i) => (r() * 2 - 1) * Math.exp(-(i / SR) / 0.004))
  const nb = bandpass(noise, 3000, 0.9)
  for (let i = 0; i < n; i++) x[i] += 0.5 * nb[i]
  return edges(normalize(lowpass(x, 6500), 0.55), 0.6, 20)
}

// ---------------- The bulb: a gentle rising power-up tone ----------------
// A soft sine glides up a fifth (330 → 495 Hz) as the light comes up, with a quiet octave and a
// faint slow shimmer, a slow attack and a long gentle release. Warm, not a beep.
function bulbRise() {
  const dur = 1.25
  const n = Math.round(dur * SR)
  const x = new Array(n).fill(0)
  let ph = 0
  let ph2 = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const u = Math.min(1, t / 0.85)
    const glide = 0.5 - 0.5 * Math.cos(Math.PI * u)
    const f = 330 * Math.pow(1.5, glide)
    ph += (2 * Math.PI * f) / SR
    ph2 += (2 * Math.PI * f * 2.003) / SR
    const att = 1 - Math.exp(-t / 0.18)
    const rel = t < 0.75 ? 1 : Math.exp(-(t - 0.75) / 0.22)
    const shimmer = 1 + 0.06 * Math.sin(2 * Math.PI * 5.2 * t)
    x[i] = att * rel * shimmer * (Math.sin(ph) + 0.22 * Math.sin(ph2) + 0.06 * Math.sin(3 * ph))
  }
  return edges(normalize(lowpass(x, 3200), 0.42), 2, 40)
}

// ---------------- The shade: a faint paper rustle ----------------
// Paper crackles are many tiny, irregular grains of bright noise: grains at random times (denser in
// the middle), each a few ms of band-limited noise, under a soft swell. Quiet.
function rustle() {
  const dur = 0.55
  const n = Math.round(dur * SR)
  const r = rng(23)
  const noise = new Array(n).fill(0).map(() => r() * 2 - 1)
  const bright = bandpass(highpass(noise, 1500), 4200, 0.6)
  const body = bandpass(noise, 1800, 0.8)
  const grains = new Array(n).fill(0)
  let t = 0.01
  while (t < dur - 0.03) {
    const swell = Math.sin((Math.PI * t) / dur)
    const len = 0.002 + 0.007 * r()
    const amp = (0.25 + 0.75 * r()) * swell
    const i0 = Math.round(t * SR)
    const il = Math.round(len * SR)
    for (let i = 0; i < il && i0 + i < n; i++) grains[i0 + i] = Math.max(grains[i0 + i], amp * Math.sin((Math.PI * i) / il))
    t += 0.004 + 0.022 * r() * (1.2 - swell)
  }
  const x = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const s = Math.sin((Math.PI * i) / n)
    x[i] = grains[i] * (0.8 * bright[i] + 0.35 * body[i]) + 0.06 * s * bright[i]
  }
  return edges(normalize(lowpass(x, 9000), 0.3), 4, 40)
}

writeWav("LampSwitchClick.wav", switchClick())
writeWav("LampBulbRise.wav", bulbRise())
writeWav("LampRustle.wav", rustle())
