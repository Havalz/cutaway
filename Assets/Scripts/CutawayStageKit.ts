/**
 * Stateless helpers for the hero stages ("Bring it closer"), shared by the record player stage
 * (devpost/recordplayer-hero.md, Phase B). They follow the camera hero's settled rules
 * (camera-hero.md, camera-hero-pass2.md) without touching its code: the camera stage keeps its own
 * copies, exactly as they were approved.
 *
 * - Flight arc: a quadratic Bézier from the meeting point above the real object to the drop point
 *   above the table, bent away from the user's head so nothing ever flies through it.
 * - Table surface: a stage's footprint (its outline seen from above) against the round table top
 *   found by the survey: the largest scale that fits, how far the footprint centre may move in any
 *   direction, and the soft clamp that keeps the whole footprint on the top.
 * - Hover disc and contact glow: the flat meshes that sit 2 mm above the table top.
 *
 * Nothing here keeps state; every function takes what it needs and returns a value or a mesh.
 */
import {MeshKit, setFade} from "./CutawayGeometry"
import {TableSurface} from "./CutawayHeroSurface"
import {ENERGY, ink} from "./CutawayStyle"

export const DEG = Math.PI / 180
/** The glow and the disc sit this far above the table top (cm), so they never z-fight with it. */
export const ON_TABLE = 0.2

const LIGHT = ENERGY.light

// =====================================================================================
// Flight arc
// =====================================================================================

/** Horizontal unit direction of `v` (−Z if it is vertical). */
export function flatDir(v: vec3): vec3 {
  const f = new vec3(v.x, 0, v.z)
  return f.length > 1e-4 ? f.normalize() : new vec3(0, 0, -1)
}

/** Quadratic Bézier from `a` through control `c` to `b`. */
export function bezier(a: vec3, c: vec3, b: vec3, t: number): vec3 {
  const u = 1 - t
  return a.uniformScale(u * u).add(c.uniformScale(2 * u * t)).add(b.uniformScale(t * t))
}

/** Keep `p` at least `r` cm from `head`, pushed sideways away from it (`fallback`: the push when p is right above the head). */
export function clearOfHead(p: vec3, head: vec3, r: number, fallback: vec3): vec3 {
  let away = new vec3(p.x - head.x, 0, p.z - head.z)
  if (away.length < 1e-3) away = flatDir(fallback)
  away = away.normalize()
  let q = p
  for (let i = 0; i < 8 && q.distance(head) < r; i++) q = q.add(away.uniformScale(r - q.distance(head) + 2))
  return q
}

/** Closest the arc a → c → b comes to `head` (cm), sampled. */
export function arcClearance(a: vec3, c: vec3, b: vec3, head: vec3, samples: number = 24): {d: number; p: vec3} {
  let d = 1e9
  let p = a
  for (let i = 0; i <= samples; i++) {
    const q = bezier(a, c, b, i / samples)
    const k = q.distance(head)
    if (k < d) {
      d = k
      p = q
    }
  }
  return {d, p}
}

/**
 * Control point of the flight arc: `rise` cm above the midpoint, then bent away from the head until
 * the whole arc keeps `clear` cm from it.
 */
export function arcControl(from: vec3, to: vec3, head: vec3, rise: number = 35, clear: number = 55): vec3 {
  let c = vec3.lerp(from, to, 0.5).add(new vec3(0, rise, 0))
  for (let it = 0; it < 12; it++) {
    const w = arcClearance(from, c, to, head)
    if (w.d >= clear) break
    let away = w.p.sub(head)
    away = away.length > 1e-3 ? away.normalize() : new vec3(1, 0, 0)
    c = c.add(away.uniformScale(clear - w.d + 10))
  }
  return c
}

// =====================================================================================
// Table surface: footprints on the round top
// =====================================================================================

/** A stage's outline seen from above: points in its own local (x, z) at 1x, and their centre. */
export interface Footprint {
  pts: vec2[]
  center: vec2
}

/** A footprint from outline points; its centre is the centre of their bounding rectangle. */
export function footprint(pts: vec2[]): Footprint {
  let x0 = 1e9
  let x1 = -1e9
  let z0 = 1e9
  let z1 = -1e9
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.y)
    z1 = Math.max(z1, p.y)
  }
  return {pts, center: new vec2((x0 + x1) / 2, (z0 + z1) / 2)}
}

/** World (flat) offset of footprint point `p` from the footprint centre, for rotation `rot` and `scale`. */
export function footOffset(fp: Footprint, p: vec2, rot: quat, scale: number): vec3 {
  const v = rot.multiplyVec3(new vec3((p.x - fp.center.x) * scale, 0, (p.y - fp.center.y) * scale))
  return new vec3(v.x, 0, v.z)
}

/** Farthest footprint point from the footprint centre (cm at 1x): it fits a table of radius R at any yaw when R ≥ this × scale. */
export function footRadius(fp: Footprint): number {
  let m = 0
  for (const p of fp.pts) m = Math.max(m, p.sub(fp.center).length)
  return m
}

/** The largest scale, up to `maxScale`, at which the whole footprint fits inside `radius − margin`, centred and at any yaw. */
export function fitScale(fp: Footprint, radius: number, margin: number, maxScale: number): number {
  return Math.max(0.01, Math.min(maxScale, (radius - margin) / Math.max(1e-6, footRadius(fp))))
}

/** Largest distance the footprint centre can go from the table centre in flat direction `u` with every point within `radius`. */
export function maxFootDistance(fp: Footprint, u: vec3, rot: quat, scale: number, radius: number): number {
  let best = 1e9
  for (const p of fp.pts) {
    const r = footOffset(fp, p, rot, scale)
    const ur = u.x * r.x + u.z * r.z
    const disc = ur * ur - (r.x * r.x + r.z * r.z) + radius * radius
    if (disc < 0) return 0
    best = Math.min(best, -ur + Math.sqrt(disc))
  }
  return Math.max(0, best)
}

/** How far the farthest footprint point is from `center` (flat, cm). */
export function footReach(fp: Footprint, foot: vec3, rot: quat, scale: number, center: vec3): number {
  let m = 0
  for (const p of fp.pts) {
    const q = foot.add(footOffset(fp, p, rot, scale))
    m = Math.max(m, new vec3(q.x - center.x, 0, q.z - center.z).length)
  }
  return m
}

/**
 * Keep the whole footprint on the table top: the footprint centre goes at most `maxFootDistance`
 * from the table centre (less `margin`); the last `soft` cm before that limit resist (exponential
 * approach), so a drag far past the edge stops there, never beyond. Returns a point at the table's height.
 */
export function clampFoot(fp: Footprint, target: vec3, rot: quat, scale: number, s: TableSurface, margin: number = 0.3, soft: number = 4): vec3 {
  const c = s.center
  const rel = new vec3(target.x - c.x, 0, target.z - c.z)
  const d = rel.length
  if (d < 1e-4) return new vec3(target.x, s.height, target.z)
  const u = rel.uniformScale(1 / d)
  const tMax = Math.max(0, maxFootDistance(fp, u, rot, scale, s.safeRadius) - margin)
  const knee = Math.max(0, tMax - soft)
  const w = tMax - knee
  const dd = d <= knee ? d : w > 1e-4 ? knee + w * (1 - Math.exp(-(d - knee) / w)) : knee
  return new vec3(c.x + u.x * dd, s.height, c.z + u.z * dd)
}

/** The hand position that `clampFoot` maps to `foot` (a grab that starts near the edge never jumps). */
export function unclampFoot(fp: Footprint, foot: vec3, rot: quat, scale: number, s: TableSurface, margin: number = 0.3, soft: number = 4): vec3 {
  const c = s.center
  const rel = new vec3(foot.x - c.x, 0, foot.z - c.z)
  const dd = rel.length
  if (dd < 1e-4) return foot
  const u = rel.uniformScale(1 / dd)
  const tMax = Math.max(0, maxFootDistance(fp, u, rot, scale, s.safeRadius) - margin)
  const knee = Math.max(0, tMax - soft)
  const w = tMax - knee
  if (dd <= knee || w <= 1e-4) return foot
  const k = Math.min(0.999, (dd - knee) / w)
  const d = knee - w * Math.log(1 - k)
  return new vec3(c.x + u.x * d, s.height, c.z + u.z * d)
}

/** Lowest world Y of hull points (local) under world transform `m`. */
export function hullLowestY(hull: vec3[], m: mat4): number {
  let y = 1e9
  for (const p of hull) y = Math.min(y, m.multiplyPoint(p).y)
  return y
}

// =====================================================================================
// Contact glow and hover disc (flat XY meshes laid on the table)
// =====================================================================================

/**
 * A soft band around a closed outline (XY, facing +Z): rows at the given outward offsets, each with
 * its colour (bright at the edge, fading to nothing). Corners use mitred offsets.
 */
export function softOutline(k: MeshKit, pts: vec2[], offsets: number[], colors: vec4[]): void {
  const n = pts.length
  let area = 0
  for (let i = 0; i < n; i++) area += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y
  const sgn = area > 0 ? 1 : -1
  const out = (a: vec2, b: vec2) => {
    const d = b.sub(a).normalize()
    return new vec2(d.y * sgn, -d.x * sgn)
  }
  const miter: vec2[] = []
  for (let i = 0; i < n; i++) {
    const n1 = out(pts[(i - 1 + n) % n], pts[i])
    const n2 = out(pts[i], pts[(i + 1) % n])
    const m = n1.add(n2).normalize()
    miter.push(m.uniformScale(1 / Math.max(0.35, m.dot(n1))))
  }
  const nz = new vec3(0, 0, 1)
  const base: number[] = []
  offsets.forEach((o, r) => {
    base.push(k.vert(new vec3(pts[0].x + miter[0].x * o, pts[0].y + miter[0].y * o, 0), nz, colors[r]))
    for (let i = 1; i < n; i++) k.vert(new vec3(pts[i].x + miter[i].x * o, pts[i].y + miter[i].y * o, 0), nz, colors[r])
  })
  for (let r = 0; r < offsets.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = base[r] + i
      const b = base[r] + ((i + 1) % n)
      const c = base[r + 1] + ((i + 1) % n)
      const d = base[r + 1] + i
      k.tri(a, b, c)
      k.tri(a, c, d)
    }
}

/**
 * The contact glow: a faint warm-white pool hugging a footprint outline. `outline` is in the glow
 * mesh's own XY (cm, x across, y = −local z), centred on the footprint centre.
 */
export function contactGlowKit(outline: vec2[]): MeshKit {
  const k = new MeshKit()
  softOutline(k, outline, [0, 0.35, 3.2], [ink(LIGHT, 0.36), ink(LIGHT, 0.22), ink(LIGHT, 0)])
  return k
}

/** The hover disc: a thin warm-white ring of radius `R` with about 10% fill and a soft outer edge. */
export function hoverDiscKit(R: number): MeshKit {
  const dk = new MeshKit()
  dk.addFanXY(0, 0, R, 0, Math.PI * 2, ink(LIGHT, 0.1), ink(LIGHT, 0.1), 96)
  dk.addArcXY(0, 0, R, 0.35, 0, Math.PI * 2, ink(LIGHT, 0.85), 128)
  dk.addSoftRingXY(0, 0, R + 0.17, R + 2.2, ink(LIGHT, 0.14), ink(LIGHT, 0), 96)
  return dk
}

/** A footprint's outline in its glow mesh's XY at `scale` (x across, y = −local z), about the footprint centre. */
export function footprintOutlineXY(fp: Footprint, scale: number): vec2[] {
  return fp.pts.map((p) => new vec2((p.x - fp.center.x) * scale, -(p.y - fp.center.y) * scale))
}

/** Rotation that lays an XY mesh flat on the table, its +Y pointing along −`forward` (flat). */
export function flatOnTable(forward: vec3): quat {
  return quat.lookAt(flatDir(forward), vec3.up()).multiply(quat.angleAxis(-90 * DEG, vec3.right()))
}

/**
 * Place the contact glow and the hover disc for a footprint centre `foot` (world, its lowest point's
 * height in y) on surface `s`. The glow is full while the stage sits on the table and fades out as it
 * lifts (gone 3 cm up); the disc is as wide as `discR` but never past the table's edge.
 */
export function placeGlowAndDisc(
  o: {glow: SceneObject; glowMat: Material; disc: SceneObject; discMat: Material},
  s: TableSurface,
  foot: vec3,
  forward: vec3,
  onTable: boolean,
  discK: number,
  discR: number,
  fade: number,
  showDisc: boolean = true
): {glow: number; disc: number} {
  const flat = flatOnTable(forward)
  const at = new vec3(foot.x, s.height + ON_TABLE, foot.z)
  const g = onTable ? 1 - Math.max(0, Math.min(1, (foot.y - s.height - 0.2) / 3)) : 0
  o.glow.enabled = g > 0.001
  if (o.glow.enabled) {
    const gt = o.glow.getTransform()
    gt.setWorldPosition(at)
    gt.setWorldRotation(flat)
    setFade(o.glowMat, g * fade)
  }
  o.disc.enabled = showDisc && discK > 0.001
  if (o.disc.enabled) {
    const off = new vec3(foot.x - s.center.x, 0, foot.z - s.center.z).length
    const r = Math.max(4, Math.min(discR, s.safeRadius - off))
    const dt = o.disc.getTransform()
    dt.setWorldPosition(at)
    dt.setWorldRotation(flat)
    dt.setWorldScale(vec3.one().uniformScale(r / discR))
    setFade(o.discMat, discK)
  }
  return {glow: g, disc: o.disc.enabled ? discK : 0}
}
