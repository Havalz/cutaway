#!/usr/bin/env node
/**
 * Procedural textures for the lamp model (lamp-hero.md design notes), written as PNGs into
 * Assets/Materials/. Deterministic (seeded), no dependencies: node devpost/tools/lamp-textures.mjs
 *
 * LampPaper.png (512 x 1024): fine rice-paper crinkle for the shade. u = angle round the shade (it
 *   wraps), v = height (0 at the bottom ring, 1 at the top). Many thin, irregular horizontal creases
 *   (a dark fold with a faint lit ridge on one side, wandering a few texels, fading in and out round
 *   the shade, most of them faint) over faint fibre variation. No broad bands: the only large-scale
 *   term is a very soft isotropic cloudiness of about 1.5%.
 * LampBrushed.png (1024 x 128): fine brushed steel. The grain runs along v and varies along u (it
 *   wraps): on the base (u = angle, v = radius) it reads as fine radial brushing, on the stem as
 *   lengthwise brushing; the rings and collar swap their UVs so it runs round them.
 */
import {writeFileSync} from "node:fs"
import {deflateSync} from "node:zlib"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Assets", "Materials")

// ------------------------------------------------------------------ helpers

function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Periodic value noise on a gx x gy lattice (wraps in both axes), smooth (quintic) interpolation. */
function lattice(gx, gy, rnd) {
  const g = new Float32Array(gx * gy)
  for (let i = 0; i < g.length; i++) g[i] = rnd() * 2 - 1
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
  return (x, y) => {
    // x, y in lattice units
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = fade(x - x0)
    const fy = fade(y - y0)
    const at = (i, j) => g[(((j % gy) + gy) % gy) * gx + (((i % gx) + gx) % gx)]
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
    return a + (b - a) * fy
  }
}

/** Fractal noise over `oct` octaves of periodic lattices (cx x cy cells at the first). */
function fbm(cx, cy, oct, seed) {
  const rnd = prng(seed)
  const layers = []
  for (let o = 0; o < oct; o++) layers.push({n: lattice(cx << o, cy << o, rnd), sx: cx << o, sy: cy << o, a: Math.pow(0.55, o)})
  const norm = layers.reduce((s, l) => s + l.a, 0)
  return (u, v) => {
    let s = 0
    for (const l of layers) s += l.a * l.n(u * l.sx, v * l.sy)
    return s / norm
  }
}

function crc32(buf) {
  let c
  const table = crc32.t || (crc32.t = Array.from({length: 256}, (_, n) => {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  }))
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function png(path, w, h, value) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let sum = 0
  let lo = 1
  let hi = 0
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(1, value(x, y)))
      sum += v
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
      const b = Math.round(v * 255)
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = raw[o + 1] = raw[o + 2] = b
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, "ascii"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = ihdr[11] = ihdr[12] = 0
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, {level: 9})), chunk("IEND", Buffer.alloc(0))])
  writeFileSync(path, file)
  console.log(`${path}: ${w}x${h}, mean ${(sum / (w * h)).toFixed(3)}, range ${lo.toFixed(3)}..${hi.toFixed(3)}`)
}

// ------------------------------------------------------------------ rice paper

function paper() {
  const W = 512
  const H = 1024
  const img = new Float32Array(W * H)
  // Faint fibre variation: fine, slightly horizontal grain, plus a very soft cloudiness.
  const fibre = fbm(64, 96, 3, 11)
  const fleck = fbm(160, 200, 2, 12)
  const cloud = fbm(4, 6, 3, 13)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W
      const v = y / H
      img[y * W + x] = 0.955 + 0.022 * fibre(u, v) + 0.012 * fleck(u, v) + 0.015 * cloud(u, v)
    }
  // Creases: thin horizontal folds, each a dark valley with a faint lit ridge just above or below,
  // wandering in v as it goes round, fading in and out along its run. Most are faint.
  const rnd = prng(29)
  const N = 560
  for (let i = 0; i < N; i++) {
    const vc = rnd() * H
    const strong = rnd()
    const c = 0.022 + 0.085 * Math.pow(strong, 2.4)
    const w = 0.55 + 1.1 * rnd()
    const ridge = rnd() < 0.5 ? -1 : 1
    const runs = rnd() < 0.15 ? W : Math.floor(W * (0.08 + 0.5 * rnd()))
    const x0 = Math.floor(rnd() * W)
    const k1 = 1 + Math.floor(rnd() * 3)
    const a1 = 0.6 + 2.2 * rnd()
    const p1 = rnd() * Math.PI * 2
    const wob = fbm(8, 1, 3, 1000 + i)
    const env = fbm(4, 1, 2, 5000 + i)
    for (let j = 0; j < runs; j++) {
      const x = (x0 + j) % W
      const u = x / W
      const t = runs === W ? 1 : Math.sin((Math.PI * j) / runs)
      const along = Math.max(0, Math.min(1, 0.65 + 0.7 * env(u, 0))) * Math.pow(t, 0.6)
      if (along <= 0.01) continue
      const yc = vc + a1 * Math.sin(2 * Math.PI * k1 * u + p1) + 3.2 * wob(u, 0)
      for (let dy = -Math.ceil(4 * w); dy <= Math.ceil(4 * w); dy++) {
        const y = Math.round(yc) + dy
        if (y < 0 || y >= H) continue
        const d = y - yc
        const val = -c * Math.exp(-((d / w) ** 2)) + 0.45 * c * Math.exp(-(((d - ridge * 1.7 * w) / w) ** 2))
        img[y * W + x] += val * along
      }
    }
  }
  png(join(OUT, "LampPaper.png"), W, H, (x, y) => img[y * W + x])
}

// ------------------------------------------------------------------ brushed steel

function brushed() {
  const W = 1024
  const H = 128
  const grain = fbm(256, 1, 2, 41)
  const streak = fbm(96, 3, 3, 42)
  const breaks = fbm(64, 8, 2, 43)
  png(join(OUT, "LampBrushed.png"), W, H, (x, y) => {
    const u = x / W
    const v = y / H
    // Fine streaks across u, each fading in and out a little along v.
    return 0.83 + 0.12 * grain(u, 0) + 0.07 * streak(u, v * 0.3) + 0.03 * breaks(u, v)
  })
}

paper()
brushed()
