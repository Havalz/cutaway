/**
 * Record player hero, Phase A (devpost/recordplayer-hero.md): the record player built in code from
 * the reference image (devpost/refs/recordplayer/) and the Evening Room's deck, which was measured
 * in the preview by calibrated photogrammetry (front, side and top views, f = 2625 px).
 *
 * Model space, cm at 1x: origin = the plinth's footprint centre on the shelf; +X toward the
 * tonearm, +Y up, +Z toward the front. Every part is its own SceneObject (named "Rp…") with its
 * pivot at its real hinge or centre. Solids are clones of the RecordPlayerShell material (uber PBR,
 * additive, vertex colour = albedo used as the camera replica's 35% emissive lift, warm white
 * fresnel rim), lit by the model's own key and fill lights on its own render layer. Faces are wound
 * to match their normals, so back faces are culled.
 */
import {MeshKit} from "./CutawayGeometry"
import {addPoly, bevelBox, clipPoly, extrudeX, Poly} from "./CutawayHeroParts"

const TAU = Math.PI * 2
const DEG = Math.PI / 180

// =====================================================================================
// The room's deck (measured) and the model's layout
// =====================================================================================

/** The Evening Room's record player, measured in the preview (cm). x = width, y = height, z = depth. */
export const ROOM_DECK = {
  /** Footprint centre on the shelf (world). */
  origin: new vec3(-102.37, -142.2, -466.62),
  /** Overall bounds, dust cover open as in the room. */
  overall: new vec3(44.6, 39.9, 43.2),
  /** The plinth: footprint and the height of its top surface above the shelf. */
  plinth: new vec3(44.6, 5.35, 34.8)
}

/** Plinth: footprint half extents, feet, dark base band, silver top plate. */
const PL_HW = 22.3
const PL_HD = 17.4
const FOOT_TOP = 0.9
const BAND_TOP = 4.0
const TOP_Y = 5.35
const BAND_INSET = 0.15

/** Platter axis (x, z), heights and radii. */
const AXIS_X = -4.38
const AXIS_Z = -0.08
const PLATTER_Y0 = 5.73
const PLATTER_Y1 = 7.4
const PLATTER_R = 16.7
const MAT_Y0 = 7.2
const MAT_Y1 = 7.45
const MAT_R = 15.6
const REC_Y1 = 7.6
const REC_R = 15.0
const LABEL_R = 5.0
const HOLE_R = 0.37
const SPINDLE_R = 0.36
const SPINDLE_TOP = 8.22

/** Tonearm: the yaw axis (x, z) and the tube's height; the stylus tip sits on the record at lift 0. */
const PIVOT_X = 15.22
const PIVOT_Z = -8.58
const ARM_Y = 9.3
/** Headshell yaw relative to the arm (its forward is 35° toward the platter). */
const HEADSHELL_YAW = -35
/** S-arm centreline in arm space (x, z), from behind the gimbal to the headshell joint (traced from the room's deck, top view). */
const ARM_PATH: [number, number][] = [
  [0, -4.0],
  [0, -1.5],
  [0, 1.0],
  [0.02, 3.5],
  [0.3, 6.0],
  [0.75, 8.5],
  [1.12, 10.6],
  [1.08, 12.6],
  [0.6, 14.6],
  [-0.2, 16.3],
  [-1.05, 17.55],
  [-1.75, 18.3]
]
const ARM_R = 0.45
/** Cartridge centre in headshell space, and the stylus root (its suspension) in cartridge space. */
const CART_POS = new vec3(0, -0.93, 2.55)
const STYLUS_ROOT = new vec3(0, -0.38, 0.62)

/** Dust cover: hinge axis, outer size, open angle (about +X). */
const HINGE_Y = TOP_Y
const HINGE_Z = -17.41
const COVER_HW = 21.8
const COVER_D = 34.9
const COVER_H = 5.7
const COVER_OPEN = -94.4
const HINGE_X = 12.45

/** Interior: motor axis (x, z) under the platter, belt height. */
const MOTOR_X = -15.5
const MOTOR_Z = -7.5
const BELT_Y = 6.15

/** The model's layout for the hero stage (model space, cm at 1x). */
export const RP_GEOM = {
  plinthHalf: new vec2(PL_HW, PL_HD),
  plinthCorner: 0.9,
  topY: TOP_Y,
  feet: [new vec2(-19.4, -14.5), new vec2(19.4, -14.5), new vec2(-19.4, 14.5), new vec2(19.4, 14.5)],
  footSole: 1.85,
  /** Platter axis (x, z), the record's top surface, its radius, the grooved band and the label. */
  axis: new vec2(AXIS_X, AXIS_Z),
  recordTop: REC_Y1,
  recordR: REC_R,
  grooveOuter: 14.6,
  grooveInner: 5.6,
  labelR: LABEL_R,
  platterR: PLATTER_R,
  /** Tonearm yaw and lift pivot. */
  pivot: new vec3(PIVOT_X, ARM_Y, PIVOT_Z),
  /** Dust cover: hinge line and its open size. */
  hinge: new vec3(0, HINGE_Y, HINGE_Z),
  coverHalfW: COVER_HW,
  coverDepth: COVER_D,
  coverOpenDeg: COVER_OPEN,
  /** The S-arm's centreline in the lift frame (x, z), pivot to headshell joint. */
  armPath: ARM_PATH.map(([x, z]) => new vec2(x, z)),
  motor: new vec3(MOTOR_X, 2.6, MOTOR_Z),
  subPlatterR: 5.42,
  pulleyR: 0.48,
  beltY: BELT_Y
}

// =====================================================================================
// Finishes
// =====================================================================================

export type Finish = "shell" | "band" | "rubber" | "silver" | "ring" | "chrome" | "vinyl" | "label" | "tube" | "dark" | "glass" | "copper" | "magnet" | "wire"

interface FinishSpec {
  albedo: vec3
  metallic: number
  roughness: number
  rim: number
  rimExp: number
  /**
   * The emissive lift (vertex colour). On an additive display a dark part lifted by 35% of its own
   * albedo emits almost nothing, so the room shows through it and it reads as a hole. Dark finishes
   * carry their own lift: enough light to read as a solid dark grey surface, still darker than the
   * silver parts. Defaults to the albedo.
   */
  emit?: number
}

const grey = (v: number) => new vec3(v, v, v)

/**
 * Base colours sampled from the reference, lifted so dark parts read as dark grey on an additive
 * display. Two tones as in the reference: a bright silver top plate ("shell", the RecordPlayerShell
 * asset's own values) over a dark grey base band; the platter's metal ring brighter and shinier; the
 * record dark grey with a soft sheen on its grooves.
 */
const FINISH: Record<Finish, FinishSpec> = {
  shell: {albedo: grey(0.86), metallic: 0.5, roughness: 0.3, rim: 0.32, rimExp: 2.5},
  band: {albedo: grey(0.12), metallic: 0.15, roughness: 0.45, rim: 0.7, rimExp: 2.0, emit: 0.32},
  rubber: {albedo: grey(0.14), metallic: 0, roughness: 0.8, rim: 0.5, rimExp: 2.2, emit: 0.32},
  silver: {albedo: grey(0.72), metallic: 0.45, roughness: 0.35, rim: 0.35, rimExp: 2.5},
  ring: {albedo: grey(0.96), metallic: 0.85, roughness: 0.12, rim: 0.6, rimExp: 2.2},
  chrome: {albedo: grey(0.8), metallic: 0.7, roughness: 0.2, rim: 0.45, rimExp: 2.5},
  vinyl: {albedo: grey(0.14), metallic: 0.3, roughness: 0.2, rim: 0.5, rimExp: 2.5, emit: 0.34},
  label: {albedo: new vec3(0.7, 0.68, 0.64), metallic: 0, roughness: 0.6, rim: 0.3, rimExp: 2.5},
  tube: {albedo: new vec3(0.88, 0.87, 0.84), metallic: 0.3, roughness: 0.3, rim: 0.4, rimExp: 2.5},
  dark: {albedo: grey(0.2), metallic: 0.25, roughness: 0.45, rim: 0.5, rimExp: 2.5, emit: 0.4},
  glass: {albedo: grey(0.08), metallic: 0, roughness: 0.1, rim: 0.7, rimExp: 3},
  copper: {albedo: new vec3(0.85, 0.52, 0.32), metallic: 0.6, roughness: 0.35, rim: 0.4, rimExp: 2.5},
  magnet: {albedo: grey(0.42), metallic: 0.5, roughness: 0.3, rim: 0.4, rimExp: 2.5},
  wire: {albedo: grey(0.6), metallic: 0.2, roughness: 0.5, rim: 0.3, rimExp: 2.5}
}
/** Warm white fresnel rim, #FFF1D6. */
const RIM_WARM = new vec3(1, 0.945, 0.839)
/** Emissive intensity on the vertex colour: (0.62 × albedo)^2.2 ≈ 35% of the albedo in linear light. */
const LIFT = 0.62
/** Glass edge accents (glow material). */
const EDGE_GLOW = new vec4(0.42, 0.4, 0.35, 1)

const col = (f: Finish) => {
  const s = FINISH[f]
  const e = s.emit
  return e !== undefined ? new vec4(e, e, e, 1) : new vec4(s.albedo.x, s.albedo.y, s.albedo.z, 1)
}
const rgb = (r: number, g: number, b: number) => new vec4(r, g, b, 1)

/**
 * Draw order (lower first). The look is additive with depth writes, so a part must draw before
 * whatever it sits on or covers: drawn later, it would add its light on top of the part beneath.
 * The same holds inside one mesh, so overlapping pieces are added to a kit top-down.
 */
const ORDER = {stylus: 0, armTop: 1, arm: 2, cartridge: 3, spindle: 3, label: 4, baseTop: 4, record: 5, plate: 6, mat: 7, controls: 8, platter: 9, interior: 12, plinthTop: 20, band: 22, feet: 24, glass: 40, edges: 41}

// =====================================================================================
// Geometry helpers (all wound to their normals)
// =====================================================================================

/** A profile point: radius or outline offset `r`, height `y`, normal (`nr` outward, `ny` along the axis). */
interface PP {
  r: number
  y: number
  nr: number
  ny: number
}
/** Profile bands: each band is a smooth strip; neighbouring bands meet at a crease. */
type Bands = PP[][]

/** A plan outline point (x, z) with its outward unit normal. */
interface RP2 {
  p: vec2
  n: vec2
}

function basis(ax: vec3): {u: vec3; v: vec3} {
  const ref = Math.abs(ax.y) < 0.9 ? vec3.up() : new vec3(1, 0, 0)
  const u = ref.cross(ax).normalize()
  const v = ax.cross(u).normalize()
  return {u, v}
}

/** Surface of revolution of `bands` around axis `ax` through `c` (y = distance along the axis). */
function lathe(k: MeshKit, c: vec3, ax: vec3, bands: Bands, seg: number, color: vec4): void {
  const {u, v} = basis(ax)
  const cols = seg + 1
  for (const band of bands) {
    const base = k.vertexCount
    for (const p of band) {
      const nl = Math.hypot(p.nr, p.ny) || 1
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * TAU
        const d = u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)))
        k.vert(c.add(ax.uniformScale(p.y)).add(d.uniformScale(p.r)), d.uniformScale(p.nr / nl).add(ax.uniformScale(p.ny / nl)), color)
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

/**
 * A round part from y0 to y1: rounded top edge `rt`, rounded bottom edge `rb` (0 = sharp), flat caps,
 * optional centre hole `rIn`.
 */
function puck(r: number, y0: number, y1: number, rt: number, rb: number, opts: {bottom?: boolean; top?: boolean; rIn?: number} = {}): Bands {
  const rIn = opts.rIn ?? 0
  const bands: Bands = []
  if (opts.bottom !== false) bands.push([{r: rIn, y: y0, nr: 0, ny: -1}, {r: r - rb, y: y0, nr: 0, ny: -1}])
  const side: PP[] = rb > 0 ? roundBottom(r, y0, rb) : [{r, y: y0, nr: 1, ny: 0}]
  side.push(...(rt > 0 ? roundTop(r, y1, rt) : [{r, y: y1, nr: 1, ny: 0}]))
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
    for (let k = 0; k <= n; k++) {
      const a = a1 + (da * k) / n
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

/** A flat part on a plan outline from y0 to y1: rounded top edge `rt`, chamfered bottom edge `b`. */
function slab(k: MeshKit, ring: RP2[], y0: number, y1: number, rt: number, b: number, color: vec4, bottom: boolean = true): void {
  const bands: Bands = []
  if (b > 0) bands.push([{r: -b, y: y0, nr: 1, ny: -1}, {r: 0, y: y0 + b, nr: 1, ny: -1}])
  bands.push([{r: 0, y: y0 + b, nr: 1, ny: 0}, ...roundTop(0, y1, rt)])
  sweep(k, ring, bands, color)
  cap(k, ring, -rt, y1, true, color)
  if (bottom) cap(k, ring, -b, y0, false, color)
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

/** A smooth round tube along a polyline, with flat end caps. */
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

/** A sphere (smooth), as a lathe around +Y. */
function sphere(k: MeshKit, c: vec3, r: number, color: vec4, seg: number = 10, rows: number = 6): void {
  const band: PP[] = []
  for (let i = 0; i <= rows; i++) {
    const t = -Math.PI / 2 + (i / rows) * Math.PI
    band.push({r: Math.cos(t) * r, y: Math.sin(t) * r, nr: Math.cos(t), ny: Math.sin(t)})
  }
  lathe(k, c, vec3.up(), [band], seg, color)
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

/**
 * A prism: the (z, y) outline extruded across x in [-hx, hx], with every long edge chamfered by `b`
 * (the outline's own corners should already be chamfered). Flat faces, hard bevels.
 */
function bevelPrismX(k: MeshKit, outline: vec2[], hx: number, b: number, color: vec4, at: vec3 = vec3.zero()): void {
  let faces: Poly = extrudeX(outline, hx)
  const N = outline.length
  let area = 0
  for (let i = 0; i < N; i++) area += outline[i].x * outline[(i + 1) % N].y - outline[(i + 1) % N].x * outline[i].y
  const sg = area > 0 ? 1 : -1
  for (let i = 0; i < N; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % N]
    const e = q.sub(p).normalize()
    const m = new vec2(e.y * sg, -e.x * sg)
    const h = m.x * p.x + m.y * p.y
    for (const sx of [-1, 1]) {
      const nrm = new vec3(sx, m.y, m.x).uniformScale(Math.SQRT1_2)
      faces = clipPoly(faces, nrm, (hx + h - b) * Math.SQRT1_2)
    }
  }
  if (at.length > 0) faces = faces.map((f) => f.map((p) => p.add(at)))
  addPoly(k, faces, color)
}

/** Rotate (x, z) about +Y by `deg` (the same sense as quat.angleAxis about +Y). */
function yawXZ(p: vec3, deg: number): vec3 {
  const a = deg * DEG
  const c = Math.cos(a)
  const s = Math.sin(a)
  return new vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c)
}

// =====================================================================================
// The model
// =====================================================================================

export interface RecordPlayerModelCtx {
  /** Parent for the model's root. */
  parent: SceneObject
  /** RecordPlayerShell: uber PBR, additive, vertex colour as emissive, warm rim. */
  shellMat: Material
  /** Additive glow (edge accents). */
  glowMat: Material
  /** Render layer for the model and its lights (the camera must render it). */
  layer: LayerSet
}

export interface RpPartInfo {
  name: string
  so: SceneObject
  interior: boolean
}

export interface RpTriangles {
  total: number
  exterior: number
  interior: number
  accent: number
  byPart: Record<string, number>
}

/** The record player model: one SceneObject per part, built once. */
export class RecordPlayerModel {
  readonly root: SceneObject
  /** Parts by name ("RpPlinth", "RpTonearm", …). */
  readonly parts: Record<string, SceneObject> = {}
  private interiorSos: SceneObject[] = []
  private meshes: {rmv: RenderMeshVisual; part: string; interior: boolean; accent: boolean; tris: number}[] = []
  private mats: Partial<Record<Finish, Material>> = {}
  private glow: Material
  private layer: LayerSet

  constructor(private ctx: RecordPlayerModelCtx) {
    this.layer = ctx.layer
    this.glow = ctx.glowMat.clone()
    this.glow.mainPass.twoSided = true
    this.root = this.node(ctx.parent, "RpModel", vec3.zero())
    this.buildLightRig()
    this.buildPlinth()
    this.buildDustCover()
    this.buildPlatter()
    this.buildRecord()
    this.buildTonearmBase()
    this.buildTonearm()
    this.buildInterior()
    this.setInteriorVisible(false)
  }

  // ------------------------------------------------------------------ public

  /** Show or hide the parts that are only seen taken apart (motor, belt, sub-platter, magnet, coils, wires). */
  setInteriorVisible(v: boolean): void {
    for (const so of this.interiorSos) so.enabled = v
  }

  triangles(): RpTriangles {
    const r: RpTriangles = {total: 0, exterior: 0, interior: 0, accent: 0, byPart: {}}
    for (const m of this.meshes) {
      r.total += m.tris
      if (m.accent) r.accent += m.tris
      else if (m.interior) r.interior += m.tris
      else r.exterior += m.tris
      r.byPart[m.part] = (r.byPart[m.part] ?? 0) + m.tris
    }
    return r
  }

  /** Bounds of the visible (exterior) meshes in the model's own space (root unrotated, any position and scale). */
  bounds(filter?: (part: string) => boolean): {min: vec3; max: vec3; size: vec3} {
    const inv = this.root.getTransform().getInvertedWorldTransform()
    let min = new vec3(1e9, 1e9, 1e9)
    let max = new vec3(-1e9, -1e9, -1e9)
    for (const m of this.meshes) {
      if (m.interior || m.accent || (filter && !filter(m.part))) continue
      const a = m.rmv.worldAabbMin()
      const b = m.rmv.worldAabbMax()
      for (const x of [a.x, b.x])
        for (const y of [a.y, b.y])
          for (const z of [a.z, b.z]) {
            const p = inv.multiplyPoint(new vec3(x, y, z))
            min = new vec3(Math.min(min.x, p.x), Math.min(min.y, p.y), Math.min(min.z, p.z))
            max = new vec3(Math.max(max.x, p.x), Math.max(max.y, p.y), Math.max(max.z, p.z))
          }
    }
    return {min, max, size: max.sub(min)}
  }

  /** The stylus tip in world space. */
  stylusTip(): vec3 {
    return this.parts["RpStylus"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, -0.39, 0.44))
  }

  partList(): RpPartInfo[] {
    return Object.keys(this.parts).map((name) => ({name, so: this.parts[name], interior: this.interiorSos.indexOf(this.parts[name]) >= 0}))
  }

  /** Every mesh: its visual, the part it belongs to, and whether it is interior or a glow accent. */
  meshList(): {rmv: RenderMeshVisual; part: string; interior: boolean; accent: boolean; tris: number}[] {
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

  /** A named part: its own SceneObject with its pivot at `pos` (in the parent's space). */
  private part(parent: SceneObject, name: string, pos: vec3, rot?: quat, interior: boolean = false): SceneObject {
    const so = this.node(parent, name, pos, rot)
    this.parts[name] = so
    if (interior) this.interiorSos.push(so)
    return so
  }

  private mat(f: Finish): Material {
    const have = this.mats[f]
    if (have) return have
    const m = this.ctx.shellMat.clone()
    if (f !== "shell") {
      const s = FINISH[f]
      const p = m.mainPass
      p.baseColor = new vec4(s.albedo.x, s.albedo.y, s.albedo.z, 1)
      p.metallic = s.metallic
      p.roughness = s.roughness
      p.rimColor = RIM_WARM
      p.rimIntensity = s.rim
      p.rimExponent = s.rimExp
      p.emissiveIntensity = LIFT
      if (f === "glass") p.depthWrite = false
    }
    this.mats[f] = m
    return m
  }

  /** Spawn a mesh child of a part. */
  private mesh(part: SceneObject, suffix: string, k: MeshKit, f: Finish | "glow", order: number): SceneObject {
    const so = this.node(part, part.name + suffix, vec3.zero())
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = k.build()
    rmv.mainMaterial = f === "glow" ? this.glow : this.mat(f)
    rmv.setRenderOrder(order)
    let interior = false
    let p: SceneObject | null = part
    while (p) {
      if (this.interiorSos.indexOf(p) >= 0) interior = true
      p = p.getParent()
    }
    this.meshes.push({rmv, part: part.name, interior, accent: f === "glow", tris: k.triangleCount})
    return so
  }

  private buildLightRig(): void {
    const rig = this.node(this.root, "RpLightRig", vec3.zero())
    const key = this.node(rig, "RpKeyLight", vec3.zero(), quat.lookAt(new vec3(0.45, -0.75, -0.5).normalize(), vec3.up()))
    const kl = key.createComponent("Component.LightSource") as LightSource
    kl.lightType = LightType.Directional
    kl.color = new vec3(1, 0.96, 0.9)
    kl.intensity = 1.2
    kl.renderLayer = this.layer
    const fill = this.node(rig, "RpFillLight", vec3.zero())
    const fl = fill.createComponent("Component.LightSource") as LightSource
    fl.lightType = LightType.Ambient
    fl.color = new vec3(0.85, 0.9, 1)
    fl.intensity = 0.5
    fl.renderLayer = this.layer
  }

  // ------------------------------------------------------------------ plinth

  private buildPlinth(): void {
    const P = this.part(this.root, "RpPlinth", vec3.zero())

    // Silver top plate: rounded top edge, a small chamfer under it, the overhang's underside.
    const top = new MeshKit()
    const ring = roundedRect(0, 0, PL_HW, PL_HD, 0.9, 5)
    sweep(top, ring, [[{r: -0.42, y: BAND_TOP, nr: 0, ny: -1}, {r: -0.12, y: BAND_TOP, nr: 0, ny: -1}], [{r: -0.12, y: BAND_TOP, nr: 1, ny: -1}, {r: 0, y: BAND_TOP + 0.12, nr: 1, ny: -1}], [{r: 0, y: BAND_TOP + 0.12, nr: 1, ny: 0}, ...roundTop(0, TOP_Y, 0.45, 5)]], col("shell"))
    cap(top, ring, -0.45, TOP_Y, true, col("shell"))
    this.mesh(P, "Shell", top, "shell", ORDER.plinthTop)

    // Dark base band (inset), chamfered at the bottom.
    const band = new MeshKit()
    const bring = roundedRect(0, 0, PL_HW - BAND_INSET, PL_HD - BAND_INSET, 0.8, 4)
    sweep(band, bring, [[{r: -0.2, y: FOOT_TOP, nr: 1, ny: -1}, {r: 0, y: FOOT_TOP + 0.2, nr: 1, ny: -1}], [{r: 0, y: FOOT_TOP + 0.2, nr: 1, ny: 0}, {r: 0, y: BAND_TOP, nr: 1, ny: 0}]], col("band"))
    cap(band, bring, -0.2, FOOT_TOP, false, col("band"))
    this.mesh(P, "Base", band, "band", ORDER.band)

    // Feet.
    const feet = this.part(P, "RpFeet", vec3.zero())
    const fk = new MeshKit()
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        lathe(fk, new vec3(sx * 19.4, 0, sz * 14.5), vec3.up(), [[{r: 0, y: 0, nr: 0, ny: -1}, {r: 1.85, y: 0, nr: 0, ny: -1}], [...roundBottom(2.1, 0, 0.25), {r: 2.1, y: FOOT_TOP, nr: 1, ny: 0}]], 20, col("rubber"))
    this.mesh(feet, "Mesh", fk, "rubber", ORDER.feet)

    // Controls: shallow raised shapes with a dark seam around them.
    const button = (name: string, x: number, z: number, hw: number, hd: number, r: number, h: number, f: Finish) => {
      const so = this.part(P, name, new vec3(x, TOP_Y, z))
      const k = new MeshKit()
      const br = roundedRect(0, 0, hw, hd, r, 4)
      slab(k, br, 0, h, Math.min(0.12, h * 0.4), 0, col(f), false)
      this.mesh(so, "Mesh", k, f, ORDER.controls)
      const seam = new MeshKit()
      sweep(seam, br, [[{r: 0, y: 0.012, nr: 0, ny: 1}, {r: 0.12, y: 0.012, nr: 0, ny: 1}]], col("band"))
      this.mesh(so, "Seam", seam, "band", ORDER.controls)
      return so
    }
    button("RpStartStop", -19.4, 14.7, 2.3, 1.7, 0.3, 0.35, "silver")
    button("RpSpeed33", -15.55, 15.9, 1.2, 0.5, 0.2, 0.25, "silver")
    button("RpSpeed45", -12.9, 15.9, 1.2, 0.5, 0.2, 0.25, "silver")
    button("RpPitchReset", 4.24, 15.8, 1.3, 0.72, 0.68, 0.3, "silver")

    // Back-left dial (flat, stepped) and front-left knob (taller, with an index line).
    const dial = this.part(P, "RpStrobeLamp", new vec3(-18.75, TOP_Y, -14.28))
    const dk = new MeshKit()
    lathe(dk, vec3.zero(), vec3.up(), puck(1.55, 0.4, 0.48, 0.05, 0, {bottom: false}), 32, col("shell"))
    lathe(dk, vec3.zero(), vec3.up(), puck(2.05, 0, 0.4, 0.16, 0, {bottom: false}), 32, col("silver"))
    this.mesh(dial, "Mesh", dk, "silver", ORDER.controls)
    const knob = this.part(P, "RpPowerKnob", new vec3(-20.35, TOP_Y, 10.3))
    const kk = new MeshKit()
    lathe(kk, vec3.zero(), vec3.up(), puck(1.42, 0.18, 1.25, 0.22, 0, {bottom: false}), 28, col("silver"))
    lathe(kk, vec3.zero(), vec3.up(), puck(1.7, 0, 0.18, 0.06, 0, {bottom: false}), 28, col("shell"))
    this.mesh(knob, "Mesh", kk, "shell", ORDER.controls)
    const idx = new MeshKit()
    bevelBox(idx, new vec3(0, 1.258, 0.72), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.06, 0.012, 0.42), 0.005, col("band"))
    this.mesh(knob, "Index", idx, "band", ORDER.stylus)

    // Pitch slider: frame, slot and scale ticks, and the fader.
    const slider = this.part(P, "RpPitchSlider", new vec3(19.15, TOP_Y, 6.75))
    const sk = new MeshKit()
    slab(sk, roundedRect(0, 0, 1.55, 6.2, 0.3, 4), 0, 0.32, 0.1, 0, col("silver"), false)
    this.mesh(slider, "Frame", sk, "silver", ORDER.controls)
    const slot = new MeshKit()
    cap(slot, roundedRect(0.55, 0, 0.12, 5.25, 0.11, 3), 0, 0.326, true, col("band"))
    for (let i = -5; i <= 5; i++) {
      const w = i === 0 ? 0.45 : 0.25
      cap(slot, roundedRect(-0.45 - w / 2, i * 0.95, w / 2, 0.025, 0.02, 1), 0, 0.326, true, col("band"))
    }
    this.mesh(slider, "Slot", slot, "band", ORDER.label)
    const fader = this.part(slider, "RpPitchFader", new vec3(0.55, 0.32, 0))
    const fk2 = new MeshKit()
    bevelBox(fk2, new vec3(0, 0.78, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.95, 0.08, 0.13), 0.04, col("chrome"))
    bevelBox(fk2, new vec3(0, 0.36, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.95, 0.36, 0.55), 0.12, col("silver"))
    this.mesh(fader, "Mesh", fk2, "silver", ORDER.stylus)

    // The dust cover's hinge blocks on the plinth.
    const hinges = this.part(P, "RpCoverHinges", new vec3(0, TOP_Y, HINGE_Z))
    const hk = new MeshKit()
    for (const sx of [-1, 1]) bevelBox(hk, new vec3(sx * HINGE_X, 0.27, 0.6), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(1.55, 0.27, 0.62), 0.1, col("dark"))
    this.mesh(hinges, "Mesh", hk, "dark", ORDER.controls)

    // Output jacks on the back of the band.
    const jacks = this.part(P, "RpRcaJacks", new vec3(17.8, 2.5, -(PL_HD - BAND_INSET)))
    const jk = new MeshKit()
    for (const [x, c] of [
      [-1, rgb(0.62, 0.28, 0.24)],
      [1, rgb(0.82, 0.82, 0.8)]
    ] as [number, vec4][]) {
      const back = new vec3(0, 0, -1)
      lathe(jk, new vec3(x, 0, 0), back, puck(0.5, 0, 0.18, 0.04, 0, {bottom: false}), 6, col("chrome"))
      lathe(jk, new vec3(x, 0, 0), back, puck(0.32, 0.18, 0.75, 0.05, 0, {bottom: false, rIn: 0.16}), 16, c)
      lathe(jk, new vec3(x, 0, 0), back, puck(0.1, 0.18, 0.7, 0.03, 0, {bottom: false}), 8, col("chrome"))
    }
    this.mesh(jacks, "Mesh", jk, "chrome", ORDER.controls)
  }

  // ------------------------------------------------------------------ dust cover

  private buildDustCover(): void {
    const C = this.part(this.root, "RpDustCover", new vec3(0, HINGE_Y, HINGE_Z), quat.angleAxis(COVER_OPEN * DEG, new vec3(1, 0, 0)))
    // Closed-pose geometry in hinge space: x ±21.8, y 0..5.7 (skirt height), z 0..34.9 (toward the front).
    const T = 0.3
    const ring = roundedRect(0, COVER_D / 2, COVER_HW, COVER_D / 2, 0.6, 4)
    const k = new MeshKit()
    const g = col("glass")
    sweep(
      k,
      ring,
      [
        [{r: 0, y: 0, nr: 1, ny: 0}, ...roundTop(0, COVER_H, 0.5, 4)],
        [{r: -T, y: 0, nr: 0, ny: -1}, {r: 0, y: 0, nr: 0, ny: -1}],
        [
          {r: -T, y: COVER_H - 0.5, nr: -1, ny: 0},
          {r: -T, y: 0, nr: -1, ny: 0}
        ],
        [
          {r: -T - 0.2, y: COVER_H - T, nr: 0, ny: -1},
          {r: -T - 0.06, y: COVER_H - T - 0.06, nr: -0.7, ny: -0.7},
          {r: -T, y: COVER_H - 0.5, nr: -1, ny: 0}
        ]
      ],
      g
    )
    cap(k, ring, -0.5, COVER_H, true, g)
    cap(k, ring, -T - 0.2, COVER_H - T, false, g)
    this.mesh(C, "Glass", k, "glass", ORDER.glass)

    // Edge accents: the top and bottom rims and the four corners, in warm white light.
    const e = new MeshKit()
    const rim = (off: number, y: number) => {
      const pts = ring.map((q) => new vec3(q.p.x + q.n.x * off, y, q.p.y + q.n.y * off))
      pts.push(pts[0])
      e.addTube(pts, 0.045, EDGE_GLOW, 5, 4)
    }
    rim(-0.16, COVER_H - 0.05)
    rim(-0.15, 0.02)
    for (const sx of [-1, 1])
      for (const sz of [0, 1]) {
        const p = new vec3(sx * (COVER_HW - 0.18), 0, 0.18 + sz * (COVER_D - 0.36))
        e.addTube([p, p.add(new vec3(0, COVER_H - 0.25, 0))], 0.045, EDGE_GLOW, 5, 50)
      }
    this.mesh(C, "Edges", e, "glow", ORDER.edges)

    // Hinge arms on the cover.
    const h = new MeshKit()
    for (const sx of [-1, 1]) {
      bevelBox(h, new vec3(sx * HINGE_X, 0.5, 0.3), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(1.0, 0.45, 0.6), 0.08, col("dark"))
      lathe(h, new vec3(sx * HINGE_X - 1.25, 0, 0), new vec3(1, 0, 0), puck(0.24, 0, 2.5, 0.05, 0.05), 10, col("dark"))
    }
    this.mesh(C, "Hinges", h, "dark", ORDER.controls)
  }

  // ------------------------------------------------------------------ platter, mat, spindle

  private buildPlatter(): void {
    const PT = this.part(this.root, "RpPlatter", new vec3(AXIS_X, PLATTER_Y0, AXIS_Z))
    const top = PLATTER_Y1 - PLATTER_Y0
    const floor = MAT_Y0 - PLATTER_Y0
    const web = 0.95
    const k = new MeshKit()
    lathe(
      k,
      vec3.zero(),
      vec3.up(),
      [
        [{r: 0, y: web, nr: 0, ny: -1}, {r: 15.95, y: web, nr: 0, ny: -1}],
        [{r: 15.95, y: web, nr: -1, ny: 0}, {r: 15.95, y: 0.08, nr: -1, ny: 0}],
        [{r: 15.95, y: 0.08, nr: -0.7, ny: -0.7}, {r: 16.03, y: 0, nr: -0.7, ny: -0.7}],
        [{r: 16.03, y: 0, nr: 0, ny: -1}, {r: PLATTER_R - 0.1, y: 0, nr: 0, ny: -1}],
        [...roundBottom(PLATTER_R, 0, 0.1, 2), ...roundTop(PLATTER_R, top, 0.18, 4)],
        [{r: PLATTER_R - 0.18, y: top, nr: 0, ny: 1}, {r: 15.95, y: top, nr: 0, ny: 1}],
        [{r: 15.95, y: top, nr: -0.8, ny: 0.6}, {r: 15.8, y: floor, nr: -0.8, ny: 0.6}],
        [{r: 15.8, y: floor, nr: 0, ny: 1}, {r: 0, y: floor, nr: 0, ny: 1}]
      ],
      96,
      col("ring")
    )
    this.mesh(PT, "Body", k, "ring", ORDER.platter)

    // Strobe dots: one fine row of 180 raised dots round the edge.
    const dots = new MeshKit()
    const yDot = top * 0.5
    const rho = 0.13
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * TAU
      const d = new vec3(Math.sin(a), 0, Math.cos(a))
      const t = new vec3(Math.cos(a), 0, -Math.sin(a))
      const c = d.uniformScale(PLATTER_R).add(new vec3(0, yDot, 0))
      const apex = dots.vert(c.add(d.uniformScale(0.05)), d, col("chrome"))
      const rim: number[] = []
      for (let s = 0; s < 6; s++) {
        const b = (s / 6) * TAU
        const o = t.uniformScale(Math.cos(b)).add(vec3.up().uniformScale(Math.sin(b)))
        rim.push(dots.vert(c.add(o.uniformScale(rho)).sub(d.uniformScale(0.01)), d.add(o.uniformScale(0.8)).normalize(), col("chrome")))
      }
      for (let s = 0; s < 6; s++) dots.triOut(apex, rim[s], rim[(s + 1) % 6])
    }
    this.mesh(PT, "StrobeDots", dots, "chrome", ORDER.spindle)

    // Rubber mat in the platter's recess.
    const mat = this.part(PT, "RpMat", new vec3(0, floor, 0))
    const mk = new MeshKit()
    const mh = MAT_Y1 - MAT_Y0
    lathe(mk, vec3.zero(), vec3.up(), puck(MAT_R, 0, mh, 0.1, 0, {rIn: HOLE_R}), 72, col("rubber"))
    // Two low ridges on the ring of mat that shows beyond the record.
    for (const rc of [15.15, 15.38]) {
      const ridge: PP[] = []
      for (let i = 0; i <= 3; i++) {
        const t = (i / 3) * Math.PI
        ridge.push({r: rc + 0.06 * Math.cos(t), y: mh + 0.035 * Math.sin(t), nr: Math.cos(t), ny: Math.sin(t)})
      }
      lathe(mk, vec3.zero(), vec3.up(), [ridge], 72, col("rubber"))
    }
    this.mesh(mat, "Mesh", mk, "rubber", ORDER.mat)

    // Spindle on the platter's axis.
    const sp = this.part(PT, "RpSpindle", new vec3(0, floor, 0))
    const spk = new MeshKit()
    const sh = SPINDLE_TOP - MAT_Y0
    lathe(
      spk,
      vec3.zero(),
      vec3.up(),
      [
        [
          {r: SPINDLE_R, y: 0, nr: 1, ny: 0},
          {r: SPINDLE_R, y: sh - 0.22, nr: 1, ny: 0},
          {r: SPINDLE_R - 0.03, y: sh - 0.12, nr: 0.8, ny: 0.6},
          {r: 0.22, y: sh - 0.03, nr: 0.45, ny: 0.9},
          {r: 0, y: sh, nr: 0, ny: 1}
        ]
      ],
      20,
      col("chrome")
    )
    this.mesh(sp, "Mesh", spk, "chrome", ORDER.spindle)
  }

  // ------------------------------------------------------------------ record

  private buildRecord(): void {
    const R = this.part(this.root, "RpRecord", new vec3(AXIS_X, MAT_Y1, AXIS_Z))
    const h = REC_Y1 - MAT_Y1
    const k = new MeshKit()
    const SEG = 64
    const bead: PP[] = []
    for (let i = 0; i <= 6; i++) {
      const t = -Math.PI / 2 + (i / 6) * Math.PI
      bead.push({r: REC_R - h / 2 + (h / 2) * Math.cos(t), y: h / 2 + (h / 2) * Math.sin(t), nr: Math.cos(t), ny: Math.sin(t)})
    }
    lathe(k, vec3.zero(), vec3.up(), [[{r: HOLE_R, y: 0, nr: 0, ny: -1}, {r: REC_R - h / 2, y: 0, nr: 0, ny: -1}], bead, [{r: REC_R - h / 2, y: h, nr: 0, ny: 1}, {r: 14.6, y: h, nr: 0, ny: 1}], [{r: HOLE_R, y: h, nr: -1, ny: 0}, {r: HOLE_R, y: 0, nr: -1, ny: 0}]], SEG, col("vinyl"))
    // Grooves: fine rings whose normals tilt in and out, so the key light catches them as a soft
    // sheen, with four quiet gaps between tracks. Their lift sits around the vinyl's own.
    const gaps = [12.4, 10.5, 8.9, 7.3]
    const v0 = FINISH.vinyl.emit
    let r = 14.6
    let n = 0
    while (r > 5.6 + 1e-3) {
      const gap = gaps.some((g) => Math.abs(r - g) < 0.13)
      const w = gap ? 0.34 : 0.25
      const r2 = Math.max(5.6, r - w)
      const tilt = gap ? 0 : (n % 2 === 0 ? 1 : -1) * 0.2
      const c = gap ? v0 + 0.02 : n % 2 === 0 ? v0 + 0.07 : v0 - 0.05
      lathe(k, vec3.zero(), vec3.up(), [[{r, y: h, nr: tilt, ny: 1}, {r: r2, y: h, nr: tilt, ny: 1}]], SEG, rgb(c, c, c))
      r = r2
      n++
    }
    lathe(k, vec3.zero(), vec3.up(), [[{r: 5.6, y: h, nr: 0, ny: 1}, {r: LABEL_R, y: h, nr: 0, ny: 1}]], SEG, col("vinyl"))
    this.mesh(R, "Vinyl", k, "vinyl", ORDER.record)

    const L = this.part(R, "RpRecordLabel", new vec3(0, h, 0))
    const lk = new MeshKit()
    lathe(lk, vec3.zero(), vec3.up(), [[{r: HOLE_R, y: 0.012, nr: 0, ny: 1}, {r: LABEL_R - 0.06, y: 0.012, nr: 0, ny: 1}, {r: LABEL_R, y: 0.002, nr: 0.3, ny: 1}], [{r: HOLE_R, y: 0.012, nr: -1, ny: 0}, {r: HOLE_R, y: -0.01, nr: -1, ny: 0}]], 64, col("label"))
    this.mesh(L, "Mesh", lk, "label", ORDER.label)
  }

  // ------------------------------------------------------------------ tonearm base, rest, cue

  private buildTonearmBase(): void {
    const B = this.part(this.root, "RpTonearmBase", new vec3(PIVOT_X, TOP_Y, PIVOT_Z))
    const k = new MeshKit()
    lathe(k, vec3.zero(), vec3.up(), puck(5.5, 0, 0.45, 0.12, 0, {bottom: false}), 64, col("dark"))
    this.mesh(B, "Plate", k, "dark", ORDER.plate)
    const s = new MeshKit()
    lathe(s, vec3.zero(), vec3.up(), puck(3.2, 0.45, 0.82, 0.08, 0, {bottom: false, rIn: 2.4}), 48, col("silver"))
    lathe(s, vec3.zero(), vec3.up(), puck(1.4, 0.45, 1.07, 0.12, 0, {bottom: false}), 32, col("silver"))
    lathe(s, vec3.zero(), vec3.up(), puck(0.95, 1.68, 2.55, 0.12, 0.08), 32, col("silver"))
    this.mesh(B, "Bearing", s, "silver", ORDER.baseTop)
    const c = new MeshKit()
    lathe(c, vec3.zero(), vec3.up(), puck(0.75, 1.07, 1.68, 0.06, 0, {bottom: false, top: false}), 24, col("chrome"))
    this.mesh(B, "Post", c, "chrome", ORDER.baseTop)

    // Cue lever: a housing on the plate, the lever (hinged at its back), and the lift bar under the arm.
    const housing = new MeshKit()
    bevelBox(housing, new vec3(2.08, 0.85, 1.58), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.42, 0.4, 0.75), 0.1, col("dark"))
    this.mesh(B, "CueHousing", housing, "dark", ORDER.baseTop)
    const lever = this.part(B, "RpCueLever", new vec3(2.08, 1.15, 1.95))
    const tip = new vec3(2.34, 2.45, 6.56).sub(new vec3(2.08, 1.15, 1.95))
    const lk = new MeshKit()
    lathe(lk, new vec3(-0.32, 0, 0), new vec3(1, 0, 0), puck(0.18, 0, 0.64, 0.05, 0.05), 12, col("chrome"))
    tube(lk, [vec3.zero(), tip.uniformScale(0.62)], 0.09, 8, col("chrome"))
    this.mesh(lever, "Rod", lk, "chrome", ORDER.baseTop)
    const hk = new MeshKit()
    const dir = tip.normalize()
    lathe(hk, tip.uniformScale(0.58), dir, [[...roundBottom(0.21, 0, 0.12, 3), ...roundTop(0.21, tip.length * 0.42, 0.18, 4)], [{r: 0.03, y: tip.length * 0.42, nr: 0, ny: 1}, {r: 0, y: tip.length * 0.42, nr: 0, ny: 1}]], 12, col("dark"))
    this.mesh(lever, "Handle", hk, "dark", ORDER.baseTop)
    const lift = this.part(B, "RpCueLift", new vec3(1.0, 0.45, 3.0))
    const ck = new MeshKit()
    bevelBox(ck, new vec3(-0.65, 2.88, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.85, 0.07, 0.22), 0.035, col("silver"))
    lathe(ck, vec3.zero(), vec3.up(), puck(0.16, 0, 2.82, 0.04, 0, {bottom: false}), 12, col("chrome"))
    this.mesh(lift, "Mesh", ck, "silver", ORDER.baseTop)

    // Anti-skate dial to the right of the bearing, on a short bar from the collar.
    const skate = this.part(B, "RpAntiSkate", new vec3(3.72, 0.45, 0.09))
    const ak = new MeshKit()
    lathe(ak, vec3.zero(), vec3.up(), puck(0.5, 0.95, 1.04, 0.04, 0, {bottom: false}), 16, col("silver"))
    lathe(ak, vec3.zero(), vec3.up(), puck(1.15, 0, 0.95, 0.15, 0, {bottom: false}), 32, col("dark"))
    bevelBox(ak, new vec3(-1.77, 0.4, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.62, 0.16, 0.3), 0.06, col("silver"))
    this.mesh(skate, "Mesh", ak, "dark", ORDER.baseTop)

    // Arm rest (on the plinth, under the tube where it parks) with its clip.
    const zRest = 4.42
    const xRest = PIVOT_X + this.armX(zRest - PIVOT_Z)
    const rest = this.part(B, "RpArmRest", new vec3(xRest - PIVOT_X, 0, zRest - PIVOT_Z))
    const rk = new MeshKit()
    lathe(rk, vec3.zero(), vec3.up(), puck(0.65, 0, 0.25, 0.08, 0, {bottom: false}), 20, col("silver"))
    lathe(rk, vec3.zero(), vec3.up(), puck(0.2, 0.25, 3.25, 0.04, 0, {bottom: false, top: false}), 10, col("chrome"))
    this.mesh(rest, "Post", rk, "chrome", ORDER.baseTop)
    const cradle = new MeshKit()
    const tubeBottom = ARM_Y - ARM_R - TOP_Y
    bevelBox(cradle, new vec3(0, tubeBottom - 0.1, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.62, 0.1, 0.3), 0.04, col("rubber"))
    for (const sx of [-1, 1]) bevelBox(cradle, new vec3(sx * 0.56, tubeBottom + 0.18, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.08, 0.3, 0.28), 0.03, col("rubber"))
    this.mesh(rest, "Cradle", cradle, "rubber", ORDER.baseTop)
    const tubeC = ARM_Y - TOP_Y
    const clip = this.part(rest, "RpArmClip", new vec3(0.62, tubeC, 0))
    const clk = new MeshKit()
    const arc: vec3[] = []
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * 160 * DEG
      arc.push(new vec3(-0.62 + 0.62 * Math.cos(a), 0.62 * Math.sin(a), 0))
    }
    tube(clk, arc, 0.05, 6, col("chrome"))
    sphere(clk, arc[arc.length - 1], 0.09, col("chrome"), 8, 4)
    this.mesh(clip, "Mesh", clk, "chrome", ORDER.baseTop)
  }

  /** The arm tube's x (arm space) at arm-space z, from the S path. */
  private armX(z: number): number {
    const pts = catmull(
      ARM_PATH.map(([x, zz]) => new vec3(x, 0, zz)),
      8
    )
    for (let i = 0; i < pts.length - 1; i++) if ((pts[i].z - z) * (pts[i + 1].z - z) <= 0) return pts[i].x + ((pts[i + 1].x - pts[i].x) * (z - pts[i].z)) / (pts[i + 1].z - pts[i].z || 1)
    return 0
  }

  // ------------------------------------------------------------------ tonearm, headshell, cartridge

  private buildTonearm(): void {
    // Yaw (swing) pivot at the tube's height, then the lift (cueing) pivot at the same point.
    const A = this.part(this.root, "RpTonearm", new vec3(PIVOT_X, ARM_Y, PIVOT_Z))
    const yoke = new MeshKit()
    lathe(yoke, new vec3(-0.86, 0, 0), new vec3(1, 0, 0), puck(0.16, 0, 1.72, 0.04, 0.04), 12, col("chrome"))
    for (const sx of [-1, 1]) bevelBox(yoke, new vec3(sx * 0.64, -0.42, 0), new vec3(1, 0, 0), new vec3(0, 1, 0), new vec3(0, 0, 1), new vec3(0.13, 0.86, 0.55), 0.05, col("silver"))
    lathe(yoke, new vec3(0, -1.4, 0), vec3.up(), puck(0.95, 0, 0.27, 0.06, 0.04), 32, col("silver"))
    this.mesh(A, "Yoke", yoke, "silver", ORDER.arm)

    const L = this.part(A, "RpTonearmLift", vec3.zero())
    const tubeSo = this.part(L, "RpArmTube", vec3.zero())
    const path = catmull(
      ARM_PATH.map(([x, z]) => new vec3(x, 0, z)),
      4
    )
    const tk = new MeshKit()
    tube(tk, path, ARM_R, 14, col("tube"))
    this.mesh(tubeSo, "Mesh", tk, "tube", ORDER.arm)
    const fit = new MeshKit()
    const Z = new vec3(0, 0, 1)
    lathe(fit, new vec3(0, 0, -0.55), Z, puck(0.55, 0, 1.1, 0.08, 0.08), 20, col("silver"))
    lathe(fit, new vec3(0, 0, -8.1), Z, puck(0.3, 0, 4.2, 0.06, 0.06), 12, col("chrome"))
    lathe(fit, new vec3(0, 0, -8.45), Z, puck(0.4, 0, 0.5, 0.12, 0.12), 16, col("silver"))
    this.mesh(tubeSo, "Fittings", fit, "chrome", ORDER.armTop)

    // Counterweight on the rear stub, with a bright ring at its sub-weight line.
    const cw = this.part(L, "RpCounterweight", new vec3(0, 0, -5.45))
    const ck = new MeshKit()
    lathe(ck, new vec3(0, 0, -1.15), Z, puck(1.3, 0, 2.3, 0.22, 0.22, {rIn: 0.3}), 28, col("dark"))
    lathe(ck, new vec3(0, 0, 0.35), Z, puck(1.32, 0, 0.12, 0.03, 0.03, {bottom: false, top: false}), 28, col("silver"))
    this.mesh(cw, "Mesh", ck, "dark", ORDER.stylus)

    // Headshell at the tube's end, turned toward the platter; finger lift on its outer side.
    const [jx, jz] = ARM_PATH[ARM_PATH.length - 1]
    const H = this.part(L, "RpHeadshell", new vec3(jx, 0, jz), quat.angleAxis(HEADSHELL_YAW * DEG, vec3.up()))
    const hk = new MeshKit()
    lathe(hk, new vec3(0, 0, -0.35), Z, puck(0.53, 0, 1.0, 0.1, 0.1), 18, col("silver"))
    this.mesh(H, "Collar", hk, "silver", ORDER.armTop)
    const plate = new MeshKit()
    const outline = roundedPoly([new vec2(-0.6, 0.45), new vec2(0.6, 0.45), new vec2(0.85, 4.2), new vec2(-0.85, 4.2)], 0.2, 3)
    for (const z of [1.95, 2.95]) lathe(plate, new vec3(0, -0.15, z), vec3.up(), puck(0.12, 0, 0.07, 0.03, 0, {bottom: false}), 10, col("chrome"))
    slab(plate, outline, -0.45, -0.15, 0.08, 0.05, col("dark"))
    this.mesh(H, "Plate", plate, "dark", ORDER.arm)
    const fl = this.part(H, "RpFingerLift", new vec3(0.78, -0.3, 3.5))
    const flk = new MeshKit()
    const flPath = catmull([new vec3(-0.1, 0, 0), new vec3(0.45, 0.05, 0.08), new vec3(0.85, 0.25, 0.14), new vec3(1.12, 0.58, 0.16)], 4)
    tube(flk, flPath, 0.09, 8, col("dark"))
    sphere(flk, flPath[flPath.length - 1], 0.15, col("dark"), 10, 5)
    this.mesh(fl, "Mesh", flk, "dark", ORDER.arm)

    // Cartridge under the headshell: chamfered body, stylus (cantilever + tip) at its front.
    const C = this.part(H, "RpCartridge", CART_POS)
    const body = new MeshKit()
    const b = 0.07
    bevelPrismX(body, [new vec2(-0.9 + b, 0.48), new vec2(0.9 - b, 0.48), new vec2(0.9, 0.48 - b), new vec2(0.9, -0.05), new vec2(0.62, -0.48), new vec2(-0.9 + b, -0.48), new vec2(-0.9, -0.48 + b), new vec2(-0.9, 0.48 - b)], 0.58, 0.06, rgb(0.3, 0.3, 0.32))
    this.mesh(C, "Body", body, "dark", ORDER.cartridge)
    const S = this.part(C, "RpStylus", STYLUS_ROOT)
    const st = new MeshKit()
    tube(st, [new vec3(0, 0, -0.05), new vec3(0, -0.3, 0.42)], 0.035, 6, col("chrome"))
    lathe(st, new vec3(0, -0.39, 0.44), vec3.up(), [[{r: 0, y: 0, nr: 1, ny: -0.3}, {r: 0.045, y: 0.1, nr: 1, ny: -0.3}], [{r: 0.045, y: 0.1, nr: 0, ny: 1}, {r: 0, y: 0.1, nr: 0, ny: 1}]], 8, col("chrome"))
    this.mesh(S, "Mesh", st, "chrome", ORDER.stylus)

    // Inside the cartridge (interior): the magnet on the cantilever's back end, two coils in a V.
    const magPos = new vec3(0, 0.02, -0.25)
    const mag = this.part(S, "RpCartridgeMagnet", magPos, undefined, true)
    const mk = new MeshKit()
    lathe(mk, new vec3(0, 0, -0.14), Z, puck(0.08, 0, 0.28, 0.02, 0.02), 10, rgb(0.62, 0.26, 0.24))
    this.mesh(mag, "Mesh", mk, "magnet", ORDER.interior)
    const coils = this.part(C, "RpCartridgeCoils", STYLUS_ROOT.add(magPos), undefined, true)
    const cok = new MeshKit()
    for (const sx of [-1, 1]) {
      const ax = new vec3(sx * 0.6, 0.8, -0.1).normalize()
      lathe(cok, ax.uniformScale(0.12), ax, puck(0.05, 0, 0.6, 0.015, 0.015), 8, col("chrome"))
      lathe(cok, ax.uniformScale(0.24), ax, puck(0.17, 0, 0.36, 0.05, 0.05, {rIn: 0.05}), 14, col("copper"))
    }
    this.mesh(coils, "Mesh", cok, "copper", ORDER.interior)

    // Signal wires along the arm (interior): cartridge pins → headshell → inside the tube → down the pivot.
    const wires = this.part(L, "RpSignalWiresArm", vec3.zero(), undefined, true)
    const wk = new MeshKit()
    const toArm = (p: vec3) => yawXZ(p, HEADSHELL_YAW).add(new vec3(jx, 0, jz))
    const back = path.slice().reverse()
    WIRE_COLORS.forEach((c, i) => {
      const ox = i % 2 === 0 ? -0.1 : 0.1
      const oy = i < 2 ? 0.1 : -0.1
      const pin = CART_POS.add(new vec3(ox * 1.5, oy * 1.5 - 0.1, -0.9))
      const lead = [pin, pin.add(new vec3(ox, 0.1, -0.35)), new vec3(ox * 2.2, -0.62, 0.95), new vec3(ox, oy, 0.15)].map(toArm)
      const run = back.filter((p) => p.z > 0.4 && p.z < jz - 0.4).map((p) => p.add(new vec3(ox, oy, 0)))
      const down = [new vec3(ox, oy, 0.15), new vec3(ox, -0.4, 0.1), new vec3(ox, -1.4, oy)]
      tube(wk, catmull(lead, 4).concat(run, down), 0.035, 4, c)
    })
    this.mesh(wires, "Mesh", wk, "wire", ORDER.interior)
  }

  // ------------------------------------------------------------------ interior

  private buildInterior(): void {
    const I = this.part(this.root, "RpInterior", vec3.zero(), undefined, true)

    // Motor under the platter, inside the plinth; its shaft comes up through the top plate.
    const M = this.part(I, "RpMotor", new vec3(MOTOR_X, 2.6, MOTOR_Z))
    const mk = new MeshKit()
    lathe(mk, vec3.zero(), vec3.up(), puck(1.9, -1.3, 1.15, 0.25, 0.25), 32, col("silver"))
    lathe(mk, vec3.zero(), vec3.up(), puck(2.3, 1.15, 1.32, 0.05, 0.05), 32, col("dark"))
    lathe(mk, vec3.zero(), vec3.up(), puck(0.1, 1.32, BELT_Y - 2.6 + 0.3, 0.03, 0, {bottom: false}), 8, col("chrome"))
    this.mesh(M, "Mesh", mk, "silver", ORDER.interior)
    const pul = this.part(M, "RpMotorPulley", new vec3(0, BELT_Y - 2.6, 0))
    const pk = new MeshKit()
    lathe(pk, vec3.zero(), vec3.up(), puck(0.48, -0.22, 0.22, 0.05, 0.05), 20, col("chrome"))
    this.mesh(pul, "Mesh", pk, "chrome", ORDER.interior)

    // Sub-platter on the platter's axis (under it), with the belt's groove and its bearing.
    const SP = this.part(I, "RpSubPlatter", new vec3(AXIS_X, 5.85, AXIS_Z))
    const sk = new MeshKit()
    const yb = BELT_Y - 5.85
    lathe(
      sk,
      vec3.zero(),
      vec3.up(),
      [
        [{r: 0.45, y: 0, nr: 0, ny: -1}, {r: 5.5, y: 0, nr: 0, ny: -1}],
        [...roundBottom(5.55, 0, 0.05, 2), {r: 5.55, y: yb - 0.17, nr: 1, ny: 0}],
        [{r: 5.55, y: yb - 0.17, nr: 0, ny: 1}, {r: 5.42, y: yb - 0.17, nr: 0, ny: 1}],
        [{r: 5.42, y: yb - 0.17, nr: 1, ny: 0}, {r: 5.42, y: yb + 0.17, nr: 1, ny: 0}],
        [{r: 5.42, y: yb + 0.17, nr: 0, ny: -1}, {r: 5.55, y: yb + 0.17, nr: 0, ny: -1}],
        [{r: 5.55, y: yb + 0.17, nr: 1, ny: 0}, ...roundTop(5.55, 0.62, 0.06, 2)],
        [{r: 5.49, y: 0.62, nr: 0, ny: 1}, {r: 1.0, y: 0.62, nr: 0, ny: 1}]
      ],
      48,
      col("silver")
    )
    lathe(sk, vec3.zero(), vec3.up(), puck(1.0, 0.62, 0.82, 0.06, 0, {bottom: false}), 24, col("chrome"))
    lathe(sk, vec3.zero(), vec3.up(), puck(0.45, -3.4, 0, 0.0, 0.05, {top: false}), 16, col("chrome"))
    lathe(sk, vec3.zero(), vec3.up(), puck(1.15, -4.3, -1.9, 0.1, 0.1), 24, col("dark"))
    this.mesh(SP, "Mesh", sk, "silver", ORDER.interior)

    // Belt: a flat band round the sub-platter's groove and the motor pulley.
    const BL = this.part(I, "RpBelt", new vec3(AXIS_X, BELT_Y, AXIS_Z))
    const c2 = new vec2(MOTOR_X - AXIS_X, MOTOR_Z - AXIS_Z)
    const R1 = 5.42 + 0.045
    const R2 = 0.48 + 0.045
    const D = c2.length
    const phi = Math.atan2(c2.y, c2.x)
    const alpha = Math.acos((R1 - R2) / D)
    const ring: RP2[] = []
    const arcPts = (c: vec2, r: number, a0: number, a1: number, n: number) => {
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n
        const d = new vec2(Math.cos(a), Math.sin(a))
        ring.push({p: c.add(d.uniformScale(r)), n: d})
      }
    }
    arcPts(new vec2(0, 0), R1, phi + alpha, phi + TAU - alpha, 48)
    arcPts(c2, R2, phi - alpha, phi + alpha, 12)
    const bk = new MeshKit()
    const t = 0.045
    const hh = 0.13
    sweep(
      bk,
      ring,
      [
        [{r: t, y: -hh, nr: 1, ny: 0}, {r: t, y: hh, nr: 1, ny: 0}],
        [{r: t, y: hh, nr: 0, ny: 1}, {r: -t, y: hh, nr: 0, ny: 1}],
        [{r: -t, y: hh, nr: -1, ny: 0}, {r: -t, y: -hh, nr: -1, ny: 0}],
        [{r: -t, y: -hh, nr: 0, ny: -1}, {r: t, y: -hh, nr: 0, ny: -1}]
      ],
      col("rubber")
    )
    this.mesh(BL, "Mesh", bk, "rubber", ORDER.interior)

    // Signal wires from the pivot down into the plinth and back to the output jacks.
    const W = this.part(I, "RpSignalWires", vec3.zero())
    const wk = new MeshKit()
    WIRE_COLORS.forEach((c, i) => {
      const ox = i % 2 === 0 ? -0.1 : 0.1
      const jack = i < 2 ? 16.8 : 18.8
      const pts = [
        new vec3(PIVOT_X + ox, ARM_Y - 1.4, PIVOT_Z + (i < 2 ? 0.1 : -0.1)),
        new vec3(PIVOT_X + ox, 3.4, PIVOT_Z),
        new vec3(PIVOT_X + 0.6 + ox, 2.8, PIVOT_Z - 2.2),
        new vec3(jack - 0.6 + ox, 2.6, -14.6),
        new vec3(jack + ox * 0.6, 2.5 + (i % 2 === 0 ? 0.08 : -0.08), -(PL_HD - BAND_INSET) + 0.4)
      ]
      tube(wk, catmull(pts, 5), 0.04, 4, c)
    })
    this.mesh(W, "Mesh", wk, "wire", ORDER.interior)
  }
}

/** Tonearm lead colours: left signal, left ground, right signal, right ground (muted on an additive display). */
const WIRE_COLORS = [rgb(0.85, 0.85, 0.82), rgb(0.35, 0.5, 0.9), rgb(0.85, 0.32, 0.26), rgb(0.35, 0.75, 0.42)]
