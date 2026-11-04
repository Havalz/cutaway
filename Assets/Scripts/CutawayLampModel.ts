/**
 * Lamp hero, Phase A (devpost/lamp-hero.md): the paper floor lamp built in code from the reference
 * image (devpost/refs/lamp/) and the Evening Room's lamp, which was measured in the preview from
 * two calibrated views (front and 21° right, triangulated axis, f calibrated on this model).
 *
 * Model space, cm at 1x: origin = the base's footprint centre on the floor; +Y up the lamp's axis;
 * +Z toward the front. Every part is its own SceneObject (named "Lamp…") with its pivot at its real
 * centre or joint; meshes are authored in model space and offset under their part. Solids are
 * clones of the LampShell material (uber PBR, additive, vertex colour = emissive lift, warm white
 * fresnel rim), lit by the model's own key and fill lights on its own render layer. Faces are wound
 * to match their normals, so back faces are culled.
 */
import {MeshKit} from "./CutawayGeometry"
import {bevelBox} from "./CutawayHeroParts"

const TAU = Math.PI * 2
const DEG = Math.PI / 180

// =====================================================================================
// The room's lamp (measured) and the model's layout
// =====================================================================================

/** The Evening Room's floor lamp, measured in the preview (cm, world). */
export const ROOM_LAMP = {
  /** The base's footprint centre on the floor (world; triangulated from two views). */
  origin: new vec3(-229.06, -179.6, -459.57),
  /** Floor to the top of the top ring (165.2 front view, 165.2 diagonal view). */
  height: 165.2,
  /** The paper shade's widest diameter (26.66 and 26.67 by edge pairs, 26.87 by a profile fit). */
  shadeWidth: 26.7,
  /** The base disc's diameter (27.25 front view, 26.98 diagonal view). */
  baseDiameter: 27.1
}

/** Overall height (floor to the top of the top ring). */
const HEIGHT = 165.2

/** Base: weighted disc on an inset foot, rounded rim, gently domed top rising to the collar. */
const BASE_R = 13.55
const FOOT_R = 13.1
const FOOT_H = 0.55
const RIM_TOP = 2.4
const RIM_ROUND = 0.75
const COLLAR_R = 2.15
const DOME_TOP = 5.4
const COLLAR_TOP = DOME_TOP + 3.0

/** Stem: a thin steel tube from the collar, through the shade's bottom ring, up to the socket. */
const STEM_R = 0.65

/** Shade: its seat (the bottom ring's underside), ring height, widest radius, the paper's span. */
const SHADE_Y0 = 24.6
const RING_H = 1.3
const SHADE_MAX_R = 13.35
const PAPER_Y0 = SHADE_Y0 + RING_H
const PAPER_Y1 = HEIGHT - RING_H

/**
 * The paper's radius over its visible span (t = 0 at the bottom ring, 1 at the top ring), as a
 * fraction of the widest radius: the room lamp's measured silhouette (fitted, rms 0.7 px), with its
 * widest point set slightly above the middle (t = 0.51) as in the reference, tapering to both ends.
 */
const SHADE_KNOTS = [0.4669, 0.5473, 0.629, 0.7077, 0.7802, 0.8441, 0.898, 0.9409, 0.9722, 0.9919, 1.0, 0.9964, 0.9806, 0.9534, 0.9156, 0.8675, 0.8096, 0.742, 0.6657, 0.5813, 0.4903]

/** Socket on the stem's top, 16 cm into the shade; the bulb's screw base sits 1.4 cm into it. */
const SOCKET_Y0 = SHADE_Y0 + 16
const SOCKET_H = 4.4
const SOCKET_R = 1.8
const BULB_Y0 = SOCKET_Y0 + 1.4
/**
 * A standard A-shape (A60) LED bulb, in bulb space: the screw base and its insulator, a short white
 * housing flaring from the screw to the glass (the driver inside), the LED board on its top, and the
 * frosted pear envelope over the board: a cone from the housing into a 6 cm sphere, tangent to it.
 */
const SCREW_TOP = 2.4
const NECK_Y0 = 2.75
const NECK_Y1 = 5.0
const NECK_R0 = 1.42
const NECK_R1 = 2.2
/** The envelope's flank slope (dr/dy) where it leaves the housing, and the housing's at its top. */
const GLASS_SLOPE = 0.6
const BOARD_Y = 5.0
const BOARD_R = 1.95
const GLASS_Y0 = NECK_Y1 - 0.03
const GLASS_R0 = 2.15
const GLASS_R = 3.0
/** Where the cone meets the sphere (glass space), the sphere's centre and the envelope's height. */
const GLASS_RT = GLASS_R / Math.sqrt(1 + GLASS_SLOPE * GLASS_SLOPE)
const GLASS_YT = (GLASS_RT - GLASS_R0) / GLASS_SLOPE
const GLASS_YC = GLASS_YT + GLASS_SLOPE * GLASS_RT
const GLASS_H = GLASS_YC + GLASS_R

/** Cord: where it leaves the base (angle about +Y from +X toward +Z), radius, foot switch, plug. */
const CORD_EXIT_DEG = 40
const CORD_R = 0.27
const SWITCH_AT = new vec3(30, 0, 19)
const SWITCH_DEG = 20
const SWITCH_HALF = new vec3(3.8, 2.3, 2.1)
const PLUG_AT = new vec3(66, 0, 9.5)
const PLUG_DEG = -37

/** Radius of the paper at model height y (extrapolated linearly past both rings). */
export function lampShadeR(y: number): number {
  const t = (y - PAPER_Y0) / (PAPER_Y1 - PAPER_Y0)
  const K = SHADE_KNOTS
  const N = K.length - 1
  if (t <= 0) return SHADE_MAX_R * (K[0] + t * N * (K[1] - K[0]))
  if (t >= 1) return SHADE_MAX_R * (K[N] + (t - 1) * N * (K[N] - K[N - 1]))
  const u = t * N
  const i = Math.min(N - 1, Math.floor(u))
  const f = u - i
  const p0 = K[Math.max(0, i - 1)]
  const p1 = K[i]
  const p2 = K[i + 1]
  const p3 = K[Math.min(N, i + 2)]
  const f2 = f * f
  const f3 = f2 * f
  return SHADE_MAX_R * (0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3))
}

/** dR/dy of the paper. */
function shadeSlope(y: number): number {
  return (lampShadeR(y + 0.05) - lampShadeR(y - 0.05)) / 0.1
}

const yawDir = (deg: number) => new vec3(Math.cos(deg * DEG), 0, Math.sin(deg * DEG))
/** quat that turns local +X onto yawDir(deg) (about +Y). */
const yawQuat = (deg: number) => quat.angleAxis(-deg * DEG, vec3.up())

/** The model's layout for the hero stage (model space, cm at 1x). */
export const LAMP_GEOM = {
  height: HEIGHT,
  baseR: BASE_R,
  rimTop: RIM_TOP,
  domeTop: DOME_TOP,
  collarTop: COLLAR_TOP,
  stemR: STEM_R,
  /** The shade's seat (bottom of the bottom ring), ring height and widest radius. */
  shadeSeatY: SHADE_Y0,
  ringH: RING_H,
  shadeMaxR: SHADE_MAX_R,
  paperY0: PAPER_Y0,
  paperY1: PAPER_Y1,
  socketY: SOCKET_Y0,
  bulbY: BULB_Y0,
  /** Top of the LED board (the chips sit on it), model space. */
  ledY: BULB_Y0 + BOARD_Y + 0.16,
  /** Top of the frosted envelope, model space. */
  bulbTopY: BULB_Y0 + GLASS_Y0 + GLASS_H,
  /** Centre of the envelope's sphere (the bulb's optical centre), model space. */
  bulbCenterY: BULB_Y0 + GLASS_Y0 + GLASS_YC,
  bulbR: GLASS_R,
  switchAt: SWITCH_AT,
  switchDeg: SWITCH_DEG,
  switchHalf: SWITCH_HALF,
  plugAt: PLUG_AT,
  cordR: CORD_R
}

// =====================================================================================
// Finishes
// =====================================================================================

export type LampFinish = "paper" | "paperIn" | "steel" | "ring" | "chrome" | "plastic" | "socket" | "frost" | "board" | "chip" | "pcb" | "dark" | "wire" | "frame" | "cord" | "button"

interface FinishSpec {
  albedo: vec3
  metallic: number
  roughness: number
  rim: number
  rimExp: number
  /** Emissive lift (vertex colour) when it is not the albedo; see the record player model. */
  emit?: vec3
  /** Rim colour when it is not the warm white (the steel's edges catch a neutral highlight). */
  rimCol?: vec3
}

const grey = (v: number) => new vec3(v, v, v)

/** Neutral highlight for the steel's edges. */
const RIM_STEEL = new vec3(1, 0.985, 0.96)

/**
 * Base colours from the reference, lifted for the additive display. The paper is the star: warm
 * white, fully matte (no specular sparkle, so it never reads as plastic), with a broad soft warm rim
 * that makes its edges glow like light through paper; its fine crinkle is the LampPaper texture.
 * Brushed steel for the base, stem and rings (the LampBrushed texture): a mid-grey body, metallic,
 * with a tight bright neutral rim, so the light gathers along the edges instead of a milky sheen.
 */
const FINISH: Record<LampFinish, FinishSpec> = {
  // The paper's material is the LampPaper asset itself (same values as here); only `emit` (its vertex colour) is used from this entry.
  paper: {albedo: new vec3(0.8, 0.77, 0.7), metallic: 0, roughness: 0.95, rim: 0.36, rimExp: 1.6, emit: new vec3(0.66, 0.63, 0.56)},
  paperIn: {albedo: new vec3(0.8, 0.75, 0.66), metallic: 0, roughness: 0.95, rim: 0.2, rimExp: 2.0, emit: new vec3(0.5, 0.46, 0.39)},
  steel: {albedo: grey(0.5), metallic: 0.85, roughness: 0.3, rim: 0.62, rimExp: 3.6, emit: grey(0.58), rimCol: RIM_STEEL},
  ring: {albedo: grey(0.5), metallic: 0.85, roughness: 0.32, rim: 0.6, rimExp: 3.2, emit: grey(0.56), rimCol: RIM_STEEL},
  chrome: {albedo: grey(0.86), metallic: 0.85, roughness: 0.16, rim: 0.45, rimExp: 2.4},
  plastic: {albedo: new vec3(0.9, 0.89, 0.86), metallic: 0, roughness: 0.42, rim: 0.32, rimExp: 2.4},
  socket: {albedo: new vec3(0.66, 0.65, 0.62), metallic: 0.05, roughness: 0.5, rim: 0.36, rimExp: 2.4},
  frost: {albedo: grey(0.92), metallic: 0, roughness: 0.55, rim: 0.6, rimExp: 1.8, emit: new vec3(0.74, 0.74, 0.72)},
  board: {albedo: grey(0.82), metallic: 0.5, roughness: 0.35, rim: 0.3, rimExp: 2.4},
  chip: {albedo: new vec3(0.98, 0.86, 0.36), metallic: 0, roughness: 0.3, rim: 0.3, rimExp: 2.4},
  pcb: {albedo: new vec3(0.22, 0.48, 0.34), metallic: 0.1, roughness: 0.45, rim: 0.45, rimExp: 2.2, emit: new vec3(0.24, 0.46, 0.33)},
  dark: {albedo: grey(0.16), metallic: 0.2, roughness: 0.4, rim: 0.5, rimExp: 2.2, emit: grey(0.34)},
  wire: {albedo: grey(0.7), metallic: 0.1, roughness: 0.5, rim: 0.3, rimExp: 2.4},
  frame: {albedo: new vec3(0.84, 0.83, 0.8), metallic: 0.4, roughness: 0.4, rim: 0.4, rimExp: 2.2},
  cord: {albedo: new vec3(0.88, 0.87, 0.84), metallic: 0, roughness: 0.5, rim: 0.32, rimExp: 2.4},
  button: {albedo: new vec3(0.62, 0.6, 0.57), metallic: 0, roughness: 0.45, rim: 0.4, rimExp: 2.4}
}
/** Warm white fresnel rim, #FFF1D6. */
const RIM_WARM = new vec3(1, 0.945, 0.839)
/** Emissive intensity on the vertex colour: (0.62 × albedo)^2.2 ≈ 35% of the albedo in linear light. */
const LIFT = 0.62

const col = (f: LampFinish) => {
  const s = FINISH[f]
  const e = s.emit ?? s.albedo
  return new vec4(e.x, e.y, e.z, 1)
}
const rgb = (r: number, g: number, b: number) => new vec4(r, g, b, 1)

/**
 * Draw order (lower first). The look is additive with depth writes, so a part draws before whatever
 * it sits on or covers: the paper before the rings (it hides their far side; it ends at their
 * edges, so they never cover it) and before everything inside it, the frosted glass before the LED
 * board, the bulb's neck before the socket (it hides the socket's far inner wall), the socket
 * before the screw base it holds, the collar before the stem it clamps and the base it sits on.
 */
const ORDER = {button: 0, switchBody: 1, plug: 1, paper: 2, ring: 3, cord: 3, paperIn: 4, glass: 5, frame: 6, chips: 6, board: 7, neck: 8, socket: 9, screw: 10, collar: 11, stem: 12, base: 13, interior: 15}

// =====================================================================================
// Geometry helpers (all wound to their normals)
// =====================================================================================

/** A profile point: radius `r`, height `y`, normal (`nr` outward, `ny` along the axis). */
interface PP {
  r: number
  y: number
  nr: number
  ny: number
}
type Bands = PP[][]

/** A plan outline point (x, z) with its outward unit normal. */
interface RP2 {
  p: vec2
  n: vec2
}

/** What the builders below need of a mesh kit (MeshKit, or UvKit for the textured parts). */
interface Kit {
  vert(p: vec3, n: vec3, c: vec4, uv?: vec2): number
  triOut(a: number, b: number, c: number): void
  readonly vertexCount: number
  readonly triangleCount: number
  build(): RenderMesh
}

/** Texture coordinates for a lathe point: the profile point and its turn round the axis (0..1). */
type LatheUv = (p: PP, u: number) => vec2

/**
 * MeshKit's layout (position, normal, colour) plus texture0, for the parts that carry a texture (the
 * paper's crinkle, the steel's brushing). Faces are wound to their normals like MeshKit's.
 */
class UvKit implements Kit {
  /** Floats per vertex: position 3, normal 3, colour 4, uv 2. */
  readonly stride = 12
  data: number[] = []
  private indices: number[] = []
  private count = 0

  vert(p: vec3, n: vec3, c: vec4, uv: vec2 = vec2.zero()): number {
    this.data.push(p.x, p.y, p.z, n.x, n.y, n.z, c.x, c.y, c.z, c.w, uv.x, uv.y)
    return this.count++
  }

  triOut(a: number, b: number, c: number): void {
    const d = this.data
    const S = this.stride
    const P = (i: number) => new vec3(d[i * S], d[i * S + 1], d[i * S + 2])
    const N = (i: number) => new vec3(d[i * S + 3], d[i * S + 4], d[i * S + 5])
    const f = P(b).sub(P(a)).cross(P(c).sub(P(a)))
    if (f.dot(N(a).add(N(b)).add(N(c))) >= 0) this.indices.push(a, b, c)
    else this.indices.push(a, c, b)
  }

  get vertexCount(): number {
    return this.count
  }

  get triangleCount(): number {
    return this.indices.length / 3
  }

  build(): RenderMesh {
    const mb = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3, normalized: true},
      {name: "color", components: 4},
      {name: "texture0", components: 2}
    ])
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    mb.appendVerticesInterleaved(this.data)
    mb.appendIndices(this.indices)
    mb.updateMesh()
    return mb.getMesh()
  }
}

function basis(ax: vec3): {u: vec3; v: vec3} {
  const ref = Math.abs(ax.y) < 0.9 ? vec3.up() : new vec3(1, 0, 0)
  const u = ref.cross(ax).normalize()
  const v = ax.cross(u).normalize()
  return {u, v}
}

/**
 * Surface of revolution of `bands` around axis `ax` through `c`; `color` may vary per point and
 * angle; `uv` (UvKit only) maps each profile point and its turn round the axis to the texture.
 */
function lathe(k: Kit, c: vec3, ax: vec3, bands: Bands, seg: number, color: vec4 | ((p: PP, a: number) => vec4), uv?: LatheUv): void {
  const {u, v} = basis(ax)
  const cols = seg + 1
  for (const band of bands) {
    const base = k.vertexCount
    for (const p of band) {
      const nl = Math.hypot(p.nr, p.ny) || 1
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * TAU
        const d = u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)))
        const cc = typeof color === "function" ? color(p, a) : color
        k.vert(c.add(ax.uniformScale(p.y)).add(d.uniformScale(p.r)), d.uniformScale(p.nr / nl).add(ax.uniformScale(p.ny / nl)), cc, uv ? uv(p, s / seg) : undefined)
      }
    }
    for (let j = 0; j < band.length - 1; j++)
      for (let s = 0; s < seg; s++) {
        const a = base + j * cols + s
        const b = a + cols
        if (band[j].r > 1e-6) k.triOut(a, a + 1, b)
        if (band[j + 1].r > 1e-6) k.triOut(a + 1, b + 1, b)
      }
  }
}

/** Brushed round a turned part (rings, collar): the grain varies with height, so its lines run round. */
const aroundUv: LatheUv = (p, u) => new vec2(p.y * 0.08, u)

/** Quarter-round from the side (normal out) to the top (normal up), radius `rr`, corner at (r, y1). */
function roundTop(r: number, y1: number, rr: number, steps: number = 4): PP[] {
  const out: PP[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2)
    out.push({r: r - rr + rr * Math.cos(t), y: y1 - rr + rr * Math.sin(t), nr: Math.cos(t), ny: Math.sin(t)})
  }
  return out
}

/** Quarter-round from the bottom (normal down) to the side, radius `rr`, corner at (r, y0). */
function roundBottom(r: number, y0: number, rr: number, steps: number = 3): PP[] {
  const out: PP[] = []
  for (let i = 0; i <= steps; i++) {
    const t = -Math.PI / 2 + (i / steps) * (Math.PI / 2)
    out.push({r: r - rr + rr * Math.cos(t), y: y0 + rr + rr * Math.sin(t), nr: Math.cos(t), ny: Math.sin(t)})
  }
  return out
}

/** A round part from y0 to y1: rounded top edge `rt`, rounded bottom edge `rb`, flat caps, optional hole `rIn`. */
function puck(r: number, y0: number, y1: number, rt: number, rb: number, opts: {bottom?: boolean; top?: boolean; rIn?: number; steps?: number} = {}): Bands {
  const rIn = opts.rIn ?? 0
  const st = opts.steps ?? 4
  const bands: Bands = []
  if (opts.bottom !== false) bands.push([{r: rIn, y: y0, nr: 0, ny: -1}, {r: r - rb, y: y0, nr: 0, ny: -1}])
  const side: PP[] = rb > 0 ? roundBottom(r, y0, rb, Math.max(2, st - 1)) : [{r, y: y0, nr: 1, ny: 0}]
  side.push(...(rt > 0 ? roundTop(r, y1, rt, st) : [{r, y: y1, nr: 1, ny: 0}]))
  bands.push(side)
  if (opts.top !== false) bands.push([{r: r - rt, y: y1, nr: 0, ny: 1}, {r: rIn, y: y1, nr: 0, ny: 1}])
  if (rIn > 0) bands.push([{r: rIn, y: y1, nr: -1, ny: 0}, {r: rIn, y: y0, nr: -1, ny: 0}])
  return bands
}

/** A convex plan polygon (x, z) with rounded corners of radius `r`. */
function roundedPoly(pts: vec2[], r: number, n: number = 4): RP2[] {
  const N = pts.length
  let area = 0
  for (let i = 0; i < N; i++) area += pts[i].x * pts[(i + 1) % N].y - pts[(i + 1) % N].x * pts[i].y
  const sg = area > 0 ? 1 : -1
  const edgeN = (a: vec2, b: vec2) => {
    const e = b.sub(a).normalize()
    return new vec2(e.y * sg, -e.x * sg)
  }
  const out: RP2[] = []
  for (let i = 0; i < N; i++) {
    const cur = pts[i]
    const n1 = edgeN(pts[(i + N - 1) % N], cur)
    const n2 = edgeN(cur, pts[(i + 1) % N])
    const c = cur.sub(n1.add(n2).uniformScale(r / (1 + n1.dot(n2))))
    const a1 = Math.atan2(n1.y, n1.x)
    let da = Math.atan2(n2.y, n2.x) - a1
    while (da > Math.PI) da -= TAU
    while (da < -Math.PI) da += TAU
    for (let j = 0; j <= n; j++) {
      const a = a1 + (da * j) / n
      const d = new vec2(Math.cos(a), Math.sin(a))
      out.push({p: c.add(d.uniformScale(r)), n: d})
    }
  }
  return out
}

function roundedRect(cx: number, cz: number, hw: number, hd: number, r: number, n: number = 4): RP2[] {
  return roundedPoly([new vec2(cx - hw, cz - hd), new vec2(cx + hw, cz - hd), new vec2(cx + hw, cz + hd), new vec2(cx - hw, cz + hd)], r, n)
}

/** Sweep profile bands along a closed plan outline (r = offset along the outline's normal). */
function sweep(k: MeshKit, ring: RP2[], bands: Bands, color: vec4): void {
  const N = ring.length
  for (const band of bands) {
    const base = k.vertexCount
    const M = band.length
    for (const q of ring)
      for (const p of band) {
        const nl = Math.hypot(p.nr, p.ny) || 1
        k.vert(new vec3(q.p.x + q.n.x * p.r, p.y, q.p.y + q.n.y * p.r), new vec3((q.n.x * p.nr) / nl, p.ny / nl, (q.n.y * p.nr) / nl), color)
      }
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N
      for (let j = 0; j < M - 1; j++) {
        const a = base + i * M + j
        const b = base + i2 * M + j
        k.triOut(a, b, a + 1)
        k.triOut(b, b + 1, a + 1)
      }
    }
  }
}

/** Flat cap over a plan outline, inset by `off`, at height y (normal up or down). */
function cap(k: MeshKit, ring: RP2[], off: number, y: number, up: boolean, color: vec4): void {
  let cx = 0
  let cz = 0
  for (const q of ring) {
    cx += q.p.x / ring.length
    cz += q.p.y / ring.length
  }
  const nrm = new vec3(0, up ? 1 : -1, 0)
  const c = k.vert(new vec3(cx, y, cz), nrm, color)
  const ids = ring.map((q) => k.vert(new vec3(q.p.x + q.n.x * off, y, q.p.y + q.n.y * off), nrm, color))
  for (let i = 0; i < ids.length; i++) k.triOut(c, ids[i], ids[(i + 1) % ids.length])
}

/** A soft rounded body on a plan outline from y0 to y1: round top edge `rt`, chamfered bottom `b`. */
function slab(k: MeshKit, ring: RP2[], y0: number, y1: number, rt: number, b: number, color: vec4, steps: number = 4): void {
  const bands: Bands = []
  if (b > 0) bands.push([{r: -b, y: y0, nr: 1, ny: -1}, {r: 0, y: y0 + b, nr: 1, ny: -1}])
  bands.push([{r: 0, y: y0 + b, nr: 1, ny: 0}, ...roundTop(0, y1, rt, steps)])
  sweep(k, ring, bands, color)
  cap(k, ring, -rt, y1, true, color)
  cap(k, ring, -b, y0, false, color)
}

/** Parallel-transport frames along a polyline. */
function frames(pts: vec3[]): {t: vec3[]; n: vec3[]} {
  const L = pts.length
  const t = pts.map((_, i) => pts[Math.min(L - 1, i + 1)].sub(pts[Math.max(0, i - 1)]).normalize())
  let nrm = basis(t[0]).u
  const n: vec3[] = []
  for (let i = 0; i < L; i++) {
    nrm = nrm.sub(t[i].uniformScale(t[i].dot(nrm))).normalize()
    n.push(nrm)
  }
  return {t, n}
}

/** A smooth round tube along a polyline, with flat end caps (or none). */
function tube(k: MeshKit, pts: vec3[], r: number, sides: number, color: vec4, caps: boolean = true): void {
  const {t, n} = frames(pts)
  const base = k.vertexCount
  const rings: vec3[][] = []
  for (let i = 0; i < pts.length; i++) {
    const b = t[i].cross(n[i])
    const ring: vec3[] = []
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU
      const d = n[i].uniformScale(Math.cos(a)).add(b.uniformScale(Math.sin(a)))
      ring.push(pts[i].add(d.uniformScale(r)))
      k.vert(pts[i].add(d.uniformScale(r)), d, color)
    }
    rings.push(ring)
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let s = 0; s < sides; s++) {
      const a = base + i * (sides + 1) + s
      const b = a + sides + 1
      k.triOut(a, a + 1, b)
      k.triOut(a + 1, b + 1, b)
    }
  if (!caps) return
  for (const [i, sg] of [
    [0, -1],
    [pts.length - 1, 1]
  ]) {
    const nrm = t[i].uniformScale(sg)
    const c = k.vert(pts[i], nrm, color)
    const ids = rings[i].slice(0, sides).map((p) => k.vert(p, nrm, color))
    for (let s = 0; s < sides; s++) k.triOut(c, ids[s], ids[(s + 1) % sides])
  }
}

/** A closed horizontal wire ring of radius `R` at height y. */
function wireRing(k: MeshKit, R: number, y: number, r: number, seg: number, sides: number, color: vec4): void {
  const pts: vec3[] = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * TAU
    pts.push(new vec3(Math.cos(a) * R, y, Math.sin(a) * R))
  }
  tube(k, pts, r, sides, color, false)
}

/** Catmull-Rom through the points, `per` samples per span. */
function catmull(pts: vec3[], per: number): vec3[] {
  const out: vec3[] = []
  const L = pts.length
  for (let i = 0; i < L - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(L - 1, i + 2)]
    for (let s = 0; s < per; s++) {
      const t = s / per
      const t2 = t * t
      const t3 = t2 * t
      out.push(
        p0
          .uniformScale(-0.5 * t3 + t2 - 0.5 * t)
          .add(p1.uniformScale(1.5 * t3 - 2.5 * t2 + 1))
          .add(p2.uniformScale(-1.5 * t3 + 2 * t2 + 0.5 * t))
          .add(p3.uniformScale(0.5 * t3 - 0.5 * t2))
      )
    }
  }
  out.push(pts[L - 1])
  return out
}

/** Resample a polyline to roughly even steps of `step` (keeps both ends). */
function even(pts: vec3[], step: number): vec3[] {
  const out: vec3[] = [pts[0]]
  let carry = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const L = a.distance(b)
    let d = step - carry
    while (d < L) {
      out.push(vec3.lerp(a, b, d / L))
      d += step
    }
    carry = L - (d - step)
  }
  if (out[out.length - 1].distance(pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1])
  else out[out.length - 1] = pts[pts.length - 1]
  return out
}

// =====================================================================================
// The model
// =====================================================================================

export interface LampModelCtx {
  /** Parent for the model's root. */
  parent: SceneObject
  /** LampShell: uber PBR, additive, vertex colour as emissive, warm rim. */
  shellMat: Material
  /** LampPaper: LampShell with the rice-paper crinkle as its base and emissive texture (the paper uses it as is). */
  paperMat?: Material | null
  /** LampSteel: LampShell with the brushed-steel texture, for the base, collar, stem and rings. */
  steelMat?: Material | null
  /** Render layer for the model and its lights (the camera must render it). */
  layer: LayerSet
}

export interface LampPartInfo {
  name: string
  so: SceneObject
  interior: boolean
}

export interface LampTriangles {
  total: number
  exterior: number
  interior: number
  byPart: Record<string, number>
}

/** The lamp model: one SceneObject per part, built once. */
export class LampModel {
  readonly root: SceneObject
  /** Parts by name ("LampBase", "LampShade", …). */
  readonly parts: Record<string, SceneObject> = {}
  /** Each part's pivot in model space (at rest). */
  private pivots: Record<string, vec3> = {}
  private interiorSos: SceneObject[] = []
  private meshes: {rmv: RenderMeshVisual; part: string; interior: boolean; tris: number; lo: vec3; hi: vec3}[] = []
  private mats: Partial<Record<LampFinish, Material>> = {}
  private layer: LayerSet

  constructor(private ctx: LampModelCtx) {
    this.layer = ctx.layer
    this.root = this.node(ctx.parent, "LampModel", vec3.zero())
    this.pivots["LampModel"] = vec3.zero()
    this.buildLightRig()
    this.buildBase()
    this.buildStem()
    this.buildShade()
    this.buildSocket()
    this.buildBulb()
    this.buildCord()
    this.buildWires()
    this.setInteriorVisible(false)
  }

  // ------------------------------------------------------------------ public

  /** Show or hide the parts that are only seen taken apart (driver board, wires in the stem). */
  setInteriorVisible(v: boolean): void {
    for (const so of this.interiorSos) so.enabled = v
  }

  triangles(): LampTriangles {
    const r: LampTriangles = {total: 0, exterior: 0, interior: 0, byPart: {}}
    for (const m of this.meshes) {
      r.total += m.tris
      if (m.interior) r.interior += m.tris
      else r.exterior += m.tris
      r.byPart[m.part] = (r.byPart[m.part] ?? 0) + m.tris
    }
    return r
  }

  /**
   * Bounds of the enabled exterior meshes in the model's own space, from their vertices (a built
   * mesh's own AABB also takes in its local origin, which would stretch the box).
   */
  bounds(filter?: (part: string) => boolean): {min: vec3; max: vec3; size: vec3} {
    const inv = this.root.getTransform().getInvertedWorldTransform()
    let min = new vec3(1e9, 1e9, 1e9)
    let max = new vec3(-1e9, -1e9, -1e9)
    for (const m of this.meshes) {
      if (m.interior || (filter && !filter(m.part))) continue
      if (!m.rmv.getSceneObject().isEnabledInHierarchy) continue
      const w = m.rmv.getSceneObject().getTransform().getWorldTransform()
      for (const x of [m.lo.x, m.hi.x])
        for (const y of [m.lo.y, m.hi.y])
          for (const z of [m.lo.z, m.hi.z]) {
            const p = inv.multiplyPoint(w.multiplyPoint(new vec3(x, y, z)))
            min = new vec3(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z))
            max = new vec3(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z))
          }
    }
    return {min, max, size: max.sub(min)}
  }

  /** The LED chips' centre (top of the LED board on the axis), world space. */
  ledCenter(): vec3 {
    return this.parts["LampLedBoard"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, 0.16, 0))
  }

  /** The top of the foot switch's button, world space. */
  switchButtonTop(): vec3 {
    return this.parts["LampSwitchButton"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, 0.45, 0))
  }

  /** A part's pivot in model space at rest. */
  pivot(name: string): vec3 {
    return this.pivots[name]
  }

  partList(): LampPartInfo[] {
    return Object.keys(this.parts).map((name) => ({name, so: this.parts[name], interior: this.interiorSos.indexOf(this.parts[name]) >= 0}))
  }

  meshList(): {rmv: RenderMeshVisual; part: string; interior: boolean; tris: number; lo: vec3; hi: vec3}[] {
    return this.meshes.slice()
  }

  destroy(): void {
    if (this.root) this.root.destroy()
  }

  // ------------------------------------------------------------------ plumbing

  private node(parent: SceneObject, name: string, pos: vec3, rot?: quat): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    const tr = so.getTransform()
    tr.setLocalPosition(pos)
    if (rot) tr.setLocalRotation(rot)
    so.layer = this.layer
    return so
  }

  /** A named part: its own SceneObject with its pivot at model-space `at` (unrotated parents only). */
  private part(parent: SceneObject, name: string, at: vec3, rot?: quat, interior: boolean = false): SceneObject {
    const pp = this.pivots[parent.name] ?? vec3.zero()
    const so = this.node(parent, name, at.sub(pp), rot)
    this.parts[name] = so
    this.pivots[name] = at
    if (interior) this.interiorSos.push(so)
    return so
  }

  /** The textured material a finish is drawn with (its UVs come from a UvKit), or null for plain LampShell. */
  private texturedFor(f: LampFinish): Material | null {
    if (f === "paper" || f === "paperIn") return this.ctx.paperMat ?? null
    if (f === "steel" || f === "ring") return this.ctx.steelMat ?? null
    return null
  }

  /**
   * The vertex colour a finish's mesh carries. The uber shader adds the vertex colour to the emissive
   * texture before multiplying by emissiveColor, so a textured finish carries black here and its
   * emit colour moves to the material's emissiveColor (see mat()): emissive = texture × emit.
   */
  private vcol(f: LampFinish): vec4 {
    return this.texturedFor(f) ? new vec4(0, 0, 0, 1) : col(f)
  }

  private mat(f: LampFinish): Material {
    const have = this.mats[f]
    if (have) return have
    const tex = this.texturedFor(f)
    const m = (tex ?? this.ctx.shellMat).clone()
    if (tex) {
      const e = FINISH[f].emit ?? FINISH[f].albedo
      m.mainPass.emissiveColor = new vec3(e.x, e.y, e.z)
    }
    // The paper keeps its asset's values (LampPaper, or LampShell without it).
    if (f !== "paper") {
      const s = FINISH[f]
      const p = m.mainPass
      p.baseColor = new vec4(s.albedo.x, s.albedo.y, s.albedo.z, 1)
      p.metallic = s.metallic
      p.roughness = s.roughness
      p.rimColor = s.rimCol ?? RIM_WARM
      p.rimIntensity = s.rim
      p.rimExponent = s.rimExp
      p.emissiveIntensity = LIFT
    }
    this.mats[f] = m
    return m
  }

  /**
   * Spawn a mesh child of a part. With `local` false (default) the kit is authored in model space
   * and offset by the part's pivot; with `local` true it is authored in the part's own space.
   */
  private mesh(part: SceneObject, suffix: string, k: Kit, f: LampFinish, order: number, local: boolean = false): SceneObject {
    const off = local ? vec3.zero() : this.pivots[part.name].uniformScale(-1)
    const so = this.node(part, part.name + suffix, off)
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = k.build()
    rmv.mainMaterial = this.mat(f)
    rmv.setRenderOrder(order)
    let interior = false
    let p: SceneObject | null = part
    while (p) {
      if (this.interiorSos.indexOf(p) >= 0) interior = true
      p = p.getParent()
    }
    // Vertex extents (MeshKit packs position, normal, colour: 10 floats a vertex; UvKit adds uv).
    const raw = k as unknown as {data: number[]; stride?: number}
    const data = raw.data
    const stride = raw.stride ?? 10
    const lo = [1e9, 1e9, 1e9]
    const hi = [-1e9, -1e9, -1e9]
    for (let i = 0; i < data.length; i += stride)
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c], data[i + c])
        hi[c] = Math.max(hi[c], data[i + c])
      }
    this.meshes.push({rmv, part: part.name, interior, tris: k.triangleCount, lo: new vec3(lo[0], lo[1], lo[2]), hi: new vec3(hi[0], hi[1], hi[2])})
    return so
  }

  private buildLightRig(): void {
    const rig = this.node(this.root, "LampLightRig", vec3.zero())
    const key = this.node(rig, "LampKeyLight", vec3.zero(), quat.lookAt(new vec3(0.45, -0.6, -0.65).normalize(), vec3.up()))
    const kl = key.createComponent("Component.LightSource") as LightSource
    kl.lightType = LightType.Directional
    kl.color = new vec3(1, 0.96, 0.9)
    kl.intensity = 1.15
    kl.renderLayer = this.layer
    const fill = this.node(rig, "LampFillLight", vec3.zero())
    const fl = fill.createComponent("Component.LightSource") as LightSource
    fl.lightType = LightType.Ambient
    fl.color = new vec3(0.88, 0.9, 1)
    fl.intensity = 0.5
    fl.renderLayer = this.layer
  }

  // ------------------------------------------------------------------ base, collar, stem

  private buildBase(): void {
    const B = this.part(this.root, "LampBase", vec3.zero())
    const k = new UvKit()
    const steel = this.vcol("steel")
    // Fine radial brushing (LampBrushed's grain runs along v): u = the turn round the axis, v = radius.
    const radial: LatheUv = (p, u) => new vec2(u, p.r / BASE_R)
    // Underside, inset foot, the shoulder under the rim.
    const underside: Bands = [
      [
        {r: 0, y: 0, nr: 0, ny: -1},
        {r: FOOT_R - 0.3, y: 0, nr: 0, ny: -1}
      ],
      [...roundBottom(FOOT_R, 0, 0.3, 2), {r: FOOT_R, y: FOOT_H, nr: 1, ny: 0}],
      [
        {r: FOOT_R, y: FOOT_H, nr: 0, ny: -1},
        {r: BASE_R - 0.4, y: FOOT_H, nr: 0, ny: -1}
      ]
    ]
    lathe(k, vec3.zero(), vec3.up(), underside, 48, steel, radial)
    // Rim (rounded bottom and top edges) flowing into the gently domed top, up to the collar.
    const top: PP[] = [...roundBottom(BASE_R, FOOT_H, 0.4, 2), ...roundTop(BASE_R, RIM_TOP, RIM_ROUND, 5)]
    const R0 = BASE_R - RIM_ROUND
    const DR = R0 - COLLAR_R
    const DH = DOME_TOP - RIM_TOP
    const P = 1.8
    for (let i = 1; i <= 14; i++) {
      const s = i / 14
      const r = R0 - DR * s
      const y = RIM_TOP + DH * Math.pow(s, P)
      const slope = (DH * P * Math.pow(s, P - 1)) / DR // dy/d(-r)
      top.push({r, y, nr: slope, ny: 1})
    }
    lathe(k, vec3.zero(), vec3.up(), [top], 64, steel, radial)
    this.mesh(B, "Mesh", k, "steel", ORDER.base)

    // Collar where the stem meets the base: two ridges and a short taper, turned (brushed round).
    const C = this.part(B, "LampCollar", new vec3(0, DOME_TOP, 0))
    const ck = new UvKit()
    const y0 = DOME_TOP
    const cone = {nr: Math.cos(Math.atan2(0.6, 2.13)), ny: Math.sin(Math.atan2(0.6, 2.13))}
    lathe(
      ck,
      new vec3(0, y0, 0),
      vec3.up(),
      [
        [{r: 0, y: 0, nr: 0, ny: -1}, {r: 2.2, y: 0, nr: 0, ny: -1}],
        [...roundBottom(2.32, -0.02, 0.1, 2), ...roundTop(2.32, 0.38, 0.12, 3)],
        [
          {r: 2.2, y: 0.38, nr: 0, ny: 1},
          {r: 2.02, y: 0.38, nr: 0, ny: 1}
        ],
        [{r: 2.02, y: 0.38, nr: 1, ny: 0}, ...roundTop(2.02, 0.74, 0.1, 3)],
        [
          {r: 1.92, y: 0.74, nr: 0, ny: 1},
          {r: 1.75, y: 0.74, nr: 0, ny: 1}
        ],
        [{r: 1.75, y: 0.74, nr: cone.nr, ny: cone.ny}, {r: 1.3, y: 2.6, nr: cone.nr, ny: cone.ny}, ...roundTop(1.18, 3.0, 0.16, 3)],
        [
          {r: 1.02, y: 3.0, nr: 0, ny: 1},
          {r: STEM_R, y: 3.0, nr: 0, ny: 1}
        ]
      ],
      32,
      this.vcol("steel"),
      aroundUv
    )
    this.mesh(C, "Mesh", ck, "steel", ORDER.collar)
  }

  private buildStem(): void {
    const S = this.part(this.root, "LampStem", new vec3(0, COLLAR_TOP, 0))
    const k = new UvKit()
    const top = SOCKET_Y0 + 0.6
    // Brushed along its length: u = the turn, v = height.
    lathe(k, vec3.zero(), vec3.up(), puck(STEM_R, COLLAR_TOP - 0.4, top, 0.06, 0, {bottom: false}), 20, this.vcol("steel"), (p, u) => new vec2(u * 0.25, p.y / HEIGHT))
    this.mesh(S, "Mesh", k, "steel", ORDER.stem)
    // Threaded nipple at the top, where the socket screws on (bright plated, no grain).
    const nk = new MeshKit()
    lathe(nk, vec3.zero(), vec3.up(), puck(0.42, top, top + 0.5, 0.05, 0, {bottom: false}), 14, col("chrome"))
    this.mesh(S, "Nipple", nk, "chrome", ORDER.stem)
  }

  // ------------------------------------------------------------------ shade: paper, rings, frame

  private buildShade(): void {
    const S = this.part(this.root, "LampShade", new vec3(0, SHADE_Y0, 0))

    // Paper: rice paper on the measured spindle profile, from ring to ring, a smooth surface whose
    // fine crinkle is the LampPaper texture: u = the turn round the axis, v = height (0 at the bottom
    // ring, 1 at the top), so its thin creases run round the shade.
    const P = this.part(S, "LampPaper", new vec3(0, (PAPER_Y0 + PAPER_Y1) / 2, 0))
    const yEnd = PAPER_Y1
    const paperV = (y: number) => (y - PAPER_Y0) / (yEnd - PAPER_Y0)
    const profile = (rOff: number, inward: boolean): PP[] => {
      const out: PP[] = []
      const N = 48
      for (let i = 0; i <= N; i++) {
        const y = PAPER_Y0 + ((yEnd - PAPER_Y0) * i) / N
        out.push(inward ? {r: lampShadeR(y) + rOff, y, nr: -1, ny: shadeSlope(y)} : {r: lampShadeR(y) + rOff, y, nr: 1, ny: -shadeSlope(y)})
      }
      return out
    }
    const pk = new UvKit()
    lathe(pk, vec3.zero(), vec3.up(), [profile(0, false)], 48, this.vcol("paper"), (p, u) => new vec2(u, paperV(p.y)))
    this.mesh(P, "Outer", pk, "paper", ORDER.paper)

    // Inside of the paper (seen through the openings and from below once lifted).
    const ik = new UvKit()
    lathe(ik, vec3.zero(), vec3.up(), [profile(-0.05, true)], 32, this.vcol("paperIn"), (p, u) => new vec2(u, paperV(p.y)))
    this.mesh(P, "Inner", ik, "paperIn", ORDER.paperIn)

    // Steel rings: a rolled band round each end of the paper, slightly proud of it, brushed round.
    const ring = (name: string, y0: number) => {
      const yc = y0 + RING_H / 2
      const so = this.part(S, name, new vec3(0, yc, 0))
      const rp = lampShadeR(Math.min(PAPER_Y1, Math.max(PAPER_Y0, yc)))
      const rk = new UvKit()
      lathe(rk, new vec3(0, y0, 0), vec3.up(), puck(rp + 0.38, 0, RING_H, 0.16, 0.16, {rIn: rp - 0.12, steps: 3}), 64, this.vcol("ring"), aroundUv)
      this.mesh(so, "Mesh", rk, "ring", ORDER.ring)
    }
    ring("LampBottomRing", SHADE_Y0)
    ring("LampTopRing", HEIGHT - RING_H)

    // Wire frame inside the paper: rings at regular heights, four verticals, and a three-spoke
    // spider at the bottom ring that clamps the shade to the stem.
    const F = this.part(S, "LampFrame", new vec3(0, SHADE_Y0, 0))
    const fk = new MeshKit()
    const wc = col("frame")
    const WR = 0.1
    const inset = (y: number) => lampShadeR(y) - 0.22
    const ringYs: number[] = []
    const NR = 9
    for (let i = 0; i < NR; i++) ringYs.push(PAPER_Y0 + 0.4 + ((PAPER_Y1 - PAPER_Y0 - 0.8) * i) / (NR - 1))
    // 48 segments keep the rings round up close; a 1 mm wire needs only three sides.
    for (const y of ringYs) wireRing(fk, inset(y), y, WR, 48, 3, wc)
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * TAU + TAU / 8
      const d = new vec3(Math.cos(a), 0, Math.sin(a))
      const pts: vec3[] = []
      for (let i = 0; i <= 24; i++) {
        const y = ringYs[0] + ((ringYs[NR - 1] - ringYs[0]) * i) / 24
        pts.push(d.uniformScale(inset(y)).add(new vec3(0, y, 0)))
      }
      tube(fk, pts, WR, 4, wc, false)
    }
    const hubY = SHADE_Y0 + RING_H / 2
    lathe(fk, new vec3(0, hubY - 0.6, 0), vec3.up(), puck(0.95, 0, 1.2, 0.12, 0.12, {rIn: STEM_R}), 20, col("steel"))
    for (let q = 0; q < 3; q++) {
      const a = (q / 3) * TAU + TAU / 12
      const d = new vec3(Math.cos(a), 0, Math.sin(a))
      tube(fk, [d.uniformScale(0.9).add(new vec3(0, hubY, 0)), d.uniformScale(inset(ringYs[0]) - 0.05).add(new vec3(0, ringYs[0], 0))], 0.13, 5, col("steel"))
    }
    this.mesh(F, "Mesh", fk, "frame", ORDER.frame)
  }

  // ------------------------------------------------------------------ socket and bulb

  private buildSocket(): void {
    const S = this.part(this.root, "LampSocket", new vec3(0, SOCKET_Y0, 0))
    const k = new MeshKit()
    const y0 = SOCKET_Y0
    const cav = BULB_Y0 - SOCKET_Y0
    const RI = 1.4
    lathe(
      k,
      new vec3(0, y0, 0),
      vec3.up(),
      [
        [{r: STEM_R, y: 0, nr: 0, ny: -1}, {r: 0.85, y: 0, nr: 0, ny: -1}],
        [...roundBottom(0.95, 0, 0.1, 2), {r: 0.95, y: 0.6, nr: 1, ny: 0}],
        [{r: 0.95, y: 0.6, nr: 0, ny: -1}, {r: SOCKET_R - 0.35, y: 0.6, nr: 0, ny: -1}],
        [...roundBottom(SOCKET_R, 0.6, 0.35, 3), {r: SOCKET_R, y: 3.2, nr: 1, ny: 0}],
        [{r: SOCKET_R, y: 3.2, nr: 0, ny: 1}, {r: SOCKET_R + 0.1, y: 3.2, nr: 0, ny: 1}],
        [{r: SOCKET_R + 0.1, y: 3.2, nr: 1, ny: 0}, ...roundTop(SOCKET_R + 0.1, SOCKET_H, 0.14, 3)],
        [{r: SOCKET_R - 0.04, y: SOCKET_H, nr: 0, ny: 1}, {r: RI, y: SOCKET_H, nr: 0, ny: 1}],
        [{r: RI, y: SOCKET_H, nr: -1, ny: 0}, {r: RI, y: cav, nr: -1, ny: 0}],
        [{r: RI, y: cav, nr: 0, ny: 1}, {r: 0, y: cav, nr: 0, ny: 1}]
      ],
      36,
      col("socket")
    )
    this.mesh(S, "Mesh", k, "socket", ORDER.socket)
  }

  private buildBulb(): void {
    const B = this.part(this.root, "LampBulb", new vec3(0, BULB_Y0, 0))
    const y0 = BULB_Y0
    const at = (y: number) => new vec3(0, y0 + y, 0)

    // Screw base (threads as a smooth zig-zag), the dark insulator and the bottom contact.
    const SB = this.part(B, "LampBulbBase", at(0))
    const sk = new MeshKit()
    const th: PP[] = [{r: 0.75, y: 0.3, nr: 0, ny: -1}]
    th.push({r: 1.12, y: 0.3, nr: 0.4, ny: -1})
    const PITCH = 0.36
    for (let y = 0.45, i = 0; y <= SCREW_TOP - 0.05; y += PITCH / 2, i++) {
      const crest = i % 2 === 0
      th.push({r: crest ? 1.33 : 1.18, y, nr: 1, ny: crest ? 0 : 0.15})
    }
    th.push({r: 1.3, y: SCREW_TOP, nr: 1, ny: 0.2})
    lathe(sk, at(0), vec3.up(), [th], 24, col("chrome"))
    lathe(sk, at(0), vec3.up(), puck(0.75, 0.0, 0.3, 0.08, 0.05, {top: false}), 16, col("dark"))
    lathe(sk, at(-0.06), vec3.up(), puck(0.32, 0, 0.1, 0.05, 0, {top: false}), 10, col("chrome"))
    this.mesh(SB, "Screw", sk, "chrome", ORDER.screw)
    const nk = new MeshKit()
    lathe(nk, at(SCREW_TOP), vec3.up(), [[{r: 1.3, y: 0, nr: 0, ny: -1}, {r: 1.36, y: 0, nr: 1, ny: 0}, {r: 1.36, y: NECK_Y0 - SCREW_TOP, nr: 1, ny: 0}]], 24, col("dark"))
    // Housing: white plastic flaring from the screw to the glass (concave, as on an A60), its top a
    // lip the envelope sits in.
    const neck: PP[] = []
    // r = R0 + ΔR·s^NP, with NP chosen so its slope at the top is the glass flank's (smooth silhouette).
    const NP = (GLASS_SLOPE * (NECK_Y1 - 0.1 - NECK_Y0)) / (NECK_R1 - 0.1 - NECK_R0)
    for (let i = 0; i <= 10; i++) {
      const s = i / 10
      const y = NECK_Y0 + (NECK_Y1 - 0.1 - NECK_Y0) * s
      const r = NECK_R0 + (NECK_R1 - 0.1 - NECK_R0) * Math.pow(s, NP)
      const dr = ((NECK_R1 - 0.1 - NECK_R0) * NP * Math.pow(Math.max(s, 1e-3), NP - 1)) / (NECK_Y1 - 0.1 - NECK_Y0)
      neck.push({r, y: y - SCREW_TOP, nr: 1, ny: -dr})
    }
    neck.unshift({r: 1.36, y: NECK_Y0 - SCREW_TOP, nr: 0, ny: -1})
    neck.splice(1, 0, {r: NECK_R0, y: NECK_Y0 - SCREW_TOP, nr: 0, ny: -1})
    neck.push(...roundTop(NECK_R1, NECK_Y1 - SCREW_TOP, 0.1, 3))
    neck.push({r: BOARD_R, y: NECK_Y1 - SCREW_TOP, nr: 0, ny: 1})
    lathe(nk, at(SCREW_TOP), vec3.up(), [neck], 32, col("plastic"))
    this.mesh(SB, "Neck", nk, "plastic", ORDER.neck)

    // LED board: an aluminium disc on the housing's top, with a ring of eight phosphor-coated chips
    // and four inner ones (12).
    const LB = this.part(B, "LampLedBoard", at(BOARD_Y))
    const bk = new MeshKit()
    lathe(bk, at(BOARD_Y), vec3.up(), puck(BOARD_R, 0, 0.16, 0.04, 0, {bottom: false}), 32, col("board"))
    this.mesh(LB, "Mesh", bk, "board", ORDER.board)
    const LC = this.part(LB, "LampLedChips", at(BOARD_Y + 0.16))
    const ck = new MeshKit()
    const X = new vec3(1, 0, 0)
    const Y = vec3.up()
    const Z = new vec3(0, 0, 1)
    const chip = (x: number, z: number, ang: number) => {
      const ax = new vec3(Math.cos(ang), 0, -Math.sin(ang))
      const az = new vec3(Math.sin(ang), 0, Math.cos(ang))
      const c = at(BOARD_Y + 0.16).add(new vec3(x, 0.05, z))
      bevelBox(ck, c, ax, Y, az, new vec3(0.17, 0.06, 0.14), 0.035, col("chip"))
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU
      chip(Math.cos(a) * 1.35, Math.sin(a) * 1.35, -a)
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + TAU / 8
      chip(Math.cos(a) * 0.55, Math.sin(a) * 0.55, -a)
    }
    this.mesh(LC, "Mesh", ck, "chip", ORDER.chips)

    // Frosted envelope (A60): from the housing's lip a cone opens into the 6 cm sphere it is tangent
    // to, round over the top. Its own part, so it lifts off the LED board in the take-apart.
    const G = this.part(B, "LampBulbGlass", at(GLASS_Y0))
    const gk = new MeshKit()
    const flank = {nr: 1, ny: -GLASS_SLOPE}
    const g: PP[] = [{r: GLASS_R0 - 0.12, y: 0, nr: 0, ny: -1}, {r: GLASS_R0, y: 0, nr: 0, ny: -1}, {r: GLASS_R0, y: 0, ...flank}, {r: GLASS_RT, y: GLASS_YT, ...flank}]
    const phiT = Math.asin((GLASS_YT - GLASS_YC) / GLASS_R)
    for (let i = 1; i <= 18; i++) {
      const phi = phiT + ((Math.PI / 2 - phiT) * i) / 18
      g.push({r: GLASS_R * Math.cos(phi), y: GLASS_YC + GLASS_R * Math.sin(phi), nr: Math.cos(phi), ny: Math.sin(phi)})
    }
    lathe(gk, at(GLASS_Y0), vec3.up(), [g], 40, col("frost"))
    this.mesh(G, "Mesh", gk, "frost", ORDER.glass)

    // Driver board (interior): a small vertical board inside the base and neck, with a capacitor,
    // a coil, a rectifier and the controller chip, and its two leads up to the LED board.
    const D = this.part(B, "LampDriver", at(0.35), undefined, true)
    const dk = new MeshKit()
    const dy = (y: number) => at(0.35 + y)
    bevelBox(dk, dy(2.35), X, Y, Z, new vec3(0.92, 2.3, 0.06), 0.03, col("pcb"))
    lathe(dk, dy(3.0).add(new vec3(0.42, 0, 0.42)), Y, puck(0.33, 0, 1.05, 0.08, 0.04), 14, rgb(0.3, 0.42, 0.62))
    lathe(dk, dy(3.55).add(new vec3(-0.45, 0, 0.06)), Z, puck(0.3, 0, 0.42, 0.05, 0.05, {rIn: 0.1}), 14, rgb(0.85, 0.52, 0.3))
    bevelBox(dk, dy(1.6).add(new vec3(0, 0, 0.13)), X, Y, Z, new vec3(0.3, 0.22, 0.07), 0.02, col("dark"))
    bevelBox(dk, dy(0.8).add(new vec3(0, 0, 0.13)), X, Y, Z, new vec3(0.24, 0.18, 0.07), 0.02, col("dark"))
    for (const sx of [-1, 1]) tube(dk, catmull([dy(4.6).add(new vec3(sx * 0.6, 0, 0)), dy(5.0).add(new vec3(sx * 0.9, 0, 0.2)), at(BOARD_Y - 0.02).add(new vec3(sx * 1.0, 0, 0.3))], 3), 0.05, 4, sx < 0 ? rgb(0.85, 0.32, 0.26) : rgb(0.9, 0.9, 0.88))
    this.mesh(D, "Mesh", dk, "pcb", ORDER.interior)
  }

  // ------------------------------------------------------------------ cord, foot switch, plug

  private buildCord(): void {
    const C = this.part(this.root, "LampCord", vec3.zero())
    const out = yawDir(CORD_EXIT_DEG)
    const exit = out.uniformScale(BASE_R - 0.2).add(new vec3(0, 0.95, 0))
    const lay = CORD_R
    const su = yawDir(SWITCH_DEG)
    const sIn = SWITCH_AT.add(su.uniformScale(-SWITCH_HALF.x - 0.5)).add(new vec3(0, lay, 0))
    const sOut = SWITCH_AT.add(su.uniformScale(SWITCH_HALF.x + 0.5)).add(new vec3(0, lay, 0))
    const pu = yawDir(PLUG_DEG)
    const pIn = PLUG_AT.add(pu.uniformScale(-2.3)).add(new vec3(0, lay, 0))
    const k = new MeshKit()
    // Strain-relief grommet where the cord leaves the base's rim.
    lathe(k, exit.sub(out.uniformScale(0.25)), out, puck(0.48, 0, 0.95, 0.12, 0, {bottom: false}), 12, col("cord"))
    lathe(k, exit.add(out.uniformScale(0.7)), out, puck(0.36, 0, 1.2, 0.1, 0, {bottom: false, top: false}), 10, col("cord"))
    const run1 = catmull([exit.add(out.uniformScale(1.5)), exit.add(out.uniformScale(4.5)).add(new vec3(0, lay - 0.95, 0)), new vec3(20.5, lay, 15.6), sIn.sub(su.uniformScale(2.5)), sIn], 6)
    const onFloor = (pts: vec3[]) => pts.map((p) => new vec3(p.x, Math.max(lay, p.y), p.z))
    tube(k, onFloor(even(run1, 1.5)), CORD_R, 8, col("cord"), false)
    const run2 = catmull([sOut, sOut.add(su.uniformScale(2.5)), new vec3(46, lay, 21.5), new vec3(56, lay, 18.0), pIn.sub(pu.uniformScale(3)), pIn], 6)
    tube(k, onFloor(even(run2, 1.5)), CORD_R, 8, col("cord"), false)
    this.mesh(C, "Mesh", k, "cord", ORDER.cord)

    // Inline foot switch: a soft rounded box the cord runs through, with a round button on top.
    const S = this.part(C, "LampSwitch", SWITCH_AT, yawQuat(SWITCH_DEG))
    const bk = new MeshKit()
    const H = SWITCH_HALF
    slab(bk, roundedRect(0, 0, H.x, H.z, 1.3, 5), 0, H.y, 0.85, 0.15, col("plastic"), 5)
    // Strain reliefs where the cord enters, resting on the floor (centre at their radius).
    for (const sx of [-1, 1]) lathe(bk, new vec3(sx * (H.x - 0.1), 0.4, 0), new vec3(sx, 0, 0), puck(0.39, 0, 0.75, 0.12, 0, {bottom: false}), 12, col("plastic"))
    // The seam round the button.
    lathe(bk, new vec3(0.35, H.y - 0.02, 0), vec3.up(), [[{r: 1.22, y: 0.025, nr: 0, ny: 1}, {r: 1.38, y: 0.02, nr: 0, ny: 1}]], 28, col("dark"))
    this.mesh(S, "Body", bk, "plastic", ORDER.switchBody, true)
    const BT = this.part(S, "LampSwitchButton", vec3.zero())
    BT.getTransform().setLocalPosition(new vec3(0.35, H.y, 0))
    this.pivots["LampSwitchButton"] = SWITCH_AT.add(new vec3(0, H.y, 0))
    const tk = new MeshKit()
    lathe(tk, new vec3(0, -0.1, 0), vec3.up(), [[...roundBottom(1.15, 0, 0.05, 2), ...roundTop(1.15, 0.55, 0.3, 4)], [{r: 0.85, y: 0.55, nr: 0, ny: 1}, {r: 0, y: 0.62, nr: 0, ny: 1}]], 28, col("button"))
    this.mesh(BT, "Mesh", tk, "button", ORDER.button, true)

    // Plug at the cord's end (two round pins, no markings).
    const PL = this.part(C, "LampPlug", PLUG_AT, yawQuat(PLUG_DEG))
    const pk = new MeshKit()
    slab(pk, roundedRect(0, 0, 1.75, 1.3, 0.45, 4), 0, 1.55, 0.4, 0.1, col("plastic"), 4)
    lathe(pk, new vec3(-1.7, 0.41, 0), new vec3(-1, 0, 0), puck(0.4, 0, 0.75, 0.1, 0, {bottom: false}), 12, col("plastic"))
    for (const sz of [-1, 1]) lathe(pk, new vec3(1.7, 0.78, sz * 0.95), new vec3(1, 0, 0), puck(0.2, 0, 1.9, 0.08, 0, {bottom: false}), 10, col("chrome"))
    this.mesh(PL, "Body", pk, "plastic", ORDER.plug, true)
  }

  // ------------------------------------------------------------------ interior wiring

  private buildWires(): void {
    const W = this.part(this.root, "LampWires", vec3.zero(), undefined, true)
    const k = new MeshKit()
    const out = yawDir(CORD_EXIT_DEG)
    const side = new vec3(-out.z, 0, out.x)
    ;[rgb(0.85, 0.32, 0.26), rgb(0.35, 0.5, 0.9)].forEach((c, i) => {
      const o = side.uniformScale(i === 0 ? -0.13 : 0.13)
      const pts = catmull([out.uniformScale(BASE_R - 0.6).add(new vec3(0, 0.95, 0)).add(o), out.uniformScale(7).add(new vec3(0, 1.0, 0)).add(o), out.uniformScale(1.2).add(new vec3(0, 1.4, 0)).add(o), new vec3(0, 3.2, 0).add(o), new vec3(0, 6, 0).add(o)], 5)
      pts.push(new vec3(0, SOCKET_Y0 + 1.0, 0).add(o))
      tube(k, pts, 0.07, 5, c)
    })
    this.mesh(W, "Mesh", k, "wire", ORDER.interior)
  }
}
