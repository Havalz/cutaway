/**
 * Screen layout from the user's eye (§9 clean-up): what overlaps what, as the user sees it.
 *
 * Points are projected onto a plane facing the eye ("view units": cm at the distance of the
 * frame's target), so two things overlap on screen exactly when their projections overlap, from
 * wherever the user is looking. Shapes are convex polygons: a mesh's box (8 corners) becomes the
 * hull of its projected corners, a text quad its 4 corners.
 */

export interface ViewFrame {
  eye: vec3
  f: vec3
  r: vec3
  u: vec3
  /** Distance from the eye to the target (the scale of view units). */
  D: number
}

/** A view from `eye` toward `target`, level (its right is horizontal). */
export function viewFrame(eye: vec3, target: vec3): ViewFrame {
  const d = target.sub(eye)
  const D = Math.max(1e-3, d.length)
  const f = d.uniformScale(1 / D)
  let r = f.cross(vec3.up())
  r = r.length > 1e-4 ? r.normalize() : new vec3(1, 0, 0)
  const u = r.cross(f)
  return {eye, f, r, u, D}
}

/** A world point in view units (x right, y up). */
export function toView(F: ViewFrame, p: vec3): vec2 {
  const v = p.sub(F.eye)
  const z = Math.max(1e-3, v.dot(F.f))
  return new vec2((v.dot(F.r) / z) * F.D, (v.dot(F.u) / z) * F.D)
}

/** Convex hull (counter-clockwise) of 2D points. */
export function hull2(pts: vec2[]): vec2[] {
  const p = pts.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
  if (p.length < 3) return p
  const cross = (o: vec2, a: vec2, b: vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lo: vec2[] = []
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop()
    lo.push(q)
  }
  const up: vec2[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop()
    up.push(q)
  }
  lo.pop()
  up.pop()
  return lo.concat(up)
}

/**
 * Gap between two convex polygons (a segment or a point counts as one): the largest separation
 * along any edge normal. Positive = apart by that much, negative = overlapping.
 */
export function polyGap(a: vec2[], b: vec2[]): number {
  let best = -1e9
  const axes = (P: vec2[]) => {
    const out: vec2[] = []
    for (let i = 0; i < P.length; i++) {
      const e = P[(i + 1) % P.length].sub(P[i])
      const n = new vec2(-e.y, e.x)
      const l = n.length
      if (l > 1e-9) out.push(n.uniformScale(1 / l))
    }
    return out
  }
  for (const n of axes(a).concat(axes(b))) {
    let amin = 1e9
    let amax = -1e9
    let bmin = 1e9
    let bmax = -1e9
    for (const q of a) {
      const t = q.dot(n)
      amin = Math.min(amin, t)
      amax = Math.max(amax, t)
    }
    for (const q of b) {
      const t = q.dot(n)
      bmin = Math.min(bmin, t)
      bmax = Math.max(bmax, t)
    }
    best = Math.max(best, bmin - amax, amin - bmax)
  }
  return best
}

/** An axis-aligned rectangle as a polygon. */
export function rect2(x0: number, x1: number, y0: number, y1: number): vec2[] {
  return [new vec2(x0, y0), new vec2(x1, y0), new vec2(x1, y1), new vec2(x0, y1)]
}

/** A circle as a polygon (n sides, circumscribed so it never undercounts). */
export function circle2(c: vec2, r: number, n: number = 16): vec2[] {
  const k = r / Math.cos(Math.PI / n)
  const out: vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push(new vec2(c.x + Math.cos(a) * k, c.y + Math.sin(a) * k))
  }
  return out
}

/** The 8 world corners of local bounds `a`..`b` under the transform `m`. */
export function boxCorners(m: mat4, a: vec3, b: vec3): vec3[] {
  const out: vec3[] = []
  for (const x of [a.x, b.x]) for (const y of [a.y, b.y]) for (const z of [a.z, b.z]) out.push(m.multiplyPoint(new vec3(x, y, z)))
  return out
}

/** The world boxes (8 corners each) of every enabled mesh under `root` (optionally only those using `only`). */
export function meshBoxes(root: SceneObject, only?: Material): vec3[][] {
  const out: vec3[][] = []
  const walk = (so: SceneObject) => {
    if (!so.enabled) return
    const rmv = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    if (rmv && rmv.enabled && rmv.mesh && (!only || rmv.mainMaterial === only)) out.push(boxCorners(so.getTransform().getWorldTransform(), rmv.mesh.aabbMin, rmv.mesh.aabbMax))
    for (let i = 0; i < so.getChildrenCount(); i++) walk(so.getChild(i))
  }
  walk(root)
  return out
}

// =====================================================================================
// The same checks on plain numbers, for placing labels: an order of magnitude cheaper
// =====================================================================================

/** A convex polygon in view units, with its bounds and its edge normals (and its extent along each) worked out once. */
export class FastPoly {
  readonly n: number
  x0 = Infinity
  x1 = -Infinity
  y0 = Infinity
  y1 = -Infinity
  private nx: number[] = []
  private ny: number[] = []
  private lo: number[] = []
  private hi: number[] = []

  constructor(
    readonly xs: number[],
    readonly ys: number[]
  ) {
    const n = xs.length
    this.n = n
    for (let i = 0; i < n; i++) {
      if (xs[i] < this.x0) this.x0 = xs[i]
      if (xs[i] > this.x1) this.x1 = xs[i]
      if (ys[i] < this.y0) this.y0 = ys[i]
      if (ys[i] > this.y1) this.y1 = ys[i]
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const ex = xs[j] - xs[i]
      const ey = ys[j] - ys[i]
      const l = Math.sqrt(ex * ex + ey * ey)
      if (l <= 1e-9) continue
      const ax = -ey / l
      const ay = ex / l
      let lo = Infinity
      let hi = -Infinity
      for (let k = 0; k < n; k++) {
        const t = xs[k] * ax + ys[k] * ay
        if (t < lo) lo = t
        if (t > hi) hi = t
      }
      this.nx.push(ax)
      this.ny.push(ay)
      this.lo.push(lo)
      this.hi.push(hi)
    }
  }

  /** polyGap(rect, this) >= limit, for an axis-aligned rectangle. */
  rectClear(x0: number, x1: number, y0: number, y1: number, limit: number): boolean {
    if (this.x0 - x1 >= limit || x0 - this.x1 >= limit || this.y0 - y1 >= limit || y0 - this.y1 >= limit) return true
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const hw = (x1 - x0) / 2
    const hh = (y1 - y0) / 2
    for (let k = 0; k < this.nx.length; k++) {
      const ax = this.nx[k]
      const ay = this.ny[k]
      const c = cx * ax + cy * ay
      const e = Math.abs(ax) * hw + Math.abs(ay) * hh
      if (this.lo[k] - (c + e) >= limit || c - e - this.hi[k] >= limit) return true
    }
    return false
  }

  /** polyGap(segment, this) >= limit. */
  segClear(ax: number, ay: number, bx: number, by: number, limit: number): boolean {
    for (let k = 0; k < this.nx.length; k++) {
      const ta = ax * this.nx[k] + ay * this.ny[k]
      const tb = bx * this.nx[k] + by * this.ny[k]
      const smin = ta < tb ? ta : tb
      const smax = ta < tb ? tb : ta
      if (this.lo[k] - smax >= limit || smin - this.hi[k] >= limit) return true
    }
    const ex = bx - ax
    const ey = by - ay
    const l = Math.sqrt(ex * ex + ey * ey)
    if (l <= 1e-9) return false
    const nx = -ey / l
    const ny = ex / l
    const t = ax * nx + ay * ny
    let lo = Infinity
    let hi = -Infinity
    for (let k = 0; k < this.n; k++) {
      const v = this.xs[k] * nx + this.ys[k] * ny
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    return lo - t >= limit || t - hi >= limit
  }
}

/** Convex hull (counter-clockwise, as hull2) of the first n points. */
function fastHull(xs: number[], ys: number[], n: number): FastPoly {
  const order: number[] = []
  for (let i = 0; i < n; i++) {
    let j = order.length
    while (j > 0 && (xs[order[j - 1]] > xs[i] || (xs[order[j - 1]] === xs[i] && ys[order[j - 1]] > ys[i]))) j--
    order.splice(j, 0, i)
  }
  if (n < 3) return new FastPoly(order.map((i) => xs[i]), order.map((i) => ys[i]))
  const out: number[] = []
  const cross = (o: number, a: number, b: number) => (xs[a] - xs[o]) * (ys[b] - ys[o]) - (ys[a] - ys[o]) * (xs[b] - xs[o])
  const build = (from: number, to: number, step: number): number => {
    const start = out.length
    for (let i = from; i !== to; i += step) {
      const q = order[i]
      while (out.length - start >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop()
      out.push(q)
    }
    out.pop()
    return start
  }
  build(0, n, 1)
  build(n - 1, -1, -1)
  return new FastPoly(out.map((i) => xs[i]), out.map((i) => ys[i]))
}

/** The hull of world points in view units. */
export function worldHull(F: ViewFrame, pts: vec3[]): FastPoly {
  const xs: number[] = []
  const ys: number[] = []
  const e = F.eye
  const f = F.f
  const r = F.r
  const u = F.u
  for (const p of pts) {
    const x = p.x - e.x
    const y = p.y - e.y
    const z = p.z - e.z
    const d = Math.max(1e-3, x * f.x + y * f.y + z * f.z)
    xs.push(((x * r.x + y * r.y + z * r.z) / d) * F.D)
    ys.push(((x * u.x + y * u.y + z * u.z) / d) * F.D)
  }
  return fastHull(xs, ys, xs.length)
}

/** The hull of a box (local bounds a..b under m) in view units. */
export function boxHull(F: ViewFrame, m: mat4, a: vec3, b: vec3): FastPoly {
  const c0 = m.column0
  const c1 = m.column1
  const c2 = m.column2
  const c3 = m.column3
  const e = F.eye
  const f = F.f
  const r = F.r
  const u = F.u
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? b.x : a.x
    const ly = i & 2 ? b.y : a.y
    const lz = i & 4 ? b.z : a.z
    const x = c0.x * lx + c1.x * ly + c2.x * lz + c3.x - e.x
    const y = c0.y * lx + c1.y * ly + c2.y * lz + c3.y - e.y
    const z = c0.z * lx + c1.z * ly + c2.z * lz + c3.z - e.z
    const d = Math.max(1e-3, x * f.x + y * f.y + z * f.z)
    xs.push(((x * r.x + y * r.y + z * r.z) / d) * F.D)
    ys.push(((x * u.x + y * u.y + z * u.z) / d) * F.D)
  }
  return fastHull(xs, ys, 8)
}

// =====================================================================================
// Shapes kept in a copy's own space, so they can be seen from anywhere without touching a transform
// =====================================================================================

/** The 8 corners of local bounds a..b under m, pushed on `out` as x, y, z. */
export function pushBox(out: number[], m: mat4, a: vec3, b: vec3): void {
  const c0 = m.column0
  const c1 = m.column1
  const c2 = m.column2
  const c3 = m.column3
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? b.x : a.x
    const ly = i & 2 ? b.y : a.y
    const lz = i & 4 ? b.z : a.z
    out.push(c0.x * lx + c1.x * ly + c2.x * lz + c3.x, c0.y * lx + c1.y * ly + c2.y * lz + c3.y, c0.z * lx + c1.z * ly + c2.z * lz + c3.z)
  }
}

/** Numbers in a box of pushBox. */
export const BOX_NUMBERS = 24

/** The boxes of every enabled mesh under `root`, in the space `inv` maps world to, pushed on `out` (see meshBoxes). */
export function pushMeshBoxes(out: number[], root: SceneObject, inv: mat4): void {
  if (!root.enabled) return
  const rmv = root.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
  if (rmv && rmv.enabled && rmv.mesh) pushBox(out, inv.mult(root.getTransform().getWorldTransform()), rmv.mesh.aabbMin, rmv.mesh.aabbMax)
  for (let i = 0; i < root.getChildrenCount(); i++) pushMeshBoxes(out, root.getChild(i), inv)
}

/** The hull in view units of `count` points of `pts` (x, y, z from index `from`), under m and then raised by dy. */
export function pointsHull(F: ViewFrame, m: mat4, pts: number[], from: number, count: number, dy: number): FastPoly {
  const c0 = m.column0
  const c1 = m.column1
  const c2 = m.column2
  const c3 = m.column3
  const e = F.eye
  const f = F.f
  const r = F.r
  const u = F.u
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < count; i++) {
    const lx = pts[from + i * 3]
    const ly = pts[from + i * 3 + 1]
    const lz = pts[from + i * 3 + 2]
    const x = c0.x * lx + c1.x * ly + c2.x * lz + c3.x - e.x
    const y = c0.y * lx + c1.y * ly + c2.y * lz + c3.y + dy - e.y
    const z = c0.z * lx + c1.z * ly + c2.z * lz + c3.z - e.z
    const d = Math.max(1e-3, x * f.x + y * f.y + z * f.z)
    xs.push(((x * r.x + y * r.y + z * r.z) / d) * F.D)
    ys.push(((x * u.x + y * u.y + z * u.z) / d) * F.D)
  }
  return fastHull(xs, ys, count)
}
