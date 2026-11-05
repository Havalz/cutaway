/**
 * Lamp hero: the light (lamp-hero.md §2 "Switch it on", §4 sliders).
 *
 * Pinching the foot switch starts it, in this order:
 *   1. Current: cyan pulses travel from the switch along the cord, into the base, up the stem and
 *      the socket into the bulb (energy moving: soft tapered packets on a faintly charged line).
 *   2. The bulb lights: the LED chips and the frosted envelope glow, and a magnify bubble opens at
 *      the chips. In it blue light leaves a tiny chip; inside the phosphor coating over it part of the
 *      blue turns yellow; together they come out white (the lamp's colour).
 *   3. The shade glows from within: brightest at the paper's widest middle, spreading smoothly and
 *      wide up and down it (the paper scatters the light through the whole shade), softer at the top,
 *      a little dimmer at the bottom, and a soft pool of light lies on the table.
 *   4. The real lamp: a thin cyan thread runs from the copy's plug across the room to the real lamp's
 *      base and up its stem; its shade fills with the same glow and a warm pool lies on the floor.
 * Off: the pulses stop, the bubble closes and everything fades over 0.4 s.
 *
 * Lifting the shade (§3, the lift 0..1 over 25 cm): the paper moves away from the bulb, so its glow
 * falls and moves down to its bottom edge; the bare bulb shows as a small bright point, and above
 * 60% of the lift thin sharp rays leave it; the pool on the table shrinks and brightens and its
 * edge turns crisp (a small source casts a sharp edge). Nothing goes dark: only edges and rays change.
 *
 * Every level is computed each frame from (Brightness, Warmth): Brightness scales the pulses (rate,
 * density and strength), the LED, the shade glow, the pools and the real lamp, and 0 looks the same
 * as off. Warmth sets the colour of all emitted light by kelvinToRgb (Kang et al. 2002, below).
 */
import {lightColor, MeshKit, setFade, spawnMesh, STRUCT_GLOW} from "./CutawayGeometry"
import {TableSurface} from "./CutawayHeroSurface"
import {LAMP_GEOM, lampShadeR, LampModel} from "./CutawayLampModel"
import {bezier} from "./CutawayStageKit"
import {ENERGY, ink, UI_WHITE} from "./CutawayStyle"
import {clamp01, easeIn, easeInOut, easeOutCubic, faceToward, yawToward} from "./CutawayTween"

const G = LAMP_GEOM

// =====================================================================================
// Colour temperature (reported)
// =====================================================================================

export const LAMP_K_MIN = 2700
export const LAMP_K_MAX = 6500
export const LAMP_K_DEFAULT = 3000

/**
 * CIE 1931 (x, y) of a blackbody at T kelvin: the cubic-spline approximation of the Planckian locus
 * by Kang et al. (2002), valid 1667–25000 K.
 */
export function planckianXY(T: number): vec2 {
  const t = Math.max(1667, Math.min(25000, T))
  const t2 = t * t
  const t3 = t2 * t
  const x = t <= 4000 ? -0.2661239e9 / t3 - 0.2343589e6 / t2 + 0.8776956e3 / t + 0.17991 : -3.0258469e9 / t3 + 2.1070379e6 / t2 + 0.2226347e3 / t + 0.24039
  const x2 = x * x
  const x3 = x2 * x
  let y: number
  if (t <= 2222) y = -1.1063814 * x3 - 1.3481102 * x2 + 2.18555832 * x - 0.20219683
  else if (t <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867
  else y = 3.081758 * x3 - 5.8733867 * x2 + 3.75112997 * x - 0.37001483
  return new vec2(x, y)
}

const srgbEncode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/**
 * The emitted colour at T kelvin (display RGB, 0..1): the Planckian (x, y) (Kang et al. 2002) →
 * XYZ at Y = 1 → linear sRGB (IEC 61966-2-1 D65 matrix) → negatives clipped → scaled so the largest
 * channel is 1 → the sRGB transfer curve. 2700 K ≈ (1, 0.678, 0.349), 6500 K ≈ (1, 0.975, 0.997).
 */
export function kelvinToRgb(T: number): vec3 {
  const c = planckianXY(T)
  const X = c.x / c.y
  const Z = (1 - c.x - c.y) / c.y
  const r = Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z)
  const g = Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z)
  const b = Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z)
  const m = Math.max(r, g, b, 1e-9)
  return new vec3(srgbEncode(r / m), srgbEncode(g / m), srgbEncode(b / m))
}

/** Warmth slider (0 cool … 1 warm) → kelvin, linear in mired (1e6 / T) so equal steps look equal. */
export function warmthToKelvin(v: number): number {
  const m0 = 1e6 / LAMP_K_MAX
  const m1 = 1e6 / LAMP_K_MIN
  return 1e6 / (m0 + (m1 - m0) * clamp01(v))
}

export function kelvinToWarmth(T: number): number {
  const m0 = 1e6 / LAMP_K_MAX
  const m1 = 1e6 / LAMP_K_MIN
  return clamp01((1e6 / T - m0) / (m1 - m0))
}

/**
 * The share of the chip's blue that the phosphor coating turns yellow: warmer LEDs carry more
 * phosphor, so less blue escapes. Linear in mired, 55% at 6500 K to 85% at 2700 K.
 */
export function coatingShare(T: number): number {
  return 0.55 + 0.3 * kelvinToWarmth(T)
}

/** The colour the coating turns the blue into at T: yellow, shifting toward amber (the red phosphor) as it warms. */
export function coatingColor(T: number): vec3 {
  const w = 0.55 * kelvinToWarmth(T)
  const y = new vec3(COAT_YELLOW.x, COAT_YELLOW.y, COAT_YELLOW.z)
  return y.add(COAT_AMBER.sub(y).uniformScale(w))
}

/** The paper's widest row (model space; t = 0.51 in CutawayLampModel's SHADE_KNOTS): the glow's brightest row. */
export const GLOW_CENTRE_Y = G.paperY0 + 0.51 * (G.paperY1 - G.paperY0)
/** How far (model cm) the glow halves above and below its centre: about 0.64 at the top ring and 0.76 at the bottom ring. */
const GLOW_SPREAD_UP = 90
const GLOW_SPREAD_DOWN = 125

/**
 * How brightly the paper glows at model height y, relative to the brightest (its widest row): the
 * paper scatters the bulb's light through the whole shade, so the glow spreads wide from there, softer
 * up to the top and a little dimmer down to the bottom. Flat at the centre, so no crease shows there.
 */
export function shadeGlowAt(y: number): number {
  const d = (y - GLOW_CENTRE_Y) / (y >= GLOW_CENTRE_Y ? GLOW_SPREAD_UP : GLOW_SPREAD_DOWN)
  return 1 / (1 + d * d)
}

/** How far the shade lifts off its seat (world cm, lamp-hero.md §3). */
export const SHADE_LIFT_CM = 25
/** The rays leave the bare bulb only above this share of the lift. */
export const RAYS_FROM = 0.6

/**
 * The paper's glow at its own height y (model, seated) with the shade lifted liftM model cm: the
 * glow stays where it was while the paper rises through it, so its brightest row moves down the
 * paper; once the bulb is below the paper's bottom edge only the light through the bottom opening
 * reaches it (falling off with the gap).
 */
export function shadeGlowLifted(y: number, liftM: number): number {
  const gap = Math.max(0, G.paperY0 + liftM - G.bulbCenterY) / 12
  return shadeGlowAt(y + liftM) / (1 + gap * gap)
}

// =====================================================================================
// Timing and look
// =====================================================================================

/** The current's front along the cord and stem (world cm/s), and the packets behind it. */
const V_CURRENT = 30
const PACKET_LEN = 2.2
const BULB_RAMP = 0.35
const GLOW_RAMP = 0.6
const BUBBLE_OPEN = 0.3
const BUBBLE_CLOSE = 0.22
const THREAD_DELAY = 0.3
const V_THREAD = 320
const THREAD_PACKET_LEN = 12
const THREAD_SPACING = 34
const REAL_RAMP = 0.5
const CAPTION_GLOW_AFTER = 2.6
const FADE_S = 0.4
/** The table pool (world cm) shade on: wide and soft. Shade off (step 4): smaller, brighter and crisp. */
const POOL_R = 30
const POOL_R_BARE = 17
const FLOOR_POOL_R = 115
/**
 * Glow strengths: the light each adds at full Brightness (linear; tint() and the vertex gradients
 * take the square root, since the glow material blends Add with source alpha so both land squared).
 */
// Spread over the whole shade the same total light needs a lower peak (0.42 when it sat low): both set from before/after captures of the added light.
const SHADE_GAIN = 0.16
const REAL_GAIN = 0.175
const POOL_GAIN = 0.4
const FLOOR_GAIN = 0.45
const BLOOM_GAIN = 0.05
const RAYS_GAIN = 0.9
/** The bare bulb's rays at full extent (world cm; each 65–100% of this). */
const RAY_LEN = 12

const SIGNAL = ENERGY.signal
const CHIP_BLUE = new vec4(0.25, 0.5, 1, 1)
const COAT_YELLOW = new vec4(1, 0.82, 0.22, 1)
/** Warm LEDs add a red phosphor: the converted light shifts from yellow toward amber as the coating grows. */
const COAT_AMBER = new vec3(1, 0.6, 0.16)
const ZERO = new vec4(0, 0, 0, 0)
/** Render after every part of the copy (its draw orders run 0–15), so the paper's depth hides the glow's far side. */
const ORDER = 20

export type LightPhase = "off" | "flow" | "lit" | "fading"

export interface LampLightParams {
  /** 0..1 */
  brightness: number
  kelvin: number
  /** The shade's lift, 0 (seated) … 1 (25 cm up): step 4. */
  lift: number
  /** The copy lifted off the table or taken apart (0 whole on the table … 1): the parts of the light that live on the whole lamp fade. */
  apart: number
}

export interface LampLightCtx {
  /** The stage root (world identity). */
  parent: SceneObject
  glowMat: Material
  camPos: () => vec3
  model: LampModel
  /** The copy's root (model space → world). */
  replica: SceneObject
  scale: () => number
  surface: () => TableSurface
  /** The base's centre on the table (world, y = the table top). */
  foot: () => vec3
  realOrigin: () => vec3
  realBulb: () => vec3
  /** Which side of the copy the bubble opens on, as the user sees it (+1 right, −1 left). */
  bubbleSide: () => number
  /** Light the bulb's LED chips and frosted envelope (level 0..1, the light's colour). */
  setBulbGlow: (level: number, color: vec3) => void
  sound: (s: "rise", p: vec3) => void
  log: (p: string) => void
  /** 1: the current, 2: the chip, 3: the paper. */
  caption: (stage: number) => void
}

export interface LampLightInfo {
  phase: LightPhase
  brightness: number
  kelvin: number
  /** kelvinToRgb(kelvin): the colour all emitted light is drawn in. */
  color: vec3
  /** How far the current's front has come along its path (0..1), and the path's ends (world). */
  front: number
  pathStart: vec3 | null
  pathEnd: vec3 | null
  pathLength: number
  /** Packets on the path now (world centres) and their peak strength; their spacing (cm) and how many pass a point each second. */
  packets: vec3[]
  pulseLevel: number
  pulseSpacing: number
  pulseRate: number
  /** The LED's level (× Brightness). */
  led: number
  bubbleOpen: number
  /** The chip in the bubble: shown, and the colour it is drawn in. */
  chipShown: boolean
  chipColor: vec3
  /** Photons in flight in the bubble, by colour, and the coating's share and colour; the bubble's white light colour. */
  photonsBlue: number
  photonsYellow: number
  coatingShare: number
  coatColor: vec3
  bubbleColor: vec3
  /** The shade's glow (× Brightness) and its profile: at its brightest row, level with the bulb, at the top, at the bottom ring. */
  shadeGlow: number
  shadeProfile: {mid: number; bulb: number; top: number; bottom: number}
  /** The paper's brightest row now (1 seated; falls as the shade lifts away from the bulb). */
  shadePeak: number
  /** The shade's lift (0 seated … 1 at 25 cm), the bare bulb's rays (level × Brightness, 0 up to RAYS_FROM) and how far out they reach (0..1). */
  lift: number
  rays: number
  raysExtent: number
  /** The bare bulb's point of light (× Brightness). */
  bulbPoint: number
  /** The shade glow's drawn colour (its material colour over its level). */
  miniColor: vec3
  /** The pool on the table: level, radius (cm) and edge width (fraction of the radius); its drawn colour. */
  tablePool: {level: number; radius: number; edge: number}
  poolColor: vec3
  /** The thread to the real lamp: how far it has come, how strongly it is drawn. */
  threadFront: number
  threadLevel: number
  threadStart: vec3 | null
  threadEnd: vec3 | null
  threadReached: boolean
  /** The real lamp: its shade glow (× Brightness) and drawn colour, the floor pool. */
  realGlow: number
  realColor: vec3
  floorPool: number
  floorColor: vec3
}

// =====================================================================================
// Dynamic meshes
// =====================================================================================

const LAYOUT = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true},
  {name: "color", components: 4}
]

/** Across a ribbon of light: hot centre, soft edges (offsets × half-width). */
const PROFILE = [
  {o: -1, k: 0, hot: 0},
  {o: -0.42, k: 0.5, hot: 0},
  {o: 0, k: 1, hot: 0.4},
  {o: 0.42, k: 0.5, hot: 0},
  {o: 1, k: 0, hot: 0}
]

function newBuilder(): MeshBuilder {
  const mb = new MeshBuilder(LAYOUT)
  mb.topology = MeshTopology.Triangles
  mb.indexType = MeshIndexType.UInt16
  return mb
}

function attach(parent: SceneObject, name: string, mb: MeshBuilder, material: Material): {so: SceneObject; rmv: RenderMeshVisual; mat: Material} {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mb.getMesh()
  const mat = material.clone()
  mat.mainPass.twoSided = true
  rmv.mainMaterial = mat
  rmv.setRenderOrder(ORDER)
  return {so, rmv, mat}
}

/**
 * A ribbon of light through world points that turns its flat side to the eye at every point (so a
 * path that runs away from the viewer stays a line), with a width and a strength per point.
 */
export class PathRibbon {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private cols: vec4[]

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private count: number,
    color: vec4
  ) {
    const P = PROFILE.length
    this.cols = PROFILE.map((q) => lightColor(color, q.k, q.hot))
    this.mb = newBuilder()
    const data: number[] = []
    for (let i = 0; i < count * P; i++) data.push(0, 0, 0, 0, 0, 1, 0, 0, 0, 0)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let i = 0; i < count - 1; i++)
      for (let k = 0; k < P - 1; k++) {
        const a = i * P + k
        const b = a + P
        idx.push(a, b, b + 1, a, b + 1, a + 1)
      }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    const s = attach(parent, name, this.mb, material)
    this.so = s.so
    this.mat = s.mat
  }

  update(pts: vec3[], eye: vec3, width: number[], alpha: number[]): void {
    const P = PROFILE.length
    const n = pts.length
    let prev = vec3.up()
    for (let i = 0; i < this.count; i++) {
      const j = Math.min(i, n - 1)
      const p = pts[j]
      const a = pts[Math.max(0, j - 1)]
      const b = pts[Math.min(n - 1, j + 1)]
      const v = eye.sub(p)
      let side = b.sub(a).cross(v)
      side = side.length > 1e-6 ? side.normalize() : prev
      if (i > 0 && side.dot(prev) < 0) side = side.uniformScale(-1)
      prev = side
      const nn = v.length > 1e-6 ? v.normalize() : vec3.forward()
      const w = width[j] / 2
      const k = i < n ? alpha[j] : 0
      for (let q = 0; q < P; q++) {
        const r = p.add(side.uniformScale(PROFILE[q].o * w))
        const c = this.cols[q]
        this.mb.setVertexInterleaved(i * P + q, [r.x, r.y, r.z, nn.x, nn.y, nn.z, c.x * k, c.y * k, c.z * k, c.w * k])
      }
    }
    this.mb.updateMesh()
  }
}

/**
 * A pool of light lying on a horizontal surface: rings at even fractions of its radius whose
 * strength follows a profile, cut off (and softly faded) at a circle (the table's edge).
 */
class PoolMesh {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private static NR = 26
  private static NS = 64
  private last = ""

  constructor(parent: SceneObject, name: string, material: Material) {
    const NR = PoolMesh.NR
    const NS = PoolMesh.NS
    this.mb = newBuilder()
    const data: number[] = []
    for (let i = 0; i < (NR + 1) * NS; i++) data.push(0, 0, 0, 0, 1, 0, 0, 0, 0, 0)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let j = 0; j < NR; j++)
      for (let s = 0; s < NS; s++) {
        const a = j * NS + s
        const b = j * NS + ((s + 1) % NS)
        const c = a + NS
        const d = b + NS
        idx.push(a, c, b, b, c, d)
      }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    const s = attach(parent, name, this.mb, material)
    this.so = s.so
    this.mat = s.mat
  }

  /** Lay it at `center` (world), radius R; `edge` = the soft edge's width as a fraction of R. */
  update(center: vec3, R: number, edge: number, clip: {c: vec3; r: number} | null): void {
    const key = [center.x, center.y, center.z, R, edge, clip ? clip.c.x : 0, clip ? clip.c.z : 0, clip ? clip.r : 0].map((v) => v.toFixed(2)).join(",")
    if (key === this.last) return
    this.last = key
    const NR = PoolMesh.NR
    const NS = PoolMesh.NS
    const e = Math.max(0.02, Math.min(1, edge))
    for (let j = 0; j <= NR; j++) {
      const rho = j / NR
      // Flat inside, then a smooth cosine falloff over the edge.
      const u = clamp01((rho - (1 - e)) / e)
      // (√I, √I) lands as I (Add with source alpha).
      const I = Math.sqrt(0.5 + 0.5 * Math.cos(Math.PI * u))
      for (let s = 0; s < NS; s++) {
        const a = (s / NS) * Math.PI * 2
        let p = new vec3(center.x + Math.cos(a) * rho * R, center.y, center.z + Math.sin(a) * rho * R)
        let k = I
        if (clip) {
          const dx = p.x - clip.c.x
          const dz = p.z - clip.c.z
          const d = Math.sqrt(dx * dx + dz * dz)
          if (d > clip.r) {
            p = new vec3(clip.c.x + (dx / d) * clip.r, center.y, clip.c.z + (dz / d) * clip.r)
            k = 0
          } else k *= clamp01((clip.r - d) / 2)
        }
        this.mb.setVertexInterleaved(j * NS + s, [p.x, p.y, p.z, 0, 1, 0, k, k, k, k])
      }
    }
    this.mb.updateMesh()
  }
}

/** Comets in a face's XY plane (photons in the bubble): each a short streak, hot at its head. */
class CometCloud {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private static ROWS = [
    {u: 0, k: 0},
    {u: 0.6, k: 0.35},
    {u: 0.88, k: 0.8},
    {u: 1, k: 1.1}
  ]

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private n: number
  ) {
    const P = PROFILE.length
    const R = CometCloud.ROWS.length
    this.mb = newBuilder()
    const data: number[] = []
    for (let i = 0; i < n * R * P; i++) data.push(0, 0, 0, 0, 0, 1, 0, 0, 0, 0)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let c = 0; c < n; c++)
      for (let r = 0; r < R - 1; r++)
        for (let k = 0; k < P - 1; k++) {
          const a = c * R * P + r * P + k
          const b = a + P
          idx.push(a, b, b + 1, a, b + 1, a + 1)
        }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    const s = attach(parent, name, this.mb, material)
    this.so = s.so
    this.mat = s.mat
  }

  update(items: {x: number; y: number; dx: number; dy: number; len: number; w: number; c: vec4}[]): void {
    const P = PROFILE.length
    const rows = CometCloud.ROWS
    for (let i = 0; i < this.n; i++) {
      const it = i < items.length ? items[i] : null
      for (let r = 0; r < rows.length; r++)
        for (let q = 0; q < P; q++) {
          const vi = (i * rows.length + r) * P + q
          if (!it) {
            this.mb.setVertexInterleaved(vi, [0, 0, 0, 0, 0, 1, 0, 0, 0, 0])
            continue
          }
          const u = rows[r].u
          const px = it.x - it.dx * it.len * (1 - u) - it.dy * PROFILE[q].o * (it.w / 2)
          const py = it.y - it.dy * it.len * (1 - u) + it.dx * PROFILE[q].o * (it.w / 2)
          const c = lightColor(it.c, PROFILE[q].k * rows[r].k, PROFILE[q].hot + (u > 0.9 ? 0.25 : 0))
          this.mb.setVertexInterleaved(vi, [px, py, 0.03, 0, 0, 1, c.x, c.y, c.z, c.w])
        }
    }
    this.mb.updateMesh()
  }
}

/** A model height held on the paper's span. */
function paperRow(y: number): number {
  return Math.max(G.paperY0, Math.min(G.paperY1, y))
}

/**
 * The copy's paper glow: a lathe just outside the paper (`pad` cm, model space), whose strength per
 * row follows shadeGlowLifted for the shade's current lift (recomputed only when the lift changes).
 */
class ShadeGlowMesh {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private ys: number[] = []
  private pos: vec3[] = []
  private nrm: vec3[] = []
  private last = -1
  private static ROWS = 44
  private static SEG = 48

  constructor(parent: SceneObject, name: string, material: Material, pad: number) {
    const R = ShadeGlowMesh.ROWS
    const N = ShadeGlowMesh.SEG
    this.mb = newBuilder()
    const data: number[] = []
    for (let j = 0; j <= R; j++) {
      const y = G.paperY0 + ((G.paperY1 - G.paperY0) * j) / R
      this.ys.push(y)
      const r = lampShadeR(y) + pad
      for (let s = 0; s <= N; s++) {
        const a = (s / N) * Math.PI * 2
        const n = new vec3(Math.cos(a), 0, Math.sin(a))
        const p = new vec3(n.x * r, y, n.z * r)
        this.pos.push(p)
        this.nrm.push(n)
        data.push(p.x, p.y, p.z, n.x, n.y, n.z, 0, 0, 0, 0)
      }
    }
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let j = 0; j < R; j++)
      for (let s = 0; s < N; s++) {
        const a = j * (N + 1) + s
        const b = a + N + 1
        idx.push(a, a + 1, b, a + 1, b + 1, b)
      }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    const sp = attach(parent, name, this.mb, material)
    this.so = sp.so
    this.mat = sp.mat
    this.update(0)
  }

  /** The glow for the shade lifted liftM model cm. */
  update(liftM: number): void {
    // Small changes are skipped, but seated is always exact.
    if (Math.abs(liftM - this.last) < 0.05 && (liftM > 0 || this.last === 0)) return
    this.last = liftM
    const N = ShadeGlowMesh.SEG
    for (let j = 0; j < this.ys.length; j++) {
      // The material blends Add with source alpha: (√g, √g) lands as g.
      const g = Math.sqrt(shadeGlowLifted(this.ys[j], liftM))
      for (let s = 0; s <= N; s++) {
        const i = j * (N + 1) + s
        const p = this.pos[i]
        const n = this.nrm[i]
        this.mb.setVertexInterleaved(i, [p.x, p.y, p.z, n.x, n.y, n.z, g, g, g, g])
      }
    }
    this.mb.updateMesh()
  }

  /** The paper's brightest point now: its widest row seated, moving down the paper as it lifts (1 seated). */
  peak(): number {
    const liftM = Math.max(0, this.last)
    return shadeGlowLifted(paperRow(GLOW_CENTRE_Y - liftM), liftM)
  }
}

/**
 * The bare bulb's rays (the shade lifted): thin sharp lines leaving the bulb in every direction
 * but straight down into its own base, each a camera-facing ribbon hot at the glass, fading to
 * nothing at its tip. `extent` (0..1) grows them out from the bulb.
 */
class RayBurst {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private dirs: vec3[] = []
  private lens: number[] = []
  private phase: number[] = []
  private static ROWS = [
    {u: 0, k: 1},
    {u: 0.3, k: 0.55},
    {u: 1, k: 0}
  ]

  constructor(parent: SceneObject, name: string, material: Material) {
    // A Fibonacci sphere, less the cone under the bulb (its base and the socket block it).
    const M = 46
    for (let i = 0; i < M; i++) {
      const y = 1 - (2 * (i + 0.5)) / M
      if (y < -0.62) continue
      const r = Math.sqrt(1 - y * y)
      const a = i * Math.PI * (3 - Math.sqrt(5))
      this.dirs.push(new vec3(Math.cos(a) * r, y, Math.sin(a) * r))
      this.lens.push(0.65 + 0.35 * hash01(i + 7))
      this.phase.push(hash01(i + 31) * Math.PI * 2)
    }
    const P = PROFILE.length
    const R = RayBurst.ROWS.length
    this.mb = newBuilder()
    const data: number[] = []
    for (let i = 0; i < this.dirs.length * R * P; i++) data.push(0, 0, 0, 0, 0, 1, 0, 0, 0, 0)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let c = 0; c < this.dirs.length; c++)
      for (let r = 0; r < R - 1; r++)
        for (let k = 0; k < P - 1; k++) {
          const a = c * R * P + r * P + k
          const b = a + P
          idx.push(a, b, b + 1, a, b + 1, a + 1)
        }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    const sp = attach(parent, name, this.mb, material)
    this.so = sp.so
    this.mat = sp.mat
  }

  get count(): number {
    return this.dirs.length
  }

  /** From the glass (r0 from `c`, world) out to `len` cm at full extent. */
  update(c: vec3, r0: number, len: number, eye: vec3, extent: number, t: number): void {
    const P = PROFILE.length
    const rows = RayBurst.ROWS
    const ext = clamp01(extent)
    for (let i = 0; i < this.dirs.length; i++) {
      const d = this.dirs[i]
      const L = len * this.lens[i] * (0.35 + 0.65 * ext)
      // A faint, slow shimmer along each ray (never dark).
      const tw = 0.82 + 0.18 * Math.sin(t * 2.1 + this.phase[i])
      for (let r = 0; r < rows.length; r++) {
        const p = c.add(d.uniformScale(r0 + L * rows[r].u))
        const v = eye.sub(p)
        let side = d.cross(v)
        side = side.length > 1e-6 ? side.normalize() : vec3.right()
        const nn = v.length > 1e-6 ? v.normalize() : vec3.forward()
        const w = (0.16 + (0.035 - 0.16) * rows[r].u) * Math.max(1, v.length / 90)
        for (let q = 0; q < P; q++) {
          const pr = PROFILE[q]
          const x = p.add(side.uniformScale(pr.o * w))
          // (√I, √I) lands as I.
          const k = Math.sqrt(Math.max(0, rows[r].k * pr.k * tw * ext))
          this.mb.setVertexInterleaved((i * rows.length + r) * P + q, [x.x, x.y, x.z, nn.x, nn.y, nn.z, k, k, k, k])
        }
      }
    }
    this.mb.updateMesh()
  }
}

/** The paper's glow as a lathe just outside the paper (`pad` cm), its strength following shadeGlowAt. */
function shadeGlowKit(pad: number, rows: number = 44, seg: number = 48): MeshKit {
  const k = new MeshKit()
  const prof: number[][] = []
  const cols: vec4[] = []
  for (let i = 0; i <= rows; i++) {
    const y = G.paperY0 + ((G.paperY1 - G.paperY0) * i) / rows
    prof.push([lampShadeR(y) + pad, y])
    // The material blends Add with source alpha: (√g, √g) lands as g.
    const g = Math.sqrt(shadeGlowAt(y))
    cols.push(new vec4(g, g, g, g))
  }
  k.addLathe(vec3.zero(), vec3.up(), prof, cols, seg)
  return k
}

/**
 * Tint an additive material so it adds colour × k: the glow material blends Add with source alpha,
 * so (c·√k, √k) lands as c·k (linear in k, the colour exactly c).
 */
function tint(mat: Material, c: vec3, k: number): void {
  const f = Math.sqrt(Math.max(0, k))
  mat.mainPass.baseColor = new vec4(c.x * f, c.y * f, c.z * f, f)
}

/** A material's drawn colour over its level (what tint() set). */
function tintOf(mat: Material | null): vec3 {
  if (!mat) return vec3.zero()
  const b = mat.mainPass.baseColor
  return b.w > 1e-6 ? new vec3(b.x / b.w, b.y / b.w, b.z / b.w) : vec3.zero()
}

/** Tiny deterministic hash (0..1) for photon choices. */
function hash01(i: number): number {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

// =====================================================================================
// The magnify bubble at the LED chips
// =====================================================================================

/** Bubble units: rim radius, the board's line, the chip, the coating's radius. */
const BR = 12
const BOARD_Y = -6
const CHIP_HW = 1.5
const CHIP_TOP = -4.9
const COAT_R = 3.6
const PHOTON_V = 7
const PHOTON_RATE = 16
const PHOTON_MAX_R = 10.2
const PHOTONS = 40

interface Photon {
  id: number
  x: number
  y: number
  dx: number
  dy: number
  age: number
  yellow: boolean | null
}

class LedBubble {
  readonly node: SceneObject
  private face: SceneObject
  private frameMats: Material[] = []
  private chipMat: Material
  private coatMat: Material
  private whiteMat: Material
  private cloud: CometCloud
  private leader: PathRibbon
  readonly S: number
  private photons: Photon[] = []
  private nextId = 0
  private spawnAcc = 0
  private target = vec3.zero()
  blue = 0
  yellowN = 0
  chipShown = false
  /** The converted light's colour now (yellow, warmer toward amber). */
  coatColor = new vec3(COAT_YELLOW.x, COAT_YELLOW.y, COAT_YELLOW.z)

  constructor(
    parent: SceneObject,
    private glowMat: Material,
    led: vec3,
    cam: vec3
  ) {
    this.S = Math.min(1.8, Math.max(1, cam.distance(led) / 220))
    this.node = global.scene.createSceneObject("LampBubble")
    this.node.setParent(parent)
    this.node.getTransform().setWorldPosition(led)
    this.node.getTransform().setLocalScale(vec3.one().uniformScale(1e-4))
    this.face = global.scene.createSceneObject("LampBubbleFace")
    this.face.setParent(this.node)
    this.face.getTransform().setLocalScale(vec3.one().uniformScale(this.S))
    // Frame: thin double rim and a faint inner glow (as the other bubbles).
    const fk = new MeshKit()
    fk.addArcXY(0, 0, BR, 0.2, 0, Math.PI * 2, ink(UI_WHITE, 0.85), 96)
    fk.addArcXY(0, 0, BR - 0.55, 0.1, 0, Math.PI * 2, ink(UI_WHITE, 0.4), 96)
    fk.addFanXY(0, 0, 8, 0, Math.PI * 2, ink(UI_WHITE, 0.02), ink(UI_WHITE, 0.03), 48)
    fk.addSoftRingXY(0, 0, 8, BR - 0.6, ink(UI_WHITE, 0.03), ink(UI_WHITE, 0.1), 64)
    this.frameMats.push(this.glow("LampBubbleFrame", fk))
    // The LED board and the chip on it (structure).
    const bk = new MeshKit(STRUCT_GLOW)
    bk.addLineXY(-9.6, BOARD_Y, 9.6, BOARD_Y, 0.16, ink(UI_WHITE, 0.45))
    bk.addPolylineXY([new vec2(-CHIP_HW, BOARD_Y), new vec2(-CHIP_HW, CHIP_TOP), new vec2(CHIP_HW, CHIP_TOP), new vec2(CHIP_HW, BOARD_Y)], 0.14, ink(UI_WHITE, 0.8))
    this.frameMats.push(this.glow("LampBubbleBoard", bk))
    // The chip's blue glow (lit with the LED).
    const ck = new MeshKit()
    ck.addRectXY(-CHIP_HW + 0.08, BOARD_Y + 0.06, CHIP_HW - 0.08, CHIP_TOP - 0.06, ink(UI_WHITE, 0.9))
    ck.addFanXY(0, CHIP_TOP - 0.4, 2.6, 0, Math.PI * 2, ink(UI_WHITE, 0.35), ZERO, 32)
    this.chipMat = this.glow("LampBubbleChip", ck)
    // The phosphor coating over the chip: a dome, filled faintly, its edge brighter.
    const ok = new MeshKit()
    ok.addFanXY(0, BOARD_Y, COAT_R, 0, Math.PI, ink(UI_WHITE, 0.2), ink(UI_WHITE, 0.12), 40)
    ok.addArcXY(0, BOARD_Y, COAT_R, 0.14, 0, Math.PI, ink(UI_WHITE, 0.75), 40)
    this.coatMat = this.glow("LampBubbleCoating", ok)
    // Together they come out white: the light leaving the coating fills the upper bubble.
    const wk = new MeshKit()
    wk.addFanXY(0, BOARD_Y, PHOTON_MAX_R + 0.3, (22 * Math.PI) / 180, (158 * Math.PI) / 180, ZERO, ink(UI_WHITE, 0.5), 48)
    this.whiteMat = this.glow("LampBubbleWhite", wk)
    this.cloud = new CometCloud(this.face, "LampBubblePhotons", glowMat, PHOTONS)
    this.leader = new PathRibbon(parent, "LampBubbleLeader", glowMat, 8, ink(UI_WHITE, 0.55))
    for (const m of [...this.frameMats, this.chipMat, this.coatMat, this.whiteMat, this.cloud.mat, this.leader.mat]) setFade(m, 0)
  }

  private glow(name: string, kit: MeshKit): Material {
    const s = spawnMesh(this.face, name, kit.build(), this.glowMat)
    s.mat.mainPass.twoSided = true
    s.rmv.setRenderOrder(ORDER + 2)
    return s.mat
  }

  /**
   * `open` 0..1, `led` the LED's level, `share` the coating's yellow share, `color` the lamp's
   * colour; `side` = the user's right (+1) or left (−1) of the copy; `shadeR` the shade's radius
   * there (world).
   */
  update(dt: number, open: number, led: number, b: number, share: number, coat: vec3, color: vec3, ledW: vec3, cam: vec3, side: number, shadeR: number): void {
    this.coatColor = coat
    const up = vec3.up()
    const flat = new vec3(cam.x - ledW.x, 0, cam.z - ledW.z)
    const toUser = flat.length > 1e-4 ? flat.normalize() : vec3.forward()
    const right = toUser.uniformScale(-1).cross(up).normalize()
    const RS = BR * this.S
    this.target = ledW.add(up.uniformScale(RS * 0.35 + 3)).add(right.uniformScale(side * (shadeR + RS + 4))).add(toUser.uniformScale(5))
    const tr = this.node.getTransform()
    tr.setLocalScale(vec3.one().uniformScale(Math.max(1e-4, open)))
    tr.setWorldPosition(vec3.lerp(ledW, this.target, open))
    this.face.getTransform().setWorldRotation(faceToward(cam.sub(tr.getWorldPosition())))
    for (const m of this.frameMats) setFade(m, open)
    const lit = open * led
    tint(this.chipMat, new vec3(CHIP_BLUE.x, CHIP_BLUE.y, CHIP_BLUE.z), lit)
    this.chipShown = open > 0.5
    // The coating reads more yellow (fuller) as more of the blue is converted.
    const coatK = open * (0.35 + 0.65 * led) * (0.4 + 0.6 * clamp01((share - 0.5) / 0.4))
    tint(this.coatMat, coat, coatK)
    tint(this.whiteMat, color, lit)
    setFade(this.cloud.mat, open)
    // Photons: blue from the chip; at the coating each turns yellow with the coating's share.
    if (dt > 0) {
      if (lit > 0.4) this.spawnAcc += dt * PHOTON_RATE * b
      while (this.spawnAcc >= 1 && this.photons.length < PHOTONS) {
        this.spawnAcc -= 1
        const id = this.nextId++
        const ang = (hash01(id * 3 + 1) * 2 - 1) * ((62 * Math.PI) / 180)
        this.photons.push({id, x: (hash01(id * 3 + 2) - 0.5) * 2 * (CHIP_HW - 0.3), y: CHIP_TOP + 0.05, dx: Math.sin(ang), dy: Math.cos(ang), age: 0, yellow: null})
      }
      if (this.spawnAcc >= 1) this.spawnAcc = 0
      for (const p of this.photons) {
        p.x += p.dx * PHOTON_V * dt
        p.y += p.dy * PHOTON_V * dt
        p.age += dt
        if (p.yellow === null && Math.hypot(p.x, p.y - BOARD_Y) >= COAT_R) p.yellow = hash01(p.id * 7 + 5) < share
      }
      this.photons = this.photons.filter((p) => Math.hypot(p.x, p.y - BOARD_Y) < PHOTON_MAX_R)
    }
    this.blue = 0
    this.yellowN = 0
    const items = this.photons.map((p) => {
      const r = Math.hypot(p.x, p.y - BOARD_Y)
      const yellow = p.yellow === true
      if (yellow) this.yellowN++
      else this.blue++
      const a = clamp01(p.age / 0.08) * clamp01((PHOTON_MAX_R - r) / 1.5)
      const c = yellow ? coat : new vec3(CHIP_BLUE.x, CHIP_BLUE.y, CHIP_BLUE.z)
      return {x: p.x, y: p.y, dx: p.dx, dy: p.dy, len: 1.3, w: 0.3, c: new vec4(c.x * a, c.y * a, c.z * a, a)}
    })
    this.cloud.update(items)
    // A hairline from the bubble's rim to the chips (into the shade, where the paper hides it).
    const pos = tr.getWorldPosition()
    const d = ledW.sub(pos)
    const rim = pos.add(d.normalize().uniformScale(RS * open))
    const pts: vec3[] = []
    for (let i = 0; i < 8; i++) pts.push(vec3.lerp(rim, ledW, i / 7))
    const w = pts.map((p) => Math.max(0.08, 0.0011 * p.distance(cam)))
    const k = clamp01((open - 0.6) / 0.4)
    this.leader.update(pts, cam, w, pts.map((_, i) => k * (1 - 0.3 * (i / 7))))
  }

  get count(): number {
    return this.photons.length
  }

  /** The colour of the white light leaving the coating (the lamp's colour). */
  whiteColor(): vec3 {
    return tintOf(this.whiteMat)
  }

  /** The bubble's centre and rim radius now (world). */
  disc(): {c: vec3; r: number} {
    const tr = this.node.getTransform()
    return {c: tr.getWorldPosition(), r: BR * this.S * tr.getLocalScale().x}
  }
}

// =====================================================================================
// The light
// =====================================================================================

/** When each beat happened (getTime(), −1 not yet): kept after the light goes dark, reset when it comes on. */
export interface LampLightTimes {
  on: number
  bulb: number
  realOn: number
  off: number
  dark: number
}

export class LampLight {
  phase: LightPhase = "off"
  private times: LampLightTimes = {on: -1, bulb: -1, realOn: -1, off: -1, dark: -1}
  private root: SceneObject | null = null
  private t = 0
  private tFade = -1
  private tBulb = -1
  private tThread = -1
  private tReal = -1
  private captionGlow = false
  private envAtFade = 1
  // The current's path (model space at rest), its cumulative length and the radius it runs on.
  private path: vec3[] = []
  private cum: number[] = []
  private radius: number[] = []
  private core: PathRibbon | null = null
  private halo: PathRibbon | null = null
  private bubble: LedBubble | null = null
  private shadeGlow: SceneObject | null = null
  private shadeMesh: ShadeGlowMesh | null = null
  private shadeMat: Material | null = null
  private rays: RayBurst | null = null
  private bloom: SceneObject | null = null
  private bloomMat: Material | null = null
  private tablePool: PoolMesh | null = null
  private threadCore: PathRibbon | null = null
  private threadHalo: PathRibbon | null = null
  private threadPts: vec3[] = []
  private threadCum: number[] = []
  /** The first thread point inside the real lamp's shade. */
  private threadInside = 1e9
  private realGlow: SceneObject | null = null
  private realMat: Material | null = null
  private realBloom: SceneObject | null = null
  private realBloomMat: Material | null = null
  private floorPool: PoolMesh | null = null
  private info: LampLightInfo = this.emptyInfo()

  constructor(private ctx: LampLightCtx) {}

  /** On (or coming on). */
  get isOn(): boolean {
    return this.phase === "flow" || this.phase === "lit"
  }

  get isOff(): boolean {
    return this.phase === "off"
  }

  getInfo(): LampLightInfo {
    return this.info
  }

  getTimes(): LampLightTimes {
    return {...this.times}
  }

  /** The switch was pinched on: the current leaves the switch. */
  turnOn(): void {
    this.clear()
    this.build()
    this.phase = "flow"
    this.t = 0
    this.tFade = -1
    this.tBulb = -1
    this.tThread = -1
    this.tReal = -1
    this.captionGlow = false
    this.times = {on: getTime(), bulb: -1, realOn: -1, off: -1, dark: -1}
    this.ctx.caption(1)
    this.ctx.log("lamp:current")
  }

  /** The switch was pinched off: the pulses stop, the bubble closes and everything fades (0.4 s). */
  turnOff(): void {
    if (!this.isOn) return
    this.phase = "fading"
    this.tFade = this.t
    this.times.off = getTime()
    this.ctx.log("lamp:fade")
  }

  /** Remove everything at once (Reset, or the end of the fade). */
  clear(): void {
    if (this.root) this.root.destroy()
    if (this.shadeGlow) this.shadeGlow.destroy()
    this.root = null
    this.shadeGlow = null
    this.shadeMesh = null
    this.shadeMat = null
    this.rays = null
    this.bloom = null
    this.bloomMat = null
    this.core = null
    this.halo = null
    this.bubble = null
    this.tablePool = null
    this.threadCore = null
    this.threadHalo = null
    this.realGlow = null
    this.realMat = null
    this.realBloom = null
    this.realBloomMat = null
    this.floorPool = null
    const was = this.phase
    this.phase = "off"
    this.ctx.setBulbGlow(0, vec3.one())
    this.info = this.emptyInfo()
    if (was !== "off") {
      this.times.dark = getTime()
      this.ctx.log("lamp:dark")
    }
  }

  private build(): void {
    const root = global.scene.createSceneObject("LampLight")
    root.setParent(this.ctx.parent)
    root.getTransform().setLocalPosition(vec3.zero())
    this.root = root
    const glow = this.ctx.glowMat
    // The current's path, resampled to about 1 cm (model), with the radius of what it runs along.
    const raw = this.ctx.model.currentPath()
    this.path = [raw[0]]
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1]
      const b = raw[i]
      const n = Math.max(1, Math.ceil(a.distance(b) / 1.0))
      for (let k = 1; k <= n; k++) this.path.push(vec3.lerp(a, b, k / n))
    }
    this.cum = [0]
    for (let i = 1; i < this.path.length; i++) this.cum.push(this.cum[i - 1] + this.path[i].distance(this.path[i - 1]))
    this.radius = this.path.map((p) => (p.y < 3 ? G.cordR : p.y < G.socketY ? G.stemR : 0.3))
    this.halo = new PathRibbon(root, "LampCurrentGlow", glow, this.path.length, ink(SIGNAL, 0.24))
    this.core = new PathRibbon(root, "LampCurrent", glow, this.path.length, ink(SIGNAL, 1))
    // The shade's glow: a lathe just outside the paper, under the paper part (it lifts with it).
    const paper = this.ctx.model.parts["LampPaper"]
    const piv = this.ctx.model.pivot("LampPaper")
    this.shadeMesh = new ShadeGlowMesh(paper, "LampShadeGlow", glow, 0.18)
    this.shadeMesh.so.getTransform().setLocalPosition(piv.uniformScale(-1))
    this.shadeGlow = this.shadeMesh.so
    this.shadeMat = this.shadeMesh.mat
    // The bare bulb's point of light (hidden by the paper while the shade is on) and its rays.
    const bk = new MeshKit(1.5)
    bk.addSparkXY(0, 0, 0.5, ink(UI_WHITE, 1), 24)
    const bl = spawnMesh(root, "LampBulbPoint", bk.build(), glow)
    bl.rmv.setRenderOrder(ORDER)
    this.bloom = bl.so
    this.bloomMat = bl.mat
    this.rays = new RayBurst(root, "LampRays", glow)
    this.tablePool = new PoolMesh(root, "LampTablePool", glow)
    // The thread and the real lamp.
    this.threadHalo = new PathRibbon(root, "LampThreadGlow", glow, 56, ink(SIGNAL, 0.22))
    this.threadCore = new PathRibbon(root, "LampThread", glow, 56, ink(SIGNAL, 1))
    const rg = spawnMesh(root, "LampRealGlow", shadeGlowKit(0.9, 48, 64).build(), glow, this.ctx.realOrigin())
    rg.mat.mainPass.twoSided = true
    rg.rmv.setRenderOrder(ORDER)
    this.realGlow = rg.so
    this.realMat = rg.mat
    const sk = new MeshKit()
    sk.addFanXY(0, 0, 0.45, 0, Math.PI * 2, ink(UI_WHITE, 1), ink(UI_WHITE, 0.5), 48)
    sk.addSoftRingXY(0, 0, 0.45, 1, ink(UI_WHITE, 0.5), ZERO, 48)
    const rb = spawnMesh(root, "LampRealBloom", sk.build(), glow)
    rb.mat.mainPass.twoSided = true
    rb.rmv.setRenderOrder(ORDER + 1)
    this.realBloom = rb.so
    this.realBloomMat = rb.mat
    this.floorPool = new PoolMesh(root, "LampFloorPool", glow)
    for (const m of [this.core.mat, this.halo.mat, this.shadeMat, this.bloomMat, this.rays.mat, this.tablePool.mat, this.threadCore.mat, this.threadHalo.mat, this.realMat, this.realBloomMat, this.floorPool.mat]) setFade(m, 0)
  }

  // =====================================================================================
  // Per frame
  // =====================================================================================

  update(dt: number, p: LampLightParams): void {
    if (this.phase === "off" || !this.root) return
    this.t += dt
    let env = 1
    if (this.phase === "fading") {
      env = 1 - clamp01((this.t - this.tFade) / FADE_S)
      if (env <= 0) {
        this.clear()
        return
      }
    }
    const b = clamp01(p.brightness)
    // Brightness 0 looks the same as off.
    const vis = easeInOut(b / 0.06)
    // Lifted off the table or taken apart: the current on the cord, the shade's glow, the pool, the
    // rays and the bubble belong to the whole lamp standing there, so they fade (the bulb stays lit).
    const whole = 1 - easeInOut(clamp01(p.apart / 0.15))
    const color = kelvinToRgb(p.kelvin)
    const share = coatingShare(p.kelvin)
    const cam = this.ctx.camPos()
    const S = this.ctx.scale()
    const M = this.ctx.replica.getTransform().getWorldTransform()
    const tLive = this.tFade >= 0 ? this.tFade : this.t

    // ---------------- The current along the cord and the stem ----------------
    const Lm = this.cum[this.cum.length - 1]
    const L = Lm * S
    const front = Math.min(L, V_CURRENT * tLive)
    if (this.phase === "flow" && front >= L - 1e-3) {
      this.phase = "lit"
      this.tBulb = this.t
      this.times.bulb = getTime()
      this.ctx.sound("rise", this.ctx.model.ledCenter())
      this.ctx.caption(2)
      this.ctx.log("lamp:bulb")
    }
    const lit = this.tBulb >= 0
    // Packets: a little denser and faster with Brightness.
    const spacing = 9 - 5 * b
    const vPkt = 12 + 12 * b
    const head = vPkt * this.t
    const pts: vec3[] = []
    const alpha: number[] = []
    const width: number[] = []
    const wHalo: number[] = []
    const packets: vec3[] = []
    for (let i = 0; i < this.path.length; i++) {
      const w = M.multiplyPoint(this.path[i])
      const toCam = cam.sub(w).normalize()
      pts.push(w.add(toCam.uniformScale(this.radius[i] * S + 0.04)))
      const s = this.cum[i] * S
      let a = 0
      if (s <= front) {
        // Charged line behind the front, packets on it (each brightest at its head), the front's head.
        const ph = (head - s) / spacing
        const u = ((ph - Math.floor(ph)) * spacing) / PACKET_LEN
        const pk = u <= 1 ? Math.pow(1 - u, 1.3) : 0
        const fr = front < L ? clamp01(1 - (front - s) / PACKET_LEN) : 0
        a = 0.28 + 0.72 * Math.max(pk * clamp01(b * 1.5), fr)
        a *= clamp01((L - s) / 1.2) * 0.85 + 0.15
      }
      alpha.push(a)
      width.push(0.32)
      wHalo.push(1.3)
    }
    // Packet centres (for the tests): the heads that are on the path behind the front.
    for (let n = Math.ceil((head - front) / spacing); n * spacing <= head; n++) {
      const s = head - n * spacing
      if (s < 0 || s > front) continue
      packets.push(this.pointAt(pts, s / S))
    }
    const pulseLevel = env * vis * whole
    if (this.core && this.halo) {
      this.core.update(pts, cam, width, alpha)
      this.halo.update(pts, cam, wHalo, alpha)
      setFade(this.core.mat, pulseLevel)
      setFade(this.halo.mat, pulseLevel)
    }

    // ---------------- The bulb, the shade, the pool on the table ----------------
    const ledRamp = lit ? easeOutCubic((this.t - this.tBulb) / BULB_RAMP) : 0
    const led = ledRamp * b * env
    this.ctx.setBulbGlow(led, color)
    const glowRamp = lit ? easeOutCubic((this.t - this.tBulb) / GLOW_RAMP) : 0
    const shade = glowRamp * b * env
    // The shade's lift: the paper moves away from the bulb (its glow falls and moves down to the
    // bottom edge); the bare bulb shows as a small bright point and, above RAYS_FROM, sharp rays.
    const lift = clamp01(p.lift)
    const liftM = (lift * SHADE_LIFT_CM) / Math.max(1e-3, S)
    if (this.shadeMesh) this.shadeMesh.update(liftM)
    if (this.shadeMat) tint(this.shadeMat, color, shade * SHADE_GAIN * whole)
    // The bulb's centre (the envelope's, where its parts really are) and, taken apart, the bare chips.
    const model = this.ctx.model
    const glassW = model.parts["LampBulbGlass"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, G.bulbCenterY - model.pivot("LampBulbGlass").y, 0))
    const bulbW = vec3.lerp(glassW, model.ledCenter(), 1 - whole)
    const point = led * (1 + 0.5 * lift)
    if (this.bloom && this.bloomMat) {
      const toCam = cam.sub(bulbW).normalize()
      const tr = this.bloom.getTransform()
      tr.setWorldPosition(bulbW.add(toCam.uniformScale((G.bulbR * whole + 0.3 * (1 - whole)) * S + 0.25)))
      tr.setWorldRotation(faceToward(toCam))
      tr.setWorldScale(vec3.one().uniformScale(S * 2.2))
      tint(this.bloomMat, color, point)
    }
    const raysExt = easeInOut(clamp01((lift - RAYS_FROM) / (1 - RAYS_FROM)))
    const rays = raysExt * led * whole
    if (this.rays) {
      if (rays > 1e-4) this.rays.update(bulbW, G.bulbR * S + 0.08, RAY_LEN, cam, raysExt, this.t)
      this.rays.so.enabled = rays > 1e-4
      tint(this.rays.mat, color, rays * RAYS_GAIN)
    }
    const poolR = POOL_R + (POOL_R_BARE - POOL_R) * lift
    const poolEdge = 0.9 + (0.12 - 0.9) * lift
    const poolLevel = glowRamp * b * env * (1 + 0.8 * lift) * whole
    if (this.tablePool) {
      const s = this.ctx.surface()
      const f = this.ctx.foot()
      this.tablePool.update(new vec3(f.x, s.height + 0.12, f.z), poolR, poolEdge, {c: s.center, r: Math.max(5, s.radius - 0.5)})
      tint(this.tablePool.mat, color, poolLevel * POOL_GAIN)
    }

    // ---------------- The bubble ----------------
    let open = 0
    if (lit) {
      open = easeOutCubic((this.t - this.tBulb) / BUBBLE_OPEN)
      if (this.phase === "fading") open *= 1 - easeIn((this.t - this.tFade) / BUBBLE_CLOSE)
      open *= vis * whole
      if (!this.bubble && this.root) {
        this.bubble = new LedBubble(this.root, this.ctx.glowMat, this.ctx.model.ledCenter(), cam)
        this.ctx.log("lamp:bubble")
      }
    }
    if (this.bubble) {
      const ledW = this.ctx.model.ledCenter()
      const yLed = G.ledY
      this.bubble.update(this.phase === "fading" ? 0 : dt, open, ledRamp, b, share, coatingColor(p.kelvin), color, ledW, cam, this.ctx.bubbleSide(), lampShadeR(yLed) * S)
    }
    if (lit && !this.captionGlow && this.t - this.tBulb >= CAPTION_GLOW_AFTER && this.phase === "lit") {
      this.captionGlow = true
      this.ctx.caption(3)
      this.ctx.log("lamp:scatter")
    }

    // ---------------- The thread, the real lamp and its floor pool ----------------
    if (lit && this.tThread < 0 && this.t - this.tBulb >= THREAD_DELAY && this.phase === "lit") {
      this.tThread = this.t
      this.ctx.log("lamp:thread")
    }
    this.buildThreadPath(M, cam)
    const Lt = this.threadCum[this.threadCum.length - 1]
    const tf = this.tThread >= 0 ? Math.min(Lt, V_THREAD * ((this.tFade >= 0 ? this.tFade : this.t) - this.tThread)) : 0
    if (this.tThread >= 0 && this.tReal < 0 && tf >= Lt - 1e-3 && this.phase === "lit") {
      this.tReal = this.t
      this.times.realOn = getTime()
      this.ctx.log("lamp:realOn")
    }
    if (this.threadCore && this.threadHalo) {
      const th = V_THREAD * 0.45 * this.t
      const disc = this.bubble ? this.bubble.disc() : null
      const ta: number[] = []
      const tw: number[] = []
      const tw2: number[] = []
      for (let i = 0; i < this.threadPts.length; i++) {
        const s = this.threadCum[i]
        let a = 0
        if (this.tThread >= 0 && s <= tf) {
          const ph = (th - s) / THREAD_SPACING
          const u = ((ph - Math.floor(ph)) * THREAD_SPACING) / THREAD_PACKET_LEN
          const pk = u <= 1 ? Math.pow(1 - u, 1.3) : 0
          const fr = tf < Lt ? clamp01(1 - (tf - s) / THREAD_PACKET_LEN) : 0
          a = 0.42 + 0.58 * Math.max(pk * clamp01(b * 1.5), fr)
          // Up the real stem inside the shade it is seen faintly through the paper.
          if (i >= this.threadInside) a *= 0.35
          // Behind the open bubble it dims, so the bubble reads clean.
          if (disc && disc.r > 0.5) {
            const v = this.threadPts[i].sub(cam)
            const bc = disc.c.sub(cam)
            const L = bc.length
            if (v.length > L) {
              const ang = Math.acos(Math.max(-1, Math.min(1, v.normalize().dot(bc.uniformScale(1 / L)))))
              const rim = Math.atan(disc.r / L)
              a *= 0.15 + 0.85 * clamp01((ang - rim * 0.92) / (rim * 0.12))
            }
          }
        }
        ta.push(a)
        const d = this.threadPts[i].distance(cam)
        tw.push(Math.max(0.25, 0.003 * d))
        tw2.push(Math.max(1, 0.011 * d))
      }
      this.threadCore.update(this.threadPts, cam, tw, ta)
      this.threadHalo.update(this.threadPts, cam, tw2, ta)
      setFade(this.threadCore.mat, env * vis)
      setFade(this.threadHalo.mat, env * vis)
    }
    const realRamp = this.tReal >= 0 ? easeOutCubic((this.t - this.tReal) / REAL_RAMP) : 0
    const real = realRamp * b * env
    if (this.realMat) tint(this.realMat, color, real * REAL_GAIN)
    if (this.realBloom && this.realBloomMat) {
      const o = this.ctx.realOrigin()
      const c = o.add(new vec3(0, GLOW_CENTRE_Y, 0))
      const flat = new vec3(cam.x - c.x, 0, cam.z - c.z)
      const toCam = flat.length > 1e-4 ? flat.normalize() : vec3.forward()
      const tr = this.realBloom.getTransform()
      tr.setWorldPosition(c.add(toCam.uniformScale(G.shadeMaxR + 2)))
      tr.setWorldRotation(yawToward(toCam))
      tr.setWorldScale(new vec3(42, 105, 1))
      tint(this.realBloomMat, color, real * BLOOM_GAIN)
    }
    if (this.floorPool) {
      const o = this.ctx.realOrigin()
      this.floorPool.update(o.add(new vec3(0, 0.6, 0)), FLOOR_POOL_R, 0.85, null)
      tint(this.floorPool.mat, color, real * FLOOR_GAIN)
    }

    // ---------------- Read-only state ----------------
    this.info = {
      phase: this.phase,
      brightness: b,
      kelvin: p.kelvin,
      color,
      front: L > 0 ? front / L : 0,
      pathStart: pts[0],
      pathEnd: pts[pts.length - 1],
      pathLength: L,
      packets,
      pulseLevel,
      pulseSpacing: spacing,
      pulseRate: vPkt / spacing,
      led,
      bubbleOpen: open,
      chipShown: !!this.bubble && this.bubble.chipShown,
      chipColor: new vec3(CHIP_BLUE.x, CHIP_BLUE.y, CHIP_BLUE.z),
      photonsBlue: this.bubble ? this.bubble.blue : 0,
      photonsYellow: this.bubble ? this.bubble.yellowN : 0,
      coatingShare: share,
      coatColor: this.bubble ? this.bubble.coatColor : coatingColor(p.kelvin),
      bubbleColor: this.bubble ? this.bubble.whiteColor() : vec3.zero(),
      shadeGlow: shade * whole,
      shadeProfile: {
        mid: shadeGlowLifted(paperRow(GLOW_CENTRE_Y - liftM), liftM),
        bulb: shadeGlowLifted(paperRow(G.bulbCenterY - liftM), liftM),
        top: shadeGlowLifted(G.paperY1, liftM),
        bottom: shadeGlowLifted(G.paperY0, liftM)
      },
      shadePeak: this.shadeMesh ? this.shadeMesh.peak() : 1,
      lift,
      rays,
      raysExtent: raysExt,
      bulbPoint: point,
      miniColor: tintOf(this.shadeMat),
      tablePool: {level: poolLevel, radius: poolR, edge: poolEdge},
      poolColor: tintOf(this.tablePool ? this.tablePool.mat : null),
      threadFront: Lt > 0 ? tf / Lt : 0,
      threadLevel: env * vis,
      threadStart: this.threadPts.length ? this.threadPts[0] : null,
      threadEnd: this.threadPts.length ? this.threadPts[this.threadPts.length - 1] : null,
      threadReached: this.tReal >= 0,
      realGlow: real,
      realColor: tintOf(this.realMat),
      floorPool: real,
      floorColor: tintOf(this.floorPool ? this.floorPool.mat : null)
    }
  }

  /** A point on the (camera-offset) current path at model arc length sm. */
  private pointAt(pts: vec3[], sm: number): vec3 {
    for (let i = 1; i < this.cum.length; i++) {
      if (this.cum[i] >= sm) {
        const seg = this.cum[i] - this.cum[i - 1]
        return vec3.lerp(pts[i - 1], pts[i], seg > 1e-6 ? (sm - this.cum[i - 1]) / seg : 0)
      }
    }
    return pts[pts.length - 1]
  }

  /**
   * The thread: from the copy's plug, up over the room in a soft arc and down onto the real lamp's
   * base, then up its stem into the shade to its bulb (the paper hides the last part).
   */
  private buildThreadPath(M: mat4, cam: vec3): void {
    void M
    // From the plug where it really is (it stays on the table while the copy hovers).
    const start = this.ctx.model.parts["LampPlug"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, 1.4, 0))
    const o = this.ctx.realOrigin()
    const bulb = this.ctx.realBulb()
    const flat = new vec3(cam.x - o.x, 0, cam.z - o.z)
    const toCam = flat.length > 1e-4 ? flat.normalize() : vec3.forward()
    const off = toCam.uniformScale(G.stemR + 0.4)
    const land = o.add(new vec3(0, G.domeTop + 0.4, 0)).add(toCam.uniformScale(4))
    const foot = o.add(new vec3(0, G.collarTop, 0)).add(off)
    const top = bulb.add(off)
    const dist = start.distance(land)
    const c = vec3.lerp(start, land, 0.5).add(new vec3(0, 0.18 * dist + 15, 0))
    const pts: vec3[] = []
    for (let i = 0; i <= 44; i++) pts.push(bezier(start, c, land, i / 44))
    pts.push(vec3.lerp(land, foot, 0.5), foot)
    this.threadInside = 1e9
    for (let i = 1; i <= 9; i++) {
      const q = vec3.lerp(foot, top, i / 9)
      if (q.y > o.y + G.shadeSeatY && this.threadInside > pts.length) this.threadInside = pts.length
      pts.push(q)
    }
    this.threadPts = pts
    this.threadCum = [0]
    for (let i = 1; i < pts.length; i++) this.threadCum.push(this.threadCum[i - 1] + pts[i].distance(pts[i - 1]))
  }

  private emptyInfo(): LampLightInfo {
    return {
      phase: "off",
      brightness: 0,
      kelvin: LAMP_K_DEFAULT,
      color: kelvinToRgb(LAMP_K_DEFAULT),
      front: 0,
      pathStart: null,
      pathEnd: null,
      pathLength: 0,
      packets: [],
      pulseLevel: 0,
      pulseSpacing: 0,
      pulseRate: 0,
      led: 0,
      bubbleOpen: 0,
      chipShown: false,
      chipColor: new vec3(CHIP_BLUE.x, CHIP_BLUE.y, CHIP_BLUE.z),
      photonsBlue: 0,
      photonsYellow: 0,
      coatingShare: coatingShare(LAMP_K_DEFAULT),
      coatColor: coatingColor(LAMP_K_DEFAULT),
      bubbleColor: vec3.zero(),
      shadeGlow: 0,
      shadeProfile: {mid: 1, bulb: shadeGlowAt(G.bulbCenterY), top: shadeGlowAt(G.paperY1), bottom: shadeGlowAt(G.paperY0)},
      shadePeak: 1,
      lift: 0,
      rays: 0,
      raysExtent: 0,
      bulbPoint: 0,
      miniColor: vec3.zero(),
      tablePool: {level: 0, radius: POOL_R, edge: 0.9},
      poolColor: vec3.zero(),
      threadFront: 0,
      threadLevel: 0,
      threadStart: null,
      threadEnd: null,
      threadReached: false,
      realGlow: 0,
      realColor: vec3.zero(),
      floorPool: 0,
      floorColor: vec3.zero()
    }
  }
}
