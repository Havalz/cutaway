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
