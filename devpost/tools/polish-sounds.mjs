// Polish pass sounds (polish-pass.md "Sound"), generated in code, no dependencies:
//   node devpost/tools/polish-sounds.mjs
// Writes 44.1 kHz 16-bit mono WAVs (mono, so the spatial AudioComponents place them) to
// Assets/GeneratedSFX/. The finale's one warm chord, A major, one note from each object:
//   FinaleRoot.wav   A3, from the record player
//   FinaleThird.wav  C#4, from the camera
//   FinaleFifth.wav  E4, from the lamp
import {writeFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const SR = 44100
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../Assets/GeneratedSFX")

function lowpass(x, fc) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR)
  let y = 0
  return x.map((v) => (y += a * (v - y)))
}

function normalize(x, peak) {
  let m = 0
  for (const v of x) m = Math.max(m, Math.abs(v))
  return m > 0 ? x.map((v) => (v / m) * peak) : x
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

// One note: a soft swell into a long gentle decay. A slightly detuned second voice gives it a slow
// beat, a quiet octave and twelfth give it body, and a low-pass keeps it warm rather than bright.
function note(f) {
  const dur = 3.8
  const n = Math.round(dur * SR)
  const x = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const att = 1 - Math.exp(-t / 0.16)
    const rel = Math.exp(-t / 1.25)
    const end = Math.min(1, (dur - t) / 0.25)
    const w = 2 * Math.PI * f * t
    const voice = Math.sin(w) + 0.6 * Math.sin(2 * Math.PI * (f + 0.45) * t) + 0.2 * Math.sin(2 * w) + 0.06 * Math.sin(3 * w)
    x[i] = att * rel * end * voice
  }
  return normalize(lowpass(x, 2200), 0.34)
}

writeWav("FinaleRoot.wav", note(220))
writeWav("FinaleThird.wav", note(277.18))
writeWav("FinaleFifth.wav", note(329.63))
