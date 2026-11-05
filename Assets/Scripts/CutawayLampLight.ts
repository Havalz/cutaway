/**
 * Lamp hero: the light (lamp-hero.md §2 "Switch it on", §4 sliders).
 *
 * Pinching the foot switch starts it, in this order:
 *   1. Current: cyan pulses travel from the switch along the cord, into the base, up the stem and
 *      the socket into the bulb (energy moving: soft tapered packets on a faintly charged line).
 *   2. The bulb lights: the LED chips and the frosted envelope glow, and a magnify bubble opens at
 *      the chips. In it blue light leaves a tiny chip; inside the phosphor coating over it part of the
 *      blue turns yellow; together they come out white (the lamp's colour).
 *   3. The shade glows from within: brightest at the paper's widest middle, fading smoothly up and
 *      down to its rings, and a soft pool of light lies on the table.
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
import {lightColor, MeshKit, rewriteVertices, spawnMesh, STRUCT_GLOW} from "./CutawayGeometry"
import {TableSurface} from "./CutawayHeroSurface"
import {LAMP_GEOM, lampShadeR, LampModel} from "./CutawayLampModel"
import {ENERGY, ink, INK} from "./CutawayStyle"
import {clamp01, easeIn, easeInOut, easeOutCubic, faceToward, RibbonClock, yawToward} from "./CutawayTween"

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
/** How far (model cm) the glow halves above and below its centre: about 0.26 at the top ring and 0.33 at the bottom ring. */
const GLOW_SPREAD_UP = 40
const GLOW_SPREAD_DOWN = 50

/**
 * How brightly the paper glows at model height y, relative to the brightest (its widest row): the
 * centre stands out clearly and the glow falls off smoothly to both rings. Flat at the centre, so no
 * crease shows there.
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
const THREAD_N = 56
const REAL_RAMP = 0.5
const CAPTION_GLOW_AFTER = 2.6
const FADE_S = 0.4
/** The table pool (world cm) shade on: wide and soft. Shade off (step 4): smaller, brighter and crisp. */
const POOL_R = 30
const POOL_R_BARE = 17
const FLOOR_POOL_R = 115
/** The floor pool's rings stop here (share of its radius): past it the light is too faint to see. */
const FLOOR_POOL_TRIM = 0.87
/**
 * Glow strengths: the light each adds at full Brightness (linear; tint() and the vertex gradients
 * take the square root, since the glow material blends Add with source alpha so both land squared).
 */
const SHADE_GAIN = 0.42
const REAL_GAIN = 0.42
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
/** How far the eye moves (cm) before a ribbon turns to it again: under half a degree at arm's length. */
const EYE_EPS = 0.5
/** How far something moves (cm) before what hangs on it is placed again. */
const MOVE_EPS = 0.01
/** A whole object faces the eye again after it has moved this far (cm). */
const FACE_EPS = 0.05
const CHIP_BLUE_RGB = new vec3(CHIP_BLUE.x, CHIP_BLUE.y, CHIP_BLUE.z)
const ROW_LED = new vec3(0, 0.16, 0)
const PLUG_POINT = new vec3(0, 1.4, 0)
/** The real lamp's bloom stops here (its unit radius): at that edge it adds less than 1/255. */
const BLOOM_EDGE = 0.72

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

/** Points along a path (world) and a strength at each, as plain numbers, reused from frame to frame. */
export interface PathPoints {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  a: Float64Array
}

export function pathPoints(n: number): PathPoints {
  return {x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), a: new Float64Array(n)}
}

/** A row's strength has to change by this much before the row is written again (it lands squared). */
const ALPHA_EPS = 1 / 512

/**
 * A ribbon of light through world points that turns its flat side to the eye at every point (so a
 * path that runs away from the viewer stays a line), with a width and a strength per point. Rebuilt
 * only as far as it has to be: `geometry` when the points, widths or eye have moved, otherwise only
 * the rows whose strength has changed.
 */
export class PathRibbon {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private cr: number[] = []
  private cg: number[] = []
  private cb: number[] = []
  private ca: number[] = []
  private data: number[] = []
  private last: Float64Array
  private level = -1

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private count: number,
    color: vec4
  ) {
    const P = PROFILE.length
    for (const q of PROFILE) {
      const c = lightColor(color, q.k, q.hot)
      this.cr.push(c.x)
      this.cg.push(c.y)
      this.cb.push(c.z)
      this.ca.push(c.w)
    }
    this.last = new Float64Array(count)
    this.mb = newBuilder()
    const data = this.data
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

  /** How strongly the whole ribbon is drawn; at nothing it isn't drawn at all. */
  setLevel(k: number): void {
    if (k === this.level) return
    this.level = k
    this.so.enabled = k > 1e-4
    this.mat.mainPass.baseColor = new vec4(k, k, k, k)
  }

  commit(p: PathPoints, eye: vec3, width: Float64Array, geometry: boolean): void {
    const n = this.count
    const P = PROFILE.length
    const d = this.data
    if (geometry) {
      const ex = eye.x
      const ey = eye.y
      const ez = eye.z
      let psx = 0
      let psy = 1
      let psz = 0
      for (let i = 0; i < n; i++) {
        const a = i > 0 ? i - 1 : 0
        const b = i < n - 1 ? i + 1 : n - 1
        const tx = p.x[b] - p.x[a]
        const ty = p.y[b] - p.y[a]
        const tz = p.z[b] - p.z[a]
        const vx = ex - p.x[i]
        const vy = ey - p.y[i]
        const vz = ez - p.z[i]
        let sx = ty * vz - tz * vy
        let sy = tz * vx - tx * vz
        let sz = tx * vy - ty * vx
        const sl = Math.sqrt(sx * sx + sy * sy + sz * sz)
        if (sl > 1e-6) {
          sx /= sl
          sy /= sl
          sz /= sl
        } else {
          sx = psx
          sy = psy
          sz = psz
        }
        if (i > 0 && sx * psx + sy * psy + sz * psz < 0) {
          sx = -sx
          sy = -sy
          sz = -sz
        }
        psx = sx
        psy = sy
        psz = sz
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
        const nx = vl > 1e-6 ? vx / vl : 0
        const ny = vl > 1e-6 ? vy / vl : 0
        const nz = vl > 1e-6 ? vz / vl : 1
        const w = width[i] / 2
        for (let q = 0; q < P; q++) {
          const o = PROFILE[q].o * w
          const at = (i * P + q) * 10
          d[at] = p.x[i] + sx * o
          d[at + 1] = p.y[i] + sy * o
          d[at + 2] = p.z[i] + sz * o
          d[at + 3] = nx
          d[at + 4] = ny
          d[at + 5] = nz
        }
      }
    }
    const last = this.last
    let changed = geometry
    for (let i = 0; i < n; i++) {
      const k = p.a[i]
      const dk = k - last[i]
      if (dk === 0 || (k !== 0 && dk < ALPHA_EPS && dk > -ALPHA_EPS)) continue
      last[i] = k
      changed = true
      for (let q = 0; q < P; q++) {
        const at = (i * P + q) * 10 + 6
        d[at] = this.cr[q] * k
        d[at + 1] = this.cg[q] * k
        d[at + 2] = this.cb[q] * k
        d[at + 3] = this.ca[q] * k
      }
    }
    if (changed) rewriteVertices(this.mb, d)
  }
}

/**
 * A pool of light lying on a horizontal surface: rings at even fractions of its radius whose
 * strength follows a profile, cut off (and softly faded) at a circle (the table's edge). Written only
 * when one of its inputs changes.
 */
class PoolMesh {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private data: number[] = []
  private lastX = NaN
  private lastY = 0
  private lastZ = 0
  private lastR = 0
  private lastEdge = 0
  private lastClipX = 0
  private lastClipZ = 0
  private lastClipR = 0

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private NR: number,
    private NS: number,
    /** The share of the radius the rings reach (less than 1: the rest is too faint to see). */
    private trim: number = 1
  ) {
    this.mb = newBuilder()
    const data = this.data
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

  /** Lay it at (x, y, z) (world), radius R; `edge` = the soft edge's width as a fraction of R; clipR 0 = no clip circle. */
  update(x: number, y: number, z: number, R: number, edge: number, clipX: number, clipZ: number, clipR: number): void {
    const near = (a: number, b: number) => a - b < 0.005 && b - a < 0.005
    if (near(x, this.lastX) && near(y, this.lastY) && near(z, this.lastZ) && near(R, this.lastR) && near(edge, this.lastEdge) && near(clipX, this.lastClipX) && near(clipZ, this.lastClipZ) && near(clipR, this.lastClipR)) return
    this.lastX = x
    this.lastY = y
    this.lastZ = z
    this.lastR = R
    this.lastEdge = edge
    this.lastClipX = clipX
    this.lastClipZ = clipZ
    this.lastClipR = clipR
    const NR = this.NR
    const NS = this.NS
    const e = Math.max(0.02, Math.min(1, edge))
    const d = this.data
    for (let j = 0; j <= NR; j++) {
      const rho = (j / NR) * this.trim
      // Flat inside, then a smooth cosine falloff over the edge.
      const u = clamp01((rho - (1 - e)) / e)
      // (√I, √I) lands as I (Add with source alpha); the last ring of a trimmed pool is nothing.
      const I = j === NR ? 0 : Math.sqrt(0.5 + 0.5 * Math.cos(Math.PI * u))
      for (let s = 0; s < NS; s++) {
        const a = (s / NS) * Math.PI * 2
        let px = x + Math.cos(a) * rho * R
        let pz = z + Math.sin(a) * rho * R
        let k = I
        if (clipR > 0) {
          const dx = px - clipX
          const dz = pz - clipZ
          const d = Math.sqrt(dx * dx + dz * dz)
          if (d > clipR) {
            px = clipX + (dx / d) * clipR
            pz = clipZ + (dz / d) * clipR
            k = 0
          } else k *= clamp01((clipR - d) / 2)
        }
        const at = (j * NS + s) * 10
        d[at] = px
        d[at + 1] = y
        d[at + 2] = pz
        d[at + 6] = k
        d[at + 7] = k
        d[at + 8] = k
        d[at + 9] = k
      }
    }
    rewriteVertices(this.mb, d)
  }
}

/** Comets in a face's XY plane (photons in the bubble): each a short streak, hot at its head. */
class CometCloud {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private data: number[] = []
  /** How many comets were written last time (those past the new count are cleared once). */
  private drawn = 0
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
    const data = this.data
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

  /** The photons as comets: `coat` is the colour of those the coating has turned, the rest are the chip's blue. */
  update(photons: Photon[], coat: vec3): void {
    const P = PROFILE.length
    const rows = CometCloud.ROWS
    const count = Math.min(this.n, photons.length)
    if (count === 0 && this.drawn === 0) return
    const d = this.data
    const len = 1.3
    const hw = 0.15
    for (let i = 0; i < count; i++) {
      const p = photons[i]
      const r2 = p.x * p.x + (p.y - BOARD_Y) * (p.y - BOARD_Y)
      const a = clamp01(p.age / 0.08) * clamp01((PHOTON_MAX_R - Math.sqrt(r2)) / 1.5)
      const yellow = p.yellow === true
      const cr = (yellow ? coat.x : CHIP_BLUE.x) * a
      const cg = (yellow ? coat.y : CHIP_BLUE.y) * a
      const cb = (yellow ? coat.z : CHIP_BLUE.z) * a
      for (let r = 0; r < rows.length; r++) {
        const u = rows[r].u
        const back = len * (1 - u)
        const hotTip = u > 0.9 ? 0.25 : 0
        for (let q = 0; q < P; q++) {
          const pr = PROFILE[q]
          const at = ((i * rows.length + r) * P + q) * 10
          d[at] = p.x - p.dx * back - p.dy * pr.o * hw
          d[at + 1] = p.y - p.dy * back + p.dx * pr.o * hw
          d[at + 2] = 0.03
          const k = pr.k * rows[r].k
          const hot = pr.hot + hotTip
          d[at + 6] = (cr + (a - cr) * hot) * k
          d[at + 7] = (cg + (a - cg) * hot) * k
          d[at + 8] = (cb + (a - cb) * hot) * k
          d[at + 9] = a * k
        }
      }
    }
    for (let at = count * rows.length * P * 10; at < this.drawn * rows.length * P * 10; at += 10) {
      d[at] = 0
      d[at + 1] = 0
      d[at + 2] = 0
      d[at + 6] = 0
      d[at + 7] = 0
      d[at + 8] = 0
      d[at + 9] = 0
    }
    this.drawn = count
    rewriteVertices(this.mb, d)
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
  private data: number[] = []
  private last = -1
  /** How many times it has been rewritten (the lift changing; the lamp's bob never does it). */
  rewrites = 0
  private static ROWS = 44
  private static SEG = 48

  constructor(parent: SceneObject, name: string, material: Material, pad: number) {
    const R = ShadeGlowMesh.ROWS
    const N = ShadeGlowMesh.SEG
    this.mb = newBuilder()
    const data = this.data
    for (let j = 0; j <= R; j++) {
      const y = G.paperY0 + ((G.paperY1 - G.paperY0) * j) / R
      this.ys.push(y)
      const r = lampShadeR(y) + pad
      for (let s = 0; s <= N; s++) {
        const a = (s / N) * Math.PI * 2
        const n = new vec3(Math.cos(a), 0, Math.sin(a))
        data.push(n.x * r, y, n.z * r, n.x, n.y, n.z, 0, 0, 0, 0)
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
    this.rewrites++
    const N = ShadeGlowMesh.SEG
    const d = this.data
    for (let j = 0; j < this.ys.length; j++) {
      // The material blends Add with source alpha: (√g, √g) lands as g.
      const g = Math.sqrt(shadeGlowLifted(this.ys[j], liftM))
      for (let s = 0; s <= N; s++) {
        const at = (j * (N + 1) + s) * 10 + 6
        d[at] = g
        d[at + 1] = g
        d[at + 2] = g
        d[at + 3] = g
      }
    }
    rewriteVertices(this.mb, d)
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
  private data: number[] = []
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
    const data = this.data
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
    const data = this.data
    for (let i = 0; i < this.dirs.length; i++) {
      const d = this.dirs[i]
      const L = len * this.lens[i] * (0.35 + 0.65 * ext)
      // A faint, slow shimmer along each ray (never dark).
      const tw = 0.82 + 0.18 * Math.sin(t * 2.1 + this.phase[i])
      for (let r = 0; r < rows.length; r++) {
        const along = r0 + L * rows[r].u
        const px = c.x + d.x * along
        const py = c.y + d.y * along
        const pz = c.z + d.z * along
        const vx = eye.x - px
        const vy = eye.y - py
        const vz = eye.z - pz
        let sx = d.y * vz - d.z * vy
        let sy = d.z * vx - d.x * vz
        let sz = d.x * vy - d.y * vx
        const sl = Math.sqrt(sx * sx + sy * sy + sz * sz)
        if (sl > 1e-6) {
          sx /= sl
          sy /= sl
          sz /= sl
        } else {
          sx = 1
          sy = 0
          sz = 0
        }
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
        const nx = vl > 1e-6 ? vx / vl : 0
        const ny = vl > 1e-6 ? vy / vl : 0
        const nz = vl > 1e-6 ? vz / vl : 1
        const w = (0.16 + (0.035 - 0.16) * rows[r].u) * Math.max(1, vl / 90)
        for (let q = 0; q < P; q++) {
          const pr = PROFILE[q]
          const o = pr.o * w
          const at = ((i * rows.length + r) * P + q) * 10
          data[at] = px + sx * o
          data[at + 1] = py + sy * o
          data[at + 2] = pz + sz * o
          data[at + 3] = nx
          data[at + 4] = ny
          data[at + 5] = nz
          // (√I, √I) lands as I.
          const k = Math.sqrt(Math.max(0, rows[r].k * pr.k * tw * ext))
          data[at + 6] = k
          data[at + 7] = k
          data[at + 8] = k
          data[at + 9] = k
        }
      }
    }
    rewriteVertices(this.mb, data)
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

/** A material's colour and level, written only when they change. */
class Tint {
  private x = NaN
  private y = NaN
  private z = NaN
  private w = NaN
  private shown: boolean | null = null
  private v = new vec4(0, 0, 0, 0)

  /** With an object, it is drawn only while it has any light to add (level past 1e-4). */
  constructor(
    readonly mat: Material,
    private so: SceneObject | null = null
  ) {}

  /** As tint(). */
  set(c: vec3, k: number): void {
    const f = Math.sqrt(Math.max(0, k))
    this.write(c.x * f, c.y * f, c.z * f, f)
  }

  /** As setFade(). */
  fade(k: number): void {
    const f = Math.max(0, k)
    this.write(f, f, f, f)
  }

  private write(x: number, y: number, z: number, w: number): void {
    if (x === this.x && y === this.y && z === this.z && w === this.w) return
    if (this.so) {
      const on = w > 0.01
      if (on !== this.shown) {
        this.shown = on
        this.so.enabled = on
      }
    }
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    const v = this.v
    v.x = x
    v.y = y
    v.z = z
    v.w = w
    this.mat.mainPass.baseColor = v
  }
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
  private nodeTr: Transform
  private faceTr: Transform
  private frame: Tint[] = []
  private chipTint: Tint
  private coatTint: Tint
  private whiteTint: Tint
  private cloudTint: Tint
  private cloud: CometCloud
  private clock = new RibbonClock(0.25)
  readonly S: number
  private photons: Photon[] = []
  private spare: Photon[] = []
  private nextId = 0
  private spawnAcc = 0
  private shown: boolean | null = null
  /** Comets have stepped (or the bubble just showed) since they were last drawn. */
  private dirty = true
  private drawnOpen = -1
  private drawnLed = new vec3(0, 0, 0)
  private drawnEye = new vec3(0, 0, 0)
  private drawnSide = 0
  private drawnR = 0
  private scaleV = new vec3(1, 1, 1)
  private posV = new vec3(0, 0, 0)
  private dirV = new vec3(0, 0, 1)
  blue = 0
  yellowN = 0
  chipShown = false
  /** The bubble's centre and rim radius now (world). */
  discX = 0
  discY = 0
  discZ = 0
  discR = 0
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
    this.nodeTr = this.node.getTransform()
    this.nodeTr.setWorldPosition(led)
    this.nodeTr.setLocalScale(vec3.one().uniformScale(1e-4))
    this.face = global.scene.createSceneObject("LampBubbleFace")
    this.face.setParent(this.node)
    this.faceTr = this.face.getTransform()
    this.faceTr.setLocalScale(vec3.one().uniformScale(this.S))
    // Frame: thin double rim and a faint inner glow (as the other bubbles).
    const fk = new MeshKit()
    fk.addArcXY(0, 0, BR, 0.2, 0, Math.PI * 2, ink(INK, 0.85), 96)
    fk.addArcXY(0, 0, BR - 0.55, 0.1, 0, Math.PI * 2, ink(INK, 0.4), 96)
    fk.addFanXY(0, 0, 8, 0, Math.PI * 2, ink(INK, 0.02), ink(INK, 0.03), 48)
    fk.addSoftRingXY(0, 0, 8, BR - 0.6, ink(INK, 0.03), ink(INK, 0.1), 64)
    this.frame.push(this.glow("LampBubbleFrame", fk))
    // The LED board and the chip on it (structure).
    const bk = new MeshKit(STRUCT_GLOW)
    bk.addLineXY(-9.6, BOARD_Y, 9.6, BOARD_Y, 0.16, ink(INK, 0.45))
    bk.addPolylineXY([new vec2(-CHIP_HW, BOARD_Y), new vec2(-CHIP_HW, CHIP_TOP), new vec2(CHIP_HW, CHIP_TOP), new vec2(CHIP_HW, BOARD_Y)], 0.14, ink(INK, 0.8))
    this.frame.push(this.glow("LampBubbleBoard", bk))
    // The chip's blue glow (lit with the LED).
    const ck = new MeshKit()
    ck.addRectXY(-CHIP_HW + 0.08, BOARD_Y + 0.06, CHIP_HW - 0.08, CHIP_TOP - 0.06, ink(INK, 0.9))
    ck.addFanXY(0, CHIP_TOP - 0.4, 2.6, 0, Math.PI * 2, ink(INK, 0.35), ZERO, 32)
    this.chipTint = this.glow("LampBubbleChip", ck)
    // The phosphor coating over the chip: a dome, filled faintly, its edge brighter.
    const ok = new MeshKit()
    ok.addFanXY(0, BOARD_Y, COAT_R, 0, Math.PI, ink(INK, 0.2), ink(INK, 0.12), 40)
    ok.addArcXY(0, BOARD_Y, COAT_R, 0.14, 0, Math.PI, ink(INK, 0.75), 40)
    this.coatTint = this.glow("LampBubbleCoating", ok)
    // Together they come out white: the light leaving the coating fills the upper bubble.
    const wk = new MeshKit()
    wk.addFanXY(0, BOARD_Y, PHOTON_MAX_R + 0.3, (22 * Math.PI) / 180, (158 * Math.PI) / 180, ZERO, ink(INK, 0.5), 48)
    this.whiteTint = this.glow("LampBubbleWhite", wk)
    this.cloud = new CometCloud(this.face, "LampBubblePhotons", glowMat, PHOTONS)
    this.cloudTint = new Tint(this.cloud.mat)
    // The hairline from the rim to the chips is drawn at no level at all, so it is never drawn.
    const leader = new PathRibbon(parent, "LampBubbleLeader", glowMat, 8, ink(INK, 0.55))
    leader.setLevel(0)
    for (const t of this.frame) t.fade(0)
    this.chipTint.fade(0)
    this.coatTint.fade(0)
    this.whiteTint.fade(0)
    this.cloudTint.fade(0)
  }

  private glow(name: string, kit: MeshKit): Tint {
    const s = spawnMesh(this.face, name, kit.build(), this.glowMat)
    s.mat.mainPass.twoSided = true
    s.rmv.setRenderOrder(ORDER + 2)
    return new Tint(s.mat)
  }

  /**
   * `open` 0..1, `led` the LED's level, `share` the coating's yellow share, `color` the lamp's
   * colour; `ledTr` the LED board; `side` = the user's right (+1) or left (−1) of the copy; `shadeR`
   * the shade's radius there (world). The photons fly every frame; closed, nothing is drawn.
   */
  update(dt: number, now: number, open: number, led: number, b: number, share: number, coat: vec3, color: vec3, ledTr: Transform, cam: vec3, side: number, shadeR: number): void {
    this.coatColor = coat
    this.fly(dt, led * open, b, share)
    const on = open > 0
    if (on !== this.shown) {
      this.shown = on
      this.node.enabled = on
      this.dirty = true
    }
    this.chipShown = open > 0.5
    if (!on) {
      if (this.drawnOpen !== 0) {
        this.drawnOpen = 0
        this.discR = BR * this.S * 1e-4
      }
      return
    }
    this.place(open, ledTr, cam, side, shadeR)
    for (let i = 0; i < this.frame.length; i++) this.frame[i].fade(open)
    const lit = open * led
    this.chipTint.set(CHIP_BLUE_RGB, lit)
    // The coating reads more yellow (fuller) as more of the blue is converted.
    const coatK = open * (0.35 + 0.65 * led) * (0.4 + 0.6 * clamp01((share - 0.5) / 0.4))
    this.coatTint.set(coat, coatK)
    this.whiteTint.set(color, lit)
    this.cloudTint.fade(open)
    if (dt > 0) this.dirty = true
    if (this.clock.due(now) && this.dirty) {
      this.dirty = false
      this.cloud.update(this.photons, coat)
    }
  }

  /** Photons: blue from the chip; at the coating each turns yellow with the coating's share. */
  private fly(dt: number, lit: number, b: number, share: number): void {
    const list = this.photons
    if (dt > 0) {
      if (lit > 0.4) this.spawnAcc += dt * PHOTON_RATE * b
      while (this.spawnAcc >= 1 && list.length < PHOTONS) {
        this.spawnAcc -= 1
        const id = this.nextId++
        const ang = (hash01(id * 3 + 1) * 2 - 1) * ((62 * Math.PI) / 180)
        const p = this.spare.length > 0 ? (this.spare.pop() as Photon) : {id: 0, x: 0, y: 0, dx: 0, dy: 0, age: 0, yellow: null}
        p.id = id
        p.x = (hash01(id * 3 + 2) - 0.5) * 2 * (CHIP_HW - 0.3)
        p.y = CHIP_TOP + 0.05
        p.dx = Math.sin(ang)
        p.dy = Math.cos(ang)
        p.age = 0
        p.yellow = null
        list.push(p)
      }
      if (this.spawnAcc >= 1) this.spawnAcc = 0
      let keep = 0
      for (let i = 0; i < list.length; i++) {
        const p = list[i]
        p.x += p.dx * PHOTON_V * dt
        p.y += p.dy * PHOTON_V * dt
        p.age += dt
        const y = p.y - BOARD_Y
        const r2 = p.x * p.x + y * y
        if (p.yellow === null && r2 >= COAT_R * COAT_R) p.yellow = hash01(p.id * 7 + 5) < share
        if (r2 < PHOTON_MAX_R * PHOTON_MAX_R) list[keep++] = p
        else this.spare.push(p)
      }
      list.length = keep
    }
    let yellow = 0
    for (let i = 0; i < list.length; i++) if (list[i].yellow === true) yellow++
    this.yellowN = yellow
    this.blue = list.length - yellow
  }

  /** Only as far as something moved: the bubble opens beside the chips and turns to the eye. */
  private place(open: number, ledTr: Transform, cam: vec3, side: number, shadeR: number): void {
    const led = ledTr.getWorldTransform().multiplyPoint(ROW_LED)
    const dl = this.drawnLed
    const de = this.drawnEye
    const same = (a: number, b: number, eps: number) => a - b < eps && b - a < eps
    if (open === this.drawnOpen && side === this.drawnSide && same(shadeR, this.drawnR, MOVE_EPS) && same(led.x, dl.x, MOVE_EPS) && same(led.y, dl.y, MOVE_EPS) && same(led.z, dl.z, MOVE_EPS) && same(cam.x, de.x, FACE_EPS) && same(cam.y, de.y, FACE_EPS) && same(cam.z, de.z, FACE_EPS)) return
    this.drawnOpen = open
    this.drawnSide = side
    this.drawnR = shadeR
    dl.x = led.x
    dl.y = led.y
    dl.z = led.z
    de.x = cam.x
    de.y = cam.y
    de.z = cam.z
    let tx = cam.x - led.x
    let tz = cam.z - led.z
    const tl = Math.sqrt(tx * tx + tz * tz)
    if (tl > 1e-4) {
      tx /= tl
      tz /= tl
    } else {
      tx = 0
      tz = 1
    }
    const RS = BR * this.S
    // The user's right: (−toUser) × up.
    const out = side * (shadeR + RS + 4)
    const x = led.x + (tz * out + tx * 5 - 0) * open
    const y = led.y + (RS * 0.35 + 3) * open
    const z = led.z + (-tx * out + tz * 5) * open
    const k = Math.max(1e-4, open)
    this.scaleV.x = k
    this.scaleV.y = k
    this.scaleV.z = k
    this.nodeTr.setLocalScale(this.scaleV)
    this.posV.x = x
    this.posV.y = y
    this.posV.z = z
    this.nodeTr.setWorldPosition(this.posV)
    this.dirV.x = cam.x - x
    this.dirV.y = cam.y - y
    this.dirV.z = cam.z - z
    this.faceTr.setWorldRotation(faceToward(this.dirV))
    this.discX = x
    this.discY = y
    this.discZ = z
    this.discR = RS * k
  }

  get count(): number {
    return this.photons.length
  }

  /** The colour of the white light leaving the coating (the lamp's colour). */
  whiteColor(): vec3 {
    return tintOf(this.whiteTint.mat)
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

/** What the light is drawn with: made when it comes on, destroyed when it goes dark. */
interface LampGraphics {
  core: PathRibbon
  halo: PathRibbon
  shadeMesh: ShadeGlowMesh
  shade: Tint
  point: SceneObject
  pointTint: Tint
  rays: RayBurst
  raysTint: Tint
  tablePool: PoolMesh
  table: Tint
  threadCore: PathRibbon
  threadHalo: PathRibbon
  real: Tint
  realBloom: SceneObject
  realBloomTint: Tint
  floorPool: PoolMesh
  floor: Tint
}

export class LampLight {
  phase: LightPhase = "off"
  private times: LampLightTimes = {on: -1, bulb: -1, realOn: -1, off: -1, dark: -1}
  private root: SceneObject | null = null
  private g: LampGraphics | null = null
  private bubble: LedBubble | null = null
  private shadeGlow: SceneObject | null = null
  private t = 0
  private tFade = -1
  private tBulb = -1
  private tThread = -1
  private tReal = -1
  private captionGlow = false
  // The current's path (model space at rest), its cumulative length and the radius it runs on.
  private pathN = 0
  private pathX = new Float64Array(0)
  private pathY = new Float64Array(0)
  private pathZ = new Float64Array(0)
  private cum = new Float64Array(0)
  private radius = new Float64Array(0)
  private Lm = 0
  private current: PathPoints = pathPoints(0)
  private wCore = new Float64Array(0)
  private wHalo = new Float64Array(0)
  private drawnM = new Float64Array(12)
  private drawnEye = new vec3(0, 0, 0)
  private drawnS = 0
  private currentDrawn = false
  // The thread (world), its length and widths; what it was last laid out from.
  private thread: PathPoints = pathPoints(THREAD_N)
  private threadCum = new Float64Array(THREAD_N)
  private wThread = new Float64Array(THREAD_N)
  private wThreadHalo = new Float64Array(THREAD_N)
  private Lt = 0
  /** The first thread point inside the real lamp's shade. */
  private threadInside = 1e9
  private threadKey = new Float64Array(9)
  private threadEye = new vec3(0, 0, 0)
  private threadLaid = false
  /** The path has moved since it was last drawn. */
  private threadMoved = true
  private threadDrawn = false
  private bloomEye = new vec3(0, 0, 0)
  private bloomPlaced = false
  private pointDrawn = new Float64Array(6)
  private pointPlaced = false
  private drawnWhole = -1
  private drawnPointS = 0
  private raysShown = false
  private tableShown = false
  private floorShown = false
  private originX = 0
  private originY = 0
  private originZ = 0
  // The clocks are half a beat apart so the ribbons don't all land on one frame.
  private currentClock = new RibbonClock(0)
  private threadClock = new RibbonClock(0.5)
  private raysClock = new RibbonClock(0.75)
  private poolClock = new RibbonClock(0.125)
  private glassTr: Transform | null = null
  private ledTr: Transform | null = null
  private glassLocal = vec3.zero()
  private shadeRAtLed = 0
  private bulbV = new vec3(0, 0, 0)
  private posV = new vec3(0, 0, 0)
  private dirV = new vec3(0, 0, 1)
  private scaleV = new vec3(1, 1, 1)
  private kelvin = -1
  private color = vec3.one()
  private share = 0
  private coat = vec3.one()
  private sentLed = 0
  private sentColor: vec3 | null = null
  /** At least one frame has run since it came on: getInfo() reads what that frame worked out. */
  private ran = false
  private f = {b: 0, L: 0, front: 0, spacing: 0, vPkt: 0, head: 0, pulseLevel: 0, led: 0, open: 0, shade: 0, whole: 1, lift: 0, liftM: 0, rays: 0, raysExt: 0, point: 0, poolLevel: 0, poolR: POOL_R, poolEdge: 0.9, tf: 0, threadLevel: 0, real: 0}
  private empty: LampLightInfo = this.emptyInfo()

  constructor(private ctx: LampLightCtx) {}

  /** On (or coming on). */
  get isOn(): boolean {
    return this.phase === "flow" || this.phase === "lit"
  }

  get isOff(): boolean {
    return this.phase === "off"
  }

  /** The LED's level now (× Brightness). */
  get ledLevel(): number {
    return this.ran ? this.f.led : 0
  }

  /** Read-only state, worked out when asked for (the frames don't need it). */
  getInfo(): LampLightInfo {
    if (!this.ran || !this.g) return this.empty
    const f = this.f
    const g = this.g
    const cam = this.ctx.camPos()
    const S = this.ctx.scale()
    const M = this.ctx.replica.getTransform().getWorldTransform()
    const last = this.pathN - 1
    const packets: vec3[] = []
    // Packet centres: the heads that are on the path behind the front.
    for (let n = Math.ceil((f.head - f.front) / f.spacing); n * f.spacing <= f.head; n++) {
      const s = f.head - n * f.spacing
      if (s < 0 || s > f.front) continue
      packets.push(this.pointAt(M, cam, S, s / S))
    }
    const liftM = f.liftM
    const n = THREAD_N - 1
    const th = this.thread
    return {
      phase: this.phase,
      brightness: f.b,
      kelvin: this.kelvin,
      color: this.color,
      front: f.L > 0 ? f.front / f.L : 0,
      pathStart: this.currentPoint(M, cam, S, 0),
      pathEnd: this.currentPoint(M, cam, S, last),
      pathLength: f.L,
      packets,
      pulseLevel: f.pulseLevel,
      pulseSpacing: f.spacing,
      pulseRate: f.vPkt / f.spacing,
      led: f.led,
      bubbleOpen: f.open,
      chipShown: !!this.bubble && this.bubble.chipShown,
      chipColor: new vec3(CHIP_BLUE.x, CHIP_BLUE.y, CHIP_BLUE.z),
      photonsBlue: this.bubble ? this.bubble.blue : 0,
      photonsYellow: this.bubble ? this.bubble.yellowN : 0,
      coatingShare: this.share,
      coatColor: this.coat,
      bubbleColor: this.bubble ? this.bubble.whiteColor() : vec3.zero(),
      shadeGlow: f.shade * f.whole,
      shadeProfile: {
        mid: shadeGlowLifted(paperRow(GLOW_CENTRE_Y - liftM), liftM),
        bulb: shadeGlowLifted(paperRow(G.bulbCenterY - liftM), liftM),
        top: shadeGlowLifted(G.paperY1, liftM),
        bottom: shadeGlowLifted(G.paperY0, liftM)
      },
      shadePeak: g.shadeMesh.peak(),
      lift: f.lift,
      rays: f.rays,
      raysExtent: f.raysExt,
      bulbPoint: f.point,
      miniColor: tintOf(g.shade.mat),
      tablePool: {level: f.poolLevel, radius: f.poolR, edge: f.poolEdge},
      poolColor: tintOf(g.table.mat),
      threadFront: this.Lt > 0 ? f.tf / this.Lt : 0,
      threadLevel: f.threadLevel,
      threadStart: new vec3(th.x[0], th.y[0], th.z[0]),
      threadEnd: new vec3(th.x[n], th.y[n], th.z[n]),
      threadReached: this.tReal >= 0,
      realGlow: f.real,
      realColor: tintOf(g.real.mat),
      floorPool: f.real,
      floorColor: tintOf(g.floor.mat)
    }
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
    this.g = null
    this.bubble = null
    this.glassTr = null
    this.ledTr = null
    this.ran = false
    this.currentDrawn = false
    this.threadLaid = false
    this.threadDrawn = false
    this.threadMoved = true
    this.bloomPlaced = false
    this.pointPlaced = false
    this.raysShown = false
    this.tableShown = false
    this.floorShown = false
    const was = this.phase
    this.phase = "off"
    this.ctx.setBulbGlow(0, vec3.one())
    this.sentLed = 0
    this.sentColor = null
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
    const model = this.ctx.model
    // The current's path, resampled to about 1 cm (model), with the radius of what it runs along.
    const raw = model.currentPath()
    const path: vec3[] = [raw[0]]
    for (let i = 1; i < raw.length; i++) {
      const a = raw[i - 1]
      const b = raw[i]
      const n = Math.max(1, Math.ceil(a.distance(b) / 1.0))
      for (let k = 1; k <= n; k++) path.push(vec3.lerp(a, b, k / n))
    }
    const N = path.length
    this.pathN = N
    this.pathX = new Float64Array(N)
    this.pathY = new Float64Array(N)
    this.pathZ = new Float64Array(N)
    this.cum = new Float64Array(N)
    this.radius = new Float64Array(N)
    this.wCore = new Float64Array(N)
    this.wHalo = new Float64Array(N)
    this.current = pathPoints(N)
    for (let i = 0; i < N; i++) {
      const p = path[i]
      this.pathX[i] = p.x
      this.pathY[i] = p.y
      this.pathZ[i] = p.z
      if (i > 0) this.cum[i] = this.cum[i - 1] + p.distance(path[i - 1])
      this.radius[i] = p.y < 3 ? G.cordR : p.y < G.socketY ? G.stemR : 0.3
      this.wCore[i] = 0.32
      this.wHalo[i] = 1.3
    }
    this.Lm = this.cum[N - 1]
    const halo = new PathRibbon(root, "LampCurrentGlow", glow, N, ink(SIGNAL, 0.24))
    const core = new PathRibbon(root, "LampCurrent", glow, N, ink(SIGNAL, 1))
    // The shade's glow: a lathe just outside the paper, under the paper part (it lifts with it, so the
    // lamp's bob carries it and only the lift itself rewrites it).
    const paper = model.parts["LampPaper"]
    const piv = model.pivot("LampPaper")
    const shadeMesh = new ShadeGlowMesh(paper, "LampShadeGlow", glow, 0.18)
    shadeMesh.so.getTransform().setLocalPosition(piv.uniformScale(-1))
    this.shadeGlow = shadeMesh.so
    // The bare bulb's point of light (hidden by the paper while the shade is on) and its rays.
    const bk = new MeshKit(1.5)
    bk.addSparkXY(0, 0, 0.5, ink(INK, 1), 24)
    const bl = spawnMesh(root, "LampBulbPoint", bk.build(), glow)
    bl.rmv.setRenderOrder(ORDER)
    const rays = new RayBurst(root, "LampRays", glow)
    const tablePool = new PoolMesh(root, "LampTablePool", glow, 26, 64)
    // The thread and the real lamp.
    const threadHalo = new PathRibbon(root, "LampThreadGlow", glow, THREAD_N, ink(SIGNAL, 0.22))
    const threadCore = new PathRibbon(root, "LampThread", glow, THREAD_N, ink(SIGNAL, 1))
    const rg = spawnMesh(root, "LampRealGlow", shadeGlowKit(0.9, 24, 40).build(), glow, this.ctx.realOrigin())
    rg.mat.mainPass.twoSided = true
    rg.rmv.setRenderOrder(ORDER)
    // The real lamp's bloom stops where it is too faint to see.
    const sk = new MeshKit()
    sk.addFanXY(0, 0, 0.45, 0, Math.PI * 2, ink(INK, 1), ink(INK, 0.5), 24)
    sk.addSoftRingXY(0, 0, 0.45, BLOOM_EDGE, ink(INK, 0.5), ink(INK, (0.5 * (1 - BLOOM_EDGE)) / 0.55), 24)
    const rb = spawnMesh(root, "LampRealBloom", sk.build(), glow)
    rb.mat.mainPass.twoSided = true
    rb.rmv.setRenderOrder(ORDER + 1)
    rb.so.getTransform().setWorldScale(new vec3(42, 105, 1))
    const floorPool = new PoolMesh(root, "LampFloorPool", glow, 14, 40, FLOOR_POOL_TRIM)
    this.g = {
      core,
      halo,
      shadeMesh,
      shade: new Tint(shadeMesh.mat, shadeMesh.so),
      point: bl.so,
      pointTint: new Tint(bl.mat, bl.so),
      rays,
      raysTint: new Tint(rays.mat),
      tablePool,
      table: new Tint(tablePool.mat, tablePool.so),
      threadCore,
      threadHalo,
      real: new Tint(rg.mat, rg.so),
      realBloom: rb.so,
      realBloomTint: new Tint(rb.mat, rb.so),
      floorPool,
      floor: new Tint(floorPool.mat, floorPool.so)
    }
    const g = this.g
    core.setLevel(0)
    halo.setLevel(0)
    threadCore.setLevel(0)
    threadHalo.setLevel(0)
    g.shade.fade(0)
    g.pointTint.fade(0)
    g.raysTint.fade(0)
    rays.so.enabled = false
    g.table.fade(0)
    g.real.fade(0)
    g.realBloomTint.fade(0)
    g.floor.fade(0)
    this.glassTr = model.parts["LampBulbGlass"].getTransform()
    this.glassLocal = new vec3(0, G.bulbCenterY - model.pivot("LampBulbGlass").y, 0)
    this.ledTr = model.parts["LampLedBoard"].getTransform()
    this.shadeRAtLed = lampShadeR(G.ledY)
    this.layThread(this.ctx.camPos())
  }

  // =====================================================================================
  // Per frame
  // =====================================================================================

  update(dt: number, p: LampLightParams): void {
    if (this.phase === "off" || !this.root || !this.g) return
    this.t += dt
    let env = 1
    if (this.phase === "fading") {
      env = 1 - clamp01((this.t - this.tFade) / FADE_S)
      if (env <= 0) {
        this.clear()
        return
      }
    }
    const g = this.g
    const f = this.f
    const b = clamp01(p.brightness)
    // Brightness 0 looks the same as off.
    const vis = easeInOut(b / 0.06)
    // Lifted off the table or taken apart: the current on the cord, the shade's glow, the pool, the
    // rays and the bubble belong to the whole lamp standing there, so they fade (the bulb stays lit).
    const whole = 1 - easeInOut(clamp01(p.apart / 0.15))
    if (p.kelvin !== this.kelvin) {
      this.kelvin = p.kelvin
      this.color = kelvinToRgb(p.kelvin)
      this.share = coatingShare(p.kelvin)
      this.coat = coatingColor(p.kelvin)
    }
    const color = this.color
    const cam = this.ctx.camPos()
    const S = this.ctx.scale()
    const now = getTime()
    const tLive = this.tFade >= 0 ? this.tFade : this.t

    // ---------------- The current along the cord and the stem ----------------
    const L = this.Lm * S
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
    const pulseLevel = env * vis * whole
    g.core.setLevel(pulseLevel)
    g.halo.setLevel(pulseLevel)
    const currentDue = this.currentClock.due(now)
    if (pulseLevel > 1e-4 && (currentDue || !this.currentDrawn)) this.drawCurrent(g, cam, S, head, front, L, spacing, b)

    // ---------------- The bulb, the shade, the pool on the table ----------------
    const ledRamp = lit ? easeOutCubic((this.t - this.tBulb) / BULB_RAMP) : 0
    const led = ledRamp * b * env
    if (led !== this.sentLed || color !== this.sentColor) {
      this.sentLed = led
      this.sentColor = color
      this.ctx.setBulbGlow(led, color)
    }
    const glowRamp = lit ? easeOutCubic((this.t - this.tBulb) / GLOW_RAMP) : 0
    const shade = glowRamp * b * env
    // The shade's lift: the paper moves away from the bulb (its glow falls and moves down to the
    // bottom edge); the bare bulb shows as a small bright point and, above RAYS_FROM, sharp rays.
    const lift = clamp01(p.lift)
    const liftM = (lift * SHADE_LIFT_CM) / Math.max(1e-3, S)
    g.shadeMesh.update(liftM)
    g.shade.set(color, shade * SHADE_GAIN * whole)
    const point = led * (1 + 0.5 * lift)
    const raysExt = easeInOut(clamp01((lift - RAYS_FROM) / (1 - RAYS_FROM)))
    const rays = raysExt * led * whole
    // The bulb's centre (the envelope's, where its parts really are) and, taken apart, the bare chips.
    if (point > 1e-4) this.placePoint(g, cam, S, whole)
    g.pointTint.set(color, point)
    g.raysTint.set(color, rays * RAYS_GAIN)
    const raysOn = rays > 1e-4
    if (raysOn !== this.raysShown) g.rays.so.enabled = raysOn
    if (raysOn && (this.raysClock.due(now) || !this.raysShown)) g.rays.update(this.bulbV, G.bulbR * S + 0.08, RAY_LEN, cam, raysExt, this.t)
    this.raysShown = raysOn
    const poolR = POOL_R + (POOL_R_BARE - POOL_R) * lift
    const poolEdge = 0.9 + (0.12 - 0.9) * lift
    const poolLevel = glowRamp * b * env * (1 + 0.8 * lift) * whole
    const poolDue = this.poolClock.due(now)
    const tableOn = poolLevel * POOL_GAIN > 1e-4
    if (tableOn && (poolDue || !this.tableShown)) {
      const s = this.ctx.surface()
      const foot = this.ctx.foot()
      g.tablePool.update(foot.x, s.height + 0.12, foot.z, poolR, poolEdge, s.center.x, s.center.z, Math.max(5, s.radius - 0.5))
    }
    this.tableShown = tableOn
    g.table.set(color, poolLevel * POOL_GAIN)

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
    if (this.bubble && this.ledTr) this.bubble.update(this.phase === "fading" ? 0 : dt, now, open, ledRamp, b, this.share, this.coat, color, this.ledTr, cam, this.ctx.bubbleSide(), this.shadeRAtLed * S)
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
    const threadDue = this.threadClock.due(now)
    if (threadDue) this.layThread(cam)
    const Lt = this.Lt
    const tf = this.tThread >= 0 ? Math.min(Lt, V_THREAD * ((this.tFade >= 0 ? this.tFade : this.t) - this.tThread)) : 0
    if (this.tThread >= 0 && this.tReal < 0 && tf >= Lt - 1e-3 && this.phase === "lit") {
      this.tReal = this.t
      this.times.realOn = getTime()
      this.ctx.log("lamp:realOn")
    }
    const threadLevel = env * vis
    const threadOn = this.tThread >= 0 && threadLevel > 1e-4
    g.threadCore.setLevel(threadOn ? threadLevel : 0)
    g.threadHalo.setLevel(threadOn ? threadLevel : 0)
    if (threadOn && (threadDue || !this.threadDrawn)) this.drawThread(g, cam, tf, Lt, b)
    const realRamp = this.tReal >= 0 ? easeOutCubic((this.t - this.tReal) / REAL_RAMP) : 0
    const real = realRamp * b * env
    g.real.set(color, real * REAL_GAIN)
    g.realBloomTint.set(color, real * BLOOM_GAIN)
    const floorOn = real * FLOOR_GAIN > 1e-4
    if (real > 1e-4 && (threadDue || !this.bloomPlaced)) this.placeBloom(g, cam)
    if (floorOn && (threadDue || !this.floorShown)) g.floorPool.update(this.originX, this.originY + 0.6, this.originZ, FLOOR_POOL_R, 0.85, 0, 0, 0)
    this.floorShown = floorOn
    g.floor.set(color, real * FLOOR_GAIN)

    // ---------------- For getInfo() ----------------
    f.b = b
    f.L = L
    f.front = front
    f.spacing = spacing
    f.vPkt = vPkt
    f.head = head
    f.pulseLevel = pulseLevel
    f.led = led
    f.open = open
    f.shade = shade
    f.whole = whole
    f.lift = lift
    f.liftM = liftM
    f.rays = rays
    f.raysExt = raysExt
    f.point = point
    f.poolLevel = poolLevel
    f.poolR = poolR
    f.poolEdge = poolEdge
    f.tf = tf
    f.threadLevel = threadLevel
    f.real = real
    this.ran = true
  }

  /** The current's points are laid again only when the copy or the eye has moved; its packets run on them. */
  private drawCurrent(g: LampGraphics, cam: vec3, S: number, head: number, front: number, L: number, spacing: number, b: number): void {
    const P = this.current
    const N = this.pathN
    const cum = this.cum
    const M = this.ctx.replica.getTransform().getWorldTransform()
    const c0 = M.column0
    const c1 = M.column1
    const c2 = M.column2
    const c3 = M.column3
    const dm = this.drawnM
    const e = this.drawnEye
    const near = (a: number, c: number, eps: number) => a - c < eps && c - a < eps
    const geometry =
      !this.currentDrawn ||
      S !== this.drawnS ||
      !near(cam.x, e.x, EYE_EPS) ||
      !near(cam.y, e.y, EYE_EPS) ||
      !near(cam.z, e.z, EYE_EPS) ||
      !near(c3.x, dm[9], MOVE_EPS) ||
      !near(c3.y, dm[10], MOVE_EPS) ||
      !near(c3.z, dm[11], MOVE_EPS) ||
      !near(c0.x, dm[0], 1e-4) ||
      !near(c0.y, dm[1], 1e-4) ||
      !near(c0.z, dm[2], 1e-4) ||
      !near(c1.x, dm[3], 1e-4) ||
      !near(c1.y, dm[4], 1e-4) ||
      !near(c1.z, dm[5], 1e-4) ||
      !near(c2.x, dm[6], 1e-4) ||
      !near(c2.y, dm[7], 1e-4) ||
      !near(c2.z, dm[8], 1e-4)
    if (geometry) {
      this.drawnS = S
      e.x = cam.x
      e.y = cam.y
      e.z = cam.z
      dm[0] = c0.x
      dm[1] = c0.y
      dm[2] = c0.z
      dm[3] = c1.x
      dm[4] = c1.y
      dm[5] = c1.z
      dm[6] = c2.x
      dm[7] = c2.y
      dm[8] = c2.z
      dm[9] = c3.x
      dm[10] = c3.y
      dm[11] = c3.z
      for (let i = 0; i < N; i++) {
        const mx = this.pathX[i]
        const my = this.pathY[i]
        const mz = this.pathZ[i]
        const wx = c0.x * mx + c1.x * my + c2.x * mz + c3.x
        const wy = c0.y * mx + c1.y * my + c2.y * mz + c3.y
        const wz = c0.z * mx + c1.z * my + c2.z * mz + c3.z
        const dx = cam.x - wx
        const dy = cam.y - wy
        const dz = cam.z - wz
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
        const off = dl > 1e-9 ? (this.radius[i] * S + 0.04) / dl : 0
        P.x[i] = wx + dx * off
        P.y[i] = wy + dy * off
        P.z[i] = wz + dz * off
      }
    }
    const boost = clamp01(b * 1.5)
    for (let i = 0; i < N; i++) {
      const s = cum[i] * S
      let a = 0
      if (s <= front) {
        // Charged line behind the front, packets on it (each brightest at its head), the front's head.
        const ph = (head - s) / spacing
        const u = ((ph - Math.floor(ph)) * spacing) / PACKET_LEN
        const pk = u <= 1 ? Math.pow(1 - u, 1.3) : 0
        const fr = front < L ? clamp01(1 - (front - s) / PACKET_LEN) : 0
        a = 0.28 + 0.72 * Math.max(pk * boost, fr)
        a *= clamp01((L - s) / 1.2) * 0.85 + 0.15
      }
      P.a[i] = a
    }
    g.core.commit(P, cam, this.wCore, geometry)
    g.halo.commit(P, cam, this.wHalo, geometry)
    this.currentDrawn = true
  }

  /** The bare bulb's point of light, placed only when the bulb or the eye has moved. */
  private placePoint(g: LampGraphics, cam: vec3, S: number, whole: number): void {
    if (!this.glassTr || !this.ledTr) return
    let x = 0
    let y = 0
    let z = 0
    if (whole > 0) {
      const w = this.glassTr.getWorldTransform().multiplyPoint(this.glassLocal)
      x = w.x * whole
      y = w.y * whole
      z = w.z * whole
    }
    if (whole < 1) {
      const w = this.ledTr.getWorldTransform().multiplyPoint(ROW_LED)
      x += w.x * (1 - whole)
      y += w.y * (1 - whole)
      z += w.z * (1 - whole)
    }
    const d = this.pointDrawn
    const near = (a: number, c: number, eps: number) => a - c < eps && c - a < eps
    this.bulbV.x = x
    this.bulbV.y = y
    this.bulbV.z = z
    if (this.pointPlaced && near(x, d[0], 0.005) && near(y, d[1], 0.005) && near(z, d[2], 0.005) && near(cam.x, d[3], FACE_EPS) && near(cam.y, d[4], FACE_EPS) && near(cam.z, d[5], FACE_EPS) && whole === this.drawnWhole && S === this.drawnPointS) return
    d[0] = x
    d[1] = y
    d[2] = z
    d[3] = cam.x
    d[4] = cam.y
    d[5] = cam.z
    this.drawnWhole = whole
    let dx = cam.x - x
    let dy = cam.y - y
    let dz = cam.z - z
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (l > 1e-9) {
      dx /= l
      dy /= l
      dz /= l
    }
    const out = (G.bulbR * whole + 0.3 * (1 - whole)) * S + 0.25
    const tr = g.point.getTransform()
    this.posV.x = x + dx * out
    this.posV.y = y + dy * out
    this.posV.z = z + dz * out
    tr.setWorldPosition(this.posV)
    this.dirV.x = dx
    this.dirV.y = dy
    this.dirV.z = dz
    tr.setWorldRotation(faceToward(this.dirV))
    if (S !== this.drawnPointS || !this.pointPlaced) {
      const k = S * 2.2
      this.scaleV.x = k
      this.scaleV.y = k
      this.scaleV.z = k
      tr.setWorldScale(this.scaleV)
      this.drawnPointS = S
    }
    this.pointPlaced = true
  }

  /** The real lamp's bloom stands between its shade and the eye. */
  private placeBloom(g: LampGraphics, cam: vec3): void {
    const e = this.bloomEye
    const near = (a: number, c: number) => a - c < FACE_EPS && c - a < FACE_EPS
    if (this.bloomPlaced && near(cam.x, e.x) && near(cam.y, e.y) && near(cam.z, e.z)) return
    e.x = cam.x
    e.y = cam.y
    e.z = cam.z
    this.bloomPlaced = true
    const cy = this.originY + GLOW_CENTRE_Y
    let tx = cam.x - this.originX
    let tz = cam.z - this.originZ
    const tl = Math.sqrt(tx * tx + tz * tz)
    if (tl > 1e-4) {
      tx /= tl
      tz /= tl
    } else {
      tx = 0
      tz = 1
    }
    const tr = g.realBloom.getTransform()
    this.posV.x = this.originX + tx * (G.shadeMaxR + 2)
    this.posV.y = cy
    this.posV.z = this.originZ + tz * (G.shadeMaxR + 2)
    tr.setWorldPosition(this.posV)
    this.dirV.x = tx
    this.dirV.y = 0
    this.dirV.z = tz
    tr.setWorldRotation(yawToward(this.dirV))
  }

  /** A point on the (camera-offset) current path, as it is now. */
  private currentPoint(M: mat4, cam: vec3, S: number, i: number): vec3 {
    const w = M.multiplyPoint(new vec3(this.pathX[i], this.pathY[i], this.pathZ[i]))
    return w.add(cam.sub(w).normalize().uniformScale(this.radius[i] * S + 0.04))
  }

  /** A point on the (camera-offset) current path at model arc length sm. */
  private pointAt(M: mat4, cam: vec3, S: number, sm: number): vec3 {
    const cum = this.cum
    for (let i = 1; i < this.pathN; i++) {
      if (cum[i] >= sm) {
        const seg = cum[i] - cum[i - 1]
        return vec3.lerp(this.currentPoint(M, cam, S, i - 1), this.currentPoint(M, cam, S, i), seg > 1e-6 ? (sm - cum[i - 1]) / seg : 0)
      }
    }
    return this.currentPoint(M, cam, S, this.pathN - 1)
  }

  /**
   * The thread: from the copy's plug, up over the room in a soft arc and down onto the real lamp's
   * base, then up its stem into the shade to its bulb (the paper hides the last part). Laid again only
   * when one of its ends or the eye has moved.
   */
  private layThread(cam: vec3): void {
    // From the plug where it really is (it stays on the table while the copy hovers).
    const start = this.ctx.model.parts["LampPlug"].getTransform().getWorldTransform().multiplyPoint(PLUG_POINT)
    const o = this.ctx.realOrigin()
    const bulb = this.ctx.realBulb()
    const key = this.threadKey
    const e = this.threadEye
    const near = (a: number, c: number, eps: number) => a - c < eps && c - a < eps
    this.originX = o.x
    this.originY = o.y
    this.originZ = o.z
    if (
      this.threadLaid &&
      near(cam.x, e.x, EYE_EPS) &&
      near(cam.y, e.y, EYE_EPS) &&
      near(cam.z, e.z, EYE_EPS) &&
      near(start.x, key[0], MOVE_EPS) &&
      near(start.y, key[1], MOVE_EPS) &&
      near(start.z, key[2], MOVE_EPS) &&
      near(o.x, key[3], MOVE_EPS) &&
      near(o.y, key[4], MOVE_EPS) &&
      near(o.z, key[5], MOVE_EPS) &&
      near(bulb.x, key[6], MOVE_EPS) &&
      near(bulb.y, key[7], MOVE_EPS) &&
      near(bulb.z, key[8], MOVE_EPS)
    )
      return
    this.threadLaid = true
    this.threadMoved = true
    e.x = cam.x
    e.y = cam.y
    e.z = cam.z
    key[0] = start.x
    key[1] = start.y
    key[2] = start.z
    key[3] = o.x
    key[4] = o.y
    key[5] = o.z
    key[6] = bulb.x
    key[7] = bulb.y
    key[8] = bulb.z
    let tx = cam.x - o.x
    let tz = cam.z - o.z
    const tl = Math.sqrt(tx * tx + tz * tz)
    if (tl > 1e-4) {
      tx /= tl
      tz /= tl
    } else {
      tx = 0
      tz = 1
    }
    const off = G.stemR + 0.4
    const landX = o.x + tx * 4
    const landY = o.y + G.domeTop + 0.4
    const landZ = o.z + tz * 4
    const footX = o.x + tx * off
    const footY = o.y + G.collarTop
    const footZ = o.z + tz * off
    const topX = bulb.x + tx * off
    const topY = bulb.y
    const topZ = bulb.z + tz * off
    const ddx = start.x - landX
    const ddy = start.y - landY
    const ddz = start.z - landZ
    const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
    const cx = (start.x + landX) / 2
    const cy = (start.y + landY) / 2 + 0.18 * dist + 15
    const cz = (start.z + landZ) / 2
    const T = this.thread
    for (let i = 0; i <= 44; i++) {
      const t = i / 44
      const u = 1 - t
      const a = u * u
      const m = 2 * u * t
      const c = t * t
      T.x[i] = start.x * a + cx * m + landX * c
      T.y[i] = start.y * a + cy * m + landY * c
      T.z[i] = start.z * a + cz * m + landZ * c
    }
    T.x[45] = (landX + footX) / 2
    T.y[45] = (landY + footY) / 2
    T.z[45] = (landZ + footZ) / 2
    T.x[46] = footX
    T.y[46] = footY
    T.z[46] = footZ
    this.threadInside = 1e9
    for (let i = 1; i <= 9; i++) {
      const at = 46 + i
      const k = i / 9
      const qy = footY + (topY - footY) * k
      if (qy > o.y + G.shadeSeatY && this.threadInside > at) this.threadInside = at
      T.x[at] = footX + (topX - footX) * k
      T.y[at] = qy
      T.z[at] = footZ + (topZ - footZ) * k
    }
    const cum = this.threadCum
    cum[0] = 0
    for (let i = 0; i < THREAD_N; i++) {
      if (i > 0) {
        const dx = T.x[i] - T.x[i - 1]
        const dy = T.y[i] - T.y[i - 1]
        const dz = T.z[i] - T.z[i - 1]
        cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
      const vx = T.x[i] - cam.x
      const vy = T.y[i] - cam.y
      const vz = T.z[i] - cam.z
      const d = Math.sqrt(vx * vx + vy * vy + vz * vz)
      this.wThread[i] = Math.max(0.25, 0.003 * d)
      this.wThreadHalo[i] = Math.max(1, 0.011 * d)
    }
    this.Lt = cum[THREAD_N - 1]
  }

  /** The thread's packets run on its path; behind the open bubble it dims, so the bubble reads clean. */
  private drawThread(g: LampGraphics, cam: vec3, tf: number, Lt: number, b: number): void {
    const T = this.thread
    const cum = this.threadCum
    const th = V_THREAD * 0.45 * this.t
    const boost = clamp01(b * 1.5)
    const disc = this.bubble && this.bubble.discR > 0.5 ? this.bubble : null
    let bx = 0
    let by = 0
    let bz = 0
    let bl = 0
    let rim = 0
    if (disc) {
      bx = disc.discX - cam.x
      by = disc.discY - cam.y
      bz = disc.discZ - cam.z
      bl = Math.sqrt(bx * bx + by * by + bz * bz)
      rim = Math.atan(disc.discR / bl)
    }
    for (let i = 0; i < THREAD_N; i++) {
      const s = cum[i]
      let a = 0
      if (s <= tf) {
        const ph = (th - s) / THREAD_SPACING
        const u = ((ph - Math.floor(ph)) * THREAD_SPACING) / THREAD_PACKET_LEN
        const pk = u <= 1 ? Math.pow(1 - u, 1.3) : 0
        const fr = tf < Lt ? clamp01(1 - (tf - s) / THREAD_PACKET_LEN) : 0
        a = 0.42 + 0.58 * Math.max(pk * boost, fr)
        // Up the real stem inside the shade it is seen faintly through the paper.
        if (i >= this.threadInside) a *= 0.35
        if (disc) {
          const vx = T.x[i] - cam.x
          const vy = T.y[i] - cam.y
          const vz = T.z[i] - cam.z
          const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
          if (vl > bl) {
            const ang = Math.acos(Math.max(-1, Math.min(1, (vx * bx + vy * by + vz * bz) / (vl * bl))))
            a *= 0.15 + 0.85 * clamp01((ang - rim * 0.92) / (rim * 0.12))
          }
        }
      }
      T.a[i] = a
    }
    const geometry = this.threadMoved || !this.threadDrawn
    g.threadCore.commit(T, cam, this.wThread, geometry)
    g.threadHalo.commit(T, cam, this.wThreadHalo, geometry)
    this.threadMoved = false
    this.threadDrawn = true
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
