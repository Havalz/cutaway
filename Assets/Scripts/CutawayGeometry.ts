/**
 * Code-authored geometry for Cutaway (MeshBuilder). No GLB assets are needed.
 * - MeshKit: accumulates tubes, spheres, discs, rings, quads, lathes into one static mesh.
 * - GlowPath: a glowing tube (core + soft halo) along a polyline that can be revealed
 *   progressively (line of light, rays, cords).
 * - DynamicRibbon: a flat ribbon whose points are rewritten every frame (record groove).
 * All vertices carry RGBA color; materials multiply base color by vertex color.
 */

const LAYOUT = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true},
  {name: "color", components: 4}
]

function perpBasis(n: vec3): {u: vec3; v: vec3} {
  const ref = Math.abs(n.y) < 0.95 ? vec3.up() : vec3.right()
  const u = n.cross(ref).normalize()
  const v = n.cross(u).normalize()
  return {u, v}
}

/** Splits each leg of a polyline into pieces no longer than `step` (corners are kept). */
export function resample(points: vec3[], step: number): vec3[] {
  const out: vec3[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const n = Math.max(1, Math.ceil(a.distance(b) / step))
    for (let k = 1; k <= n; k++) out.push(vec3.lerp(a, b, k / n))
  }
  return out
}

/** Parallel-transport frames along a sampled path (no twisting). */
function pathFrames(pts: vec3[]): {n: vec3; b: vec3}[] {
  const frames: {n: vec3; b: vec3}[] = []
  let prevN: vec3 | null = null
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const c = pts[Math.min(pts.length - 1, i + 1)]
    let t = c.sub(a)
    if (t.length < 1e-5) t = vec3.forward()
    t = t.normalize()
    let n: vec3
    if (prevN === null) {
      n = perpBasis(t).u
    } else {
      n = prevN.sub(t.uniformScale(prevN.dot(t)))
      if (n.length < 1e-4) n = perpBasis(t).u
      n = n.normalize()
    }
    prevN = n
    frames.push({n, b: t.cross(n).normalize()})
  }
  return frames
}

function scaleColor(c: vec4, k: number): vec4 {
  return new vec4(c.x * k, c.y * k, c.z * k, c.w * k)
}

/** Halo width (× line width) for lines drawn as light: energy content. */
export const LIGHT_GLOW = 2.4
/** Halo width (× line width) for faint structure lines (shells, bodies, sockets). */
export const STRUCT_GLOW = 1.3

/**
 * Cross-section of a line drawn as light: a hot (slightly whiter) centre, the core edges, then a
 * soft halo that falls off to nothing. `c` = core half-width, `h` = halo width beyond the core.
 */
interface ProfileStop {
  o: number
  k: number
  hot: number
}
function lightProfile(c: number, h: number): ProfileStop[] {
  return [
    {o: -(c + h), k: 0, hot: 0},
    {o: -(c + 0.32 * h), k: 0.3, hot: 0},
    {o: -c, k: 0.82, hot: 0},
    {o: 0, k: 1, hot: 0.42},
    {o: c, k: 0.82, hot: 0},
    {o: c + 0.32 * h, k: 0.3, hot: 0},
    {o: c + h, k: 0, hot: 0}
  ]
}

/** `c` scaled by `k`, its hue pulled `hot` of the way toward white of the same strength (c.w). */
export function lightColor(c: vec4, k: number, hot: number = 0): vec4 {
  const w = c.w
  return new vec4((c.x + (w - c.x) * hot) * k, (c.y + (w - c.y) * hot) * k, (c.z + (w - c.z) * hot) * k, w * k)
}

/** Unit offset directions for a polyline in XY (mitred at the joints, so the strip stays continuous). */
function polySides(pts: vec2[]): vec3[] {
  const n = pts.length
  const closed = n > 2 && pts[0].distance(pts[n - 1]) < 1e-6
  const segN = (a: vec2, b: vec2): vec2 | null => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L = Math.sqrt(dx * dx + dy * dy)
    return L > 1e-9 ? new vec2(-dy / L, dx / L) : null
  }
  const out: vec3[] = []
  let last = new vec2(0, 1)
  for (let i = 0; i < n; i++) {
    let n1 = i > 0 ? segN(pts[i - 1], pts[i]) : closed ? segN(pts[n - 2], pts[0]) : null
    let n2 = i < n - 1 ? segN(pts[i], pts[i + 1]) : closed ? segN(pts[0], pts[1]) : null
    if (!n1) n1 = n2
    if (!n2) n2 = n1
    if (!n1 || !n2) {
      out.push(new vec3(last.x, last.y, 0))
      continue
    }
    const sx = n1.x + n2.x
    const sy = n1.y + n2.y
    const sl = Math.sqrt(sx * sx + sy * sy)
    const m = sl > 1e-6 ? new vec2(sx / sl, sy / sl) : n2
    const miter = 1 / Math.max(0.5, m.x * n1.x + m.y * n1.y)
    last = m
    out.push(new vec3(m.x * miter, m.y * miter, 0))
  }
  return out
}

/** Unit offset directions that turn a 3D polyline's flat side toward `eye` (local space). */
function facingSides(pts: vec3[], eye: vec3 | null, facing: vec3 | null): {side: vec3[]; normal: vec3[]} {
  const side: vec3[] = []
  const normal: vec3[] = []
  let prev = vec3.up()
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const t = b.sub(a)
    const v = facing ? facing : eye ? eye.sub(pts[i]) : vec3.forward()
    let s = t.cross(v)
    s = s.length > 1e-6 ? s.normalize() : prev
    if (s.dot(prev) < 0 && i > 0) s = s.uniformScale(-1)
    prev = s
    side.push(s)
    normal.push(v.length > 1e-6 ? v.normalize() : vec3.forward())
  }
  return {side, normal}
}

export class MeshKit {
  private data: number[] = []
  private indices: number[] = []
  private count = 0

  /**
   * @param glow 0 draws crisp lines (UI). Above 0, lines, arcs, polylines, rings and tubes are drawn
   *             as light: hot core and a soft halo `glow` × the line width wide.
   * @param eye  local-space viewer position: with glow on, tubes become flat ribbons facing it.
   */
  constructor(
    private glow: number = 0,
    private eye: vec3 | null = null
  ) {}

  /** A strip through `pts` with the light profile across it (`side[i]` = unit offset at pts[i]). */
  private lightStrip(pts: vec3[], side: vec3[], normal: vec3 | vec3[], c: number, h: number, color: vec4): void {
    const prof = lightProfile(c, h)
    const P = prof.length
    const base = this.count
    for (let i = 0; i < pts.length; i++) {
      const nrm = Array.isArray(normal) ? normal[i] : normal
      for (const q of prof) this.vert(pts[i].add(side[i].uniformScale(q.o)), nrm, lightColor(color, q.k, q.hot))
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = base + i * P + k
        const b = a + P
        this.tri(a, b, b + 1)
        this.tri(a, b + 1, a + 1)
      }
    }
  }

  /** Flat ribbon along a 3D polyline that faces the kit's eye, drawn as light. */
  addRibbon(points: vec3[], radius: number, color: vec4, step: number = 4, glow: number = this.glow): void {
    const pts = resample(points, step)
    const f = facingSides(pts, this.eye, null)
    this.lightStrip(pts, f.side, f.normal, radius, radius * Math.max(0.6, glow), color)
  }

  /**
   * A travelling head: a hot, almost white core with a soft bloom in its colour (XY plane).
   * Bright enough to read as the leading edge of light, small enough to stay precise.
   */
  addSparkXY(cx: number, cy: number, r: number, color: vec4, seg: number = 20): void {
    const n = new vec3(0, 0, 1)
    const zero = new vec4(0, 0, 0, 0)
    const ring = (r0: number, r1: number, c0: vec4, c1: vec4) => {
      const base = this.count
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2
        this.vert(new vec3(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, 0), n, c0)
        this.vert(new vec3(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 0), n, c1)
      }
      for (let s = 0; s < seg; s++) {
        const i0 = base + s * 2
        this.tri(i0, i0 + 1, i0 + 3)
        this.tri(i0, i0 + 3, i0 + 2)
      }
    }
    const c0 = this.vert(new vec3(cx, cy, 0), n, lightColor(color, 1.25, 0.75))
    const base = this.count
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      this.vert(new vec3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0), n, lightColor(color, 0.9, 0.3))
    }
    for (let s = 0; s < seg; s++) this.tri(c0, base + s, base + s + 1)
    ring(r, r * 2.6, lightColor(color, 0.9, 0.3), lightColor(color, 0.22))
    ring(r * 2.6, r * 6, lightColor(color, 0.22), zero)
  }

  /** A comet streak from a (tail, dark) to b (head, hot), drawn as light (XY plane). */
  addCometXY(ax: number, ay: number, bx: number, by: number, width: number, color: vec4, halo: number = width * LIGHT_GLOW): void {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-6) return
    const side = new vec3(-dy / len, dx / len, 0)
    const n = new vec3(0, 0, 1)
    const prof = lightProfile(width / 2, halo)
    const P = prof.length
    const rows = [
      {u: 0, k: 0},
      {u: 0.55, k: 0.3},
      {u: 0.88, k: 0.75},
      {u: 1, k: 1.15}
    ]
    const base = this.count
    for (const r of rows) {
      const p = new vec3(ax + dx * r.u, ay + dy * r.u, 0)
      for (const q of prof) this.vert(p.add(side.uniformScale(q.o)), n, lightColor(color, q.k * r.k, q.hot + (r.u > 0.9 ? 0.25 : 0)))
    }
    for (let i = 0; i < rows.length - 1; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = base + i * P + k
        const b = a + P
        this.tri(a, b, b + 1)
        this.tri(a, b + 1, a + 1)
      }
    }
  }

  vert(p: vec3, n: vec3, c: vec4): number {
    this.data.push(p.x, p.y, p.z, n.x, n.y, n.z, c.x, c.y, c.z, c.w)
    return this.count++
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c)
  }

  /** Triangle wound so its front face is the side its vertex normals point to (for culled solids). */
  triOut(a: number, b: number, c: number): void {
    const d = this.data
    const P = (i: number) => new vec3(d[i * 10], d[i * 10 + 1], d[i * 10 + 2])
    const N = (i: number) => new vec3(d[i * 10 + 3], d[i * 10 + 4], d[i * 10 + 5])
    const f = P(b).sub(P(a)).cross(P(c).sub(P(a)))
    if (f.dot(N(a).add(N(b)).add(N(c))) >= 0) this.tri(a, b, c)
    else this.tri(a, c, b)
  }

  get vertexCount(): number {
    return this.count
  }

  get triangleCount(): number {
    return this.indices.length / 3
  }

  addTube(points: vec3[], radius: number, color: vec4, sides: number = 6, step: number = 4): void {
    if (this.glow > 0 && this.eye) {
      this.addRibbon(points, radius, color, step)
      return
    }
    const pts = resample(points, step)
    const frames = pathFrames(pts)
    const base = this.count
    for (let i = 0; i < pts.length; i++) {
      for (let k = 0; k < sides; k++) {
        const ang = (k / sides) * Math.PI * 2
        const dir = frames[i].n.uniformScale(Math.cos(ang)).add(frames[i].b.uniformScale(Math.sin(ang)))
        this.vert(pts[i].add(dir.uniformScale(radius)), dir, color)
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const a = base + i * sides + k
        const b = base + i * sides + ((k + 1) % sides)
        const c = base + (i + 1) * sides + k
        const d = base + (i + 1) * sides + ((k + 1) % sides)
        this.tri(a, b, c)
        this.tri(b, d, c)
      }
    }
  }

  addSphere(center: vec3, r: number, color: vec4, lat: number = 8, lon: number = 12): void {
    const base = this.count
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * Math.PI * 2
        const n = new vec3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph))
        this.vert(center.add(n.uniformScale(r)), n, color)
      }
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = base + i * (lon + 1) + j
        const b = a + lon + 1
        this.tri(a, a + 1, b)
        this.tri(a + 1, b + 1, b)
      }
    }
  }

  /** Flat disc facing `normal` (CCW seen from the normal side). */
  addDisc(center: vec3, normal: vec3, r: number, color: vec4, seg: number = 32, edgeColor?: vec4): void {
    const {u, v} = perpBasis(normal)
    const c0 = this.vert(center, normal, color)
    const base = this.count
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2
      this.vert(center.add(u.uniformScale(Math.cos(a) * r)).add(v.uniformScale(Math.sin(a) * r)), normal, edgeColor ?? color)
    }
    for (let s = 0; s < seg; s++) this.tri(c0, base + s, base + ((s + 1) % seg))
  }

  addRing(center: vec3, normal: vec3, r: number, width: number, color: vec4, seg: number = 48): void {
    const {u, v} = perpBasis(normal)
    if (this.glow > 0) {
      const pts: vec3[] = []
      const side: vec3[] = []
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2
        const dir = u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)))
        pts.push(center.add(dir.uniformScale(r)))
        side.push(dir)
      }
      this.lightStrip(pts, side, normal, width / 2, width * this.glow, color)
      return
    }
    const base = this.count
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2
      const dir = u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)))
      this.vert(center.add(dir.uniformScale(r - width / 2)), normal, color)
      this.vert(center.add(dir.uniformScale(r + width / 2)), normal, color)
    }
    for (let s = 0; s < seg; s++) {
      const i0 = base + s * 2
      const i1 = base + ((s + 1) % seg) * 2
      this.tri(i0, i0 + 1, i1 + 1)
      this.tri(i0, i1 + 1, i1)
    }
  }

  /** Quad spanning center ± right ± up (half-extents), facing right × up. */
  addQuad(center: vec3, right: vec3, up: vec3, color: vec4): void {
    const n = right.cross(up).normalize()
    const a = this.vert(center.sub(right).sub(up), n, color)
    const b = this.vert(center.add(right).sub(up), n, color)
    const c = this.vert(center.add(right).add(up), n, color)
    const d = this.vert(center.sub(right).add(up), n, color)
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  /** Surface of revolution: profile entries are [radius, height along axis]. */
  addLathe(center: vec3, axis: vec3, profile: number[][], colors: vec4[], seg: number = 36): void {
    const ax = axis.normalize()
    const {u, v} = perpBasis(ax)
    const base = this.count
    for (let j = 0; j < profile.length; j++) {
      const r = profile[j][0]
      const h = profile[j][1]
      const col = colors[Math.min(j, colors.length - 1)]
      for (let s = 0; s <= seg; s++) {
        const a = (s / seg) * Math.PI * 2
        const dir = u.uniformScale(Math.cos(a)).add(v.uniformScale(Math.sin(a)))
        this.vert(center.add(ax.uniformScale(h)).add(dir.uniformScale(r)), dir, col)
      }
    }
    for (let j = 0; j < profile.length - 1; j++) {
      for (let s = 0; s < seg; s++) {
        const a = base + j * (seg + 1) + s
        const b = a + seg + 1
        this.tri(a, a + 1, b)
        this.tri(a + 1, b + 1, b)
      }
    }
  }

  /** Wireframe box: 12 glowing edges. Axes are half-extent vectors. */
  addBoxEdges(center: vec3, ax: vec3, ay: vec3, az: vec3, radius: number, color: vec4): void {
    const corner = (sx: number, sy: number, sz: number) =>
      center.add(ax.uniformScale(sx)).add(ay.uniformScale(sy)).add(az.uniformScale(sz))
    const s = [-1, 1]
    for (const y of s) for (const z of s) this.addTube([corner(-1, y, z), corner(1, y, z)], radius, color, 5, 50)
    for (const x of s) for (const z of s) this.addTube([corner(x, -1, z), corner(x, 1, z)], radius, color, 5, 50)
    for (const x of s) for (const y of s) this.addTube([corner(x, y, -1), corner(x, y, 1)], radius, color, 5, 50)
  }

  // ---------------- Flat primitives in the local XY plane (facing +Z) ----------------

  /** Arc of a ring from angle a0 to a1 (radians, CCW from +X). */
  addArcXY(cx: number, cy: number, r: number, width: number, a0: number, a1: number, color: vec4, seg: number = 24): void {
    const n = new vec3(0, 0, 1)
    if (this.glow > 0) {
      const pts: vec3[] = []
      const side: vec3[] = []
      for (let s = 0; s <= seg; s++) {
        const a = a0 + ((a1 - a0) * s) / seg
        const d = new vec3(Math.cos(a), Math.sin(a), 0)
        pts.push(new vec3(cx, cy, 0).add(d.uniformScale(r)))
        side.push(d)
      }
      this.lightStrip(pts, side, n, width / 2, width * this.glow, color)
      return
    }
    const base = this.count
    for (let s = 0; s <= seg; s++) {
      const a = a0 + ((a1 - a0) * s) / seg
      const c = Math.cos(a)
      const d = Math.sin(a)
      this.vert(new vec3(cx + c * (r - width / 2), cy + d * (r - width / 2), 0), n, color)
      this.vert(new vec3(cx + c * (r + width / 2), cy + d * (r + width / 2), 0), n, color)
    }
    for (let s = 0; s < seg; s++) {
      const i0 = base + s * 2
      const i1 = i0 + 2
      this.tri(i0, i0 + 1, i1 + 1)
      this.tri(i0, i1 + 1, i1)
    }
  }

  /** Filled sector (pie slice) with a radial gradient from centerColor to edgeColor. */
  addFanXY(cx: number, cy: number, r: number, a0: number, a1: number, centerColor: vec4, edgeColor: vec4, seg: number = 24): void {
    const n = new vec3(0, 0, 1)
    const c0 = this.vert(new vec3(cx, cy, 0), n, centerColor)
    const base = this.count
    for (let s = 0; s <= seg; s++) {
      const a = a0 + ((a1 - a0) * s) / seg
      this.vert(new vec3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0), n, edgeColor)
    }
    for (let s = 0; s < seg; s++) this.tri(c0, base + s, base + s + 1)
  }

  /** Annulus with a radial gradient (inner color → outer color): soft glows and halos. */
  addSoftRingXY(cx: number, cy: number, r0: number, r1: number, c0: vec4, c1: vec4, seg: number = 40): void {
    const n = new vec3(0, 0, 1)
    const base = this.count
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2
      const c = Math.cos(a)
      const d = Math.sin(a)
      this.vert(new vec3(cx + c * r0, cy + d * r0, 0), n, c0)
      this.vert(new vec3(cx + c * r1, cy + d * r1, 0), n, c1)
    }
    for (let s = 0; s < seg; s++) {
      const i0 = base + s * 2
      const i1 = i0 + 2
      this.tri(i0, i0 + 1, i1 + 1)
      this.tri(i0, i1 + 1, i1)
    }
  }

  /** Axis-aligned rectangle with a color per corner (bl, br, tr, tl). */
  addRectXY(x0: number, y0: number, x1: number, y1: number, bl: vec4, br?: vec4, tr?: vec4, tl?: vec4): void {
    const n = new vec3(0, 0, 1)
    const a = this.vert(new vec3(x0, y0, 0), n, bl)
    const b = this.vert(new vec3(x1, y0, 0), n, br ?? bl)
    const c = this.vert(new vec3(x1, y1, 0), n, tr ?? bl)
    const d = this.vert(new vec3(x0, y1, 0), n, tl ?? bl)
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  /** Straight line from a to b (XY) with an optional soft halo that fades to nothing. */
  addLineXY(ax: number, ay: number, bx: number, by: number, width: number, color: vec4, halo: number = 0, haloColor?: vec4): void {
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-6) return
    const px = -dy / len
    const py = dx / len
    const n = new vec3(0, 0, 1)
    if (this.glow > 0) {
      const sd = new vec3(px, py, 0)
      this.lightStrip([new vec3(ax, ay, 0), new vec3(bx, by, 0)], [sd, sd], n, width / 2, halo > 0 ? halo : width * this.glow, color)
      return
    }
    const quad = (o0: number, o1: number, c0: vec4, c1: vec4) => {
      const i = this.vert(new vec3(ax + px * o0, ay + py * o0, 0), n, c0)
      const j = this.vert(new vec3(bx + px * o0, by + py * o0, 0), n, c0)
      const k = this.vert(new vec3(bx + px * o1, by + py * o1, 0), n, c1)
      const l = this.vert(new vec3(ax + px * o1, ay + py * o1, 0), n, c1)
      this.tri(i, j, k)
      this.tri(i, k, l)
    }
    const w = width / 2
    quad(-w, w, color, color)
    if (halo > 0) {
      const hc = haloColor ?? scaleColor(color, 0.25)
      const zero = new vec4(0, 0, 0, 0)
      quad(w, w + halo, hc, zero)
      quad(-w, -w - halo, hc, zero)
    }
  }

  /** Polyline in XY as a flat strip of constant width. */
  addPolylineXY(pts: vec2[], width: number, color: vec4): void {
    if (this.glow > 0 && pts.length > 1) {
      this.lightStrip(
        pts.map((p) => new vec3(p.x, p.y, 0)),
        polySides(pts),
        new vec3(0, 0, 1),
        width / 2,
        width * this.glow,
        color
      )
      return
    }
    for (let i = 1; i < pts.length; i++) this.addLineXY(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, width, color)
  }

  /**
   * Append `src` (a mesh in the XY plane) scaled by `s` about its origin and moved by (dx, dy),
   * clipped to the rectangle x0..x1 × y0..y1: triangles inside are copied, triangles across an
   * edge are cut there (colours interpolated), triangles outside are dropped.
   */
  addClippedXY(src: MeshKit, s: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): void {
    const d = src.data
    const n = new vec3(0, 0, 1)
    // A vertex as [x, y, z, r, g, b, a] in this kit's space.
    const at = (i: number): number[] => [d[i * 10] * s + dx, d[i * 10 + 1] * s + dy, d[i * 10 + 2], d[i * 10 + 6], d[i * 10 + 7], d[i * 10 + 8], d[i * 10 + 9]]
    const emit = (v: number[]) => this.vert(new vec3(v[0], v[1], v[2]), n, new vec4(v[3], v[4], v[5], v[6]))
    const inside = (v: number[]) => v[0] >= x0 && v[0] <= x1 && v[1] >= y0 && v[1] <= y1
    const edges: [number, number, number][] = [
      [0, x0, 1],
      [0, x1, -1],
      [1, y0, 1],
      [1, y1, -1]
    ]
    const mapped = new Map<number, number>()
    const shared = (i: number, v: number[]) => {
      let j = mapped.get(i)
      if (j === undefined) {
        j = emit(v)
        mapped.set(i, j)
      }
      return j
    }
    for (let t = 0; t < src.indices.length; t += 3) {
      const ids = [src.indices[t], src.indices[t + 1], src.indices[t + 2]]
      const vs = ids.map(at)
      if (vs.every(inside)) {
        this.tri(shared(ids[0], vs[0]), shared(ids[1], vs[1]), shared(ids[2], vs[2]))
        continue
      }
      let poly = vs
      for (const [axis, bound, keep] of edges) {
        const out: number[][] = []
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]
          const b = poly[(i + 1) % poly.length]
          const ina = (a[axis] - bound) * keep >= 0
          const inb = (b[axis] - bound) * keep >= 0
          if (ina) out.push(a)
          if (ina !== inb) {
            const u = (bound - a[axis]) / (b[axis] - a[axis])
            out.push(a.map((x, j) => x + (b[j] - x) * u))
          }
        }
        poly = out
        if (poly.length < 3) break
      }
      if (poly.length < 3) continue
      const vi = poly.map(emit)
      for (let i = 1; i + 1 < vi.length; i++) this.tri(vi[0], vi[i], vi[i + 1])
    }
  }

  build(): RenderMesh {
    const mb = new MeshBuilder(LAYOUT)
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    mb.appendVerticesInterleaved(this.data)
    mb.appendIndices(this.indices)
    mb.updateMesh()
    return mb.getMesh()
  }
}

export interface Spawned {
  so: SceneObject
  rmv: RenderMeshVisual
  mat: Material
}

/**
 * Creates a child SceneObject with a RenderMeshVisual and its own material clone
 * (or `shared`, an already-cloned material several meshes fade together with).
 */
export function spawnMesh(parent: SceneObject, name: string, mesh: RenderMesh, material: Material, localPos?: vec3, shared?: Material): Spawned {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  if (localPos) so.getTransform().setLocalPosition(localPos)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  const mat = shared ?? material.clone()
  rmv.mainMaterial = mat
  return {so, rmv, mat}
}

/** Fade an additive/vertex-colored material by scaling its base color. */
export function setFade(mat: Material, k: number, alphaOnly: boolean = false): void {
  const f = Math.max(0, k)
  mat.mainPass.baseColor = alphaOnly ? new vec4(1, 1, 1, f) : new vec4(f, f, f, f)
}

/** Fade a glow material so its light lands at `level` (see lit in CutawayStyle). */
export function setLevel(mat: Material, level: number): void {
  setFade(mat, Math.sqrt(Math.max(0, level)))
}

export interface GlowOpts {
  /** Core half-width. */
  radius: number
  color: vec4
  /** Outer edge of the soft glow (from the centre line). Default 4 × radius. */
  halo?: number
  /** Kept for older callers; the light profile sets the halo's falloff. */
  haloAlpha?: number
  sides?: number
  step?: number
  /** Local-space viewer position: the path is a flat ribbon of light turned toward it. */
  eye?: vec3
  /** Local-space direction to the viewer (for paths inside a plane that already faces the viewer). */
  facing?: vec3
}

/**
 * A line of light along a path (hot core, soft falloff) turned toward the viewer; `setRange`
 * reveals any arc-length window of it. Without `eye` / `facing` it falls back to a plain tube.
 */
export class GlowPath {
  readonly so: SceneObject
  readonly mat: Material
  readonly length: number
  private rmv: RenderMeshVisual
  private mb: MeshBuilder
  private blocks: number[][] = []
  private pts: vec3[]
  private cum: number[] = [0]
  private shownA = -1
  private shownB = -1

  constructor(parent: SceneObject, name: string, material: Material, localPoints: vec3[], opts: GlowOpts) {
    this.pts = resample(localPoints, opts.step ?? 3)
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distance(this.pts[i - 1]))
    this.length = this.cum[this.cum.length - 1]
    const data: number[] = []
    let ring = 0
    const outer = opts.halo && opts.halo > opts.radius ? opts.halo : opts.radius * 4
    if (opts.eye || opts.facing) {
      // Flat light ribbon: one row of profile vertices per sample point.
      const f = facingSides(this.pts, opts.eye ?? null, opts.facing ?? null)
      const prof = lightProfile(opts.radius, outer - opts.radius)
      ring = prof.length
      for (let i = 0; i < this.pts.length; i++) {
        for (const q of prof) {
          const p = this.pts[i].add(f.side[i].uniformScale(q.o))
          const c = lightColor(opts.color, q.k, q.hot)
          const nn = f.normal[i]
          data.push(p.x, p.y, p.z, nn.x, nn.y, nn.z, c.x, c.y, c.z, c.w)
        }
      }
      for (let i = 0; i < this.pts.length - 1; i++) {
        const block: number[] = []
        for (let k = 0; k < ring - 1; k++) {
          const a = i * ring + k
          const b = a + ring
          block.push(a, b, b + 1, a, b + 1, a + 1)
        }
        this.blocks.push(block)
      }
    } else {
      const sides = opts.sides ?? 6
      const frames = pathFrames(this.pts)
      const layers: {r: number; c: vec4}[] = [{r: opts.radius, c: opts.color}]
      if (opts.halo && opts.halo > 0) layers.push({r: opts.halo, c: scaleColor(opts.color, opts.haloAlpha ?? 0.22)})
      const ringBase: number[] = []
      let count = 0
      for (const layer of layers) {
        ringBase.push(count)
        for (let i = 0; i < this.pts.length; i++) {
          for (let k = 0; k < sides; k++) {
            const ang = (k / sides) * Math.PI * 2
            const dir = frames[i].n.uniformScale(Math.cos(ang)).add(frames[i].b.uniformScale(Math.sin(ang)))
            const p = this.pts[i].add(dir.uniformScale(layer.r))
            data.push(p.x, p.y, p.z, dir.x, dir.y, dir.z, layer.c.x, layer.c.y, layer.c.z, layer.c.w)
            count++
          }
        }
      }
      for (let i = 0; i < this.pts.length - 1; i++) {
        const block: number[] = []
        for (const base of ringBase) {
          for (let k = 0; k < sides; k++) {
            const a = base + i * sides + k
            const b = base + i * sides + ((k + 1) % sides)
            const c = base + (i + 1) * sides + k
            const d = base + (i + 1) * sides + ((k + 1) % sides)
            block.push(a, b, c, b, d, c)
          }
        }
        this.blocks.push(block)
      }
    }

    this.mb = new MeshBuilder(LAYOUT)
    this.mb.topology = MeshTopology.Triangles
    this.mb.indexType = MeshIndexType.UInt16
    this.mb.appendVerticesInterleaved(data)
    this.mb.updateMesh()

    this.so = global.scene.createSceneObject(name)
    this.so.setParent(parent)
    this.rmv = this.so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.rmv.mesh = this.mb.getMesh()
    this.mat = material.clone()
    this.rmv.mainMaterial = this.mat
    this.rmv.enabled = false
  }

  /** Show the part of the path between arc-length fractions a..b (0..1). */
  setRange(a: number, b: number): void {
    const la = Math.max(0, Math.min(1, a)) * this.length
    const lb = Math.max(0, Math.min(1, b)) * this.length
    let i0 = -1
    let i1 = -1
    for (let i = 0; i < this.blocks.length; i++) {
      if (this.cum[i + 1] > la && this.cum[i] < lb) {
        if (i0 < 0) i0 = i
        i1 = i
      }
    }
    if (i0 === this.shownA && i1 === this.shownB) return
    this.shownA = i0
    this.shownB = i1
    const n = this.mb.getIndicesCount()
    if (n > 0) this.mb.eraseIndices(0, n)
    if (i0 >= 0) {
      const idx: number[] = []
      for (let i = i0; i <= i1; i++) for (const v of this.blocks[i]) idx.push(v)
      this.mb.appendIndices(idx)
    }
    this.mb.updateMesh()
    this.rmv.enabled = i0 >= 0
  }

  /** Local-space point at arc-length fraction f. */
  pointAt(f: number): vec3 {
    const l = Math.max(0, Math.min(1, f)) * this.length
    for (let i = 1; i < this.cum.length; i++) {
      if (this.cum[i] >= l) {
        const seg = this.cum[i] - this.cum[i - 1]
        const t = seg > 1e-6 ? (l - this.cum[i - 1]) / seg : 0
        return vec3.lerp(this.pts[i - 1], this.pts[i], t)
      }
    }
    return this.pts[this.pts.length - 1]
  }

  setOpacity(k: number): void {
    setFade(this.mat, k)
  }
}

/** Flat line of light in the local XY plane whose sample points are rewritten each frame. */
export class DynamicRibbon {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private prof: ProfileStop[]
  private cols: vec4[]

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private count: number,
    width: number,
    color: vec4,
    glow: number = LIGHT_GLOW
  ) {
    this.prof = lightProfile(width / 2, width * glow)
    this.cols = this.prof.map((q) => lightColor(color, q.k, q.hot))
    const P = this.prof.length
    this.mb = new MeshBuilder(LAYOUT)
    this.mb.topology = MeshTopology.Triangles
    this.mb.indexType = MeshIndexType.UInt16
    const data: number[] = []
    for (let i = 0; i < count; i++) for (const c of this.cols) data.push(0, 0, 0, 0, 0, 1, c.x, c.y, c.z, c.w)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let i = 0; i < count - 1; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = i * P + k
        const b = a + P
        idx.push(a, b, b + 1, a, b + 1, a + 1)
      }
    }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    this.so = global.scene.createSceneObject(name)
    this.so.setParent(parent)
    const rmv = this.so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.mb.getMesh()
    this.mat = material.clone()
    rmv.mainMaterial = this.mat
  }

  update(pointAt: (i: number) => vec3): void {
    const P = this.prof.length
    const pts: vec3[] = []
    for (let i = 0; i < this.count; i++) pts.push(pointAt(i))
    for (let i = 0; i < this.count; i++) {
      const a = pts[Math.max(0, i - 1)]
      const b = pts[Math.min(this.count - 1, i + 1)]
      const t = b.sub(a)
      let perp = new vec3(-t.y, t.x, 0)
      perp = perp.length > 1e-6 ? perp.normalize() : new vec3(0, 1, 0)
      for (let k = 0; k < P; k++) {
        const p = pts[i].add(perp.uniformScale(this.prof[k].o))
        const c = this.cols[k]
        this.mb.setVertexInterleaved(i * P + k, [p.x, p.y, p.z, 0, 0, 1, c.x, c.y, c.z, c.w])
      }
    }
    this.mb.updateMesh()
  }
}

/** Cross-section of a trail: hot centre, soft edges (offsets × half-width). */
const TRAIL_PROFILE = [
  {o: -1, k: 0, hot: 0},
  {o: -0.42, k: 0.5, hot: 0},
  {o: 0, k: 1, hot: 0.4},
  {o: 0.42, k: 0.5, hot: 0},
  {o: 1, k: 0, hot: 0}
]
/**
 * A ribbon of light through 3D points that always turns its flat side to the viewer (hot centre,
 * soft edges). Points are rewritten every frame (a waveform travelling along the line of light).
 */
export class TrailRibbon {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder
  private rmv: RenderMeshVisual
  private cols: vec4[]

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private count: number,
    private width: number,
    color: vec4
  ) {
    const P = TRAIL_PROFILE.length
    this.cols = TRAIL_PROFILE.map((q) => lightColor(color, q.k, q.hot))
    this.mb = new MeshBuilder(LAYOUT)
    this.mb.topology = MeshTopology.Triangles
    this.mb.indexType = MeshIndexType.UInt16
    const data: number[] = []
    for (let i = 0; i < count * P; i++) data.push(0, 0, 0, 0, 0, 1, 0, 0, 0, 0)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let i = 0; i < count - 1; i++) {
      for (let k = 0; k < P - 1; k++) {
        const a = i * P + k
        const b = a + P
        idx.push(a, b, b + 1, a, b + 1, a + 1)
      }
    }
    this.mb.appendIndices(idx)
    this.mb.updateMesh()
    this.so = global.scene.createSceneObject(name)
    this.so.setParent(parent)
    this.rmv = this.so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.rmv.mesh = this.mb.getMesh()
    this.mat = material.clone()
    this.rmv.mainMaterial = this.mat
  }

  /** `pts` in parent-local space; `toViewer` is the direction to the camera; `alphas` taper the ends. */
  update(pts: vec3[], toViewer: vec3, alphas?: number[]): void {
    const P = TRAIL_PROFILE.length
    const n = pts.length
    for (let i = 0; i < this.count; i++) {
      const p = pts[Math.min(i, n - 1)]
      const a = pts[Math.max(0, Math.min(i, n - 1) - 1)]
      const b = pts[Math.min(n - 1, i + 1)]
      let side = b.sub(a).cross(toViewer)
      side = side.length > 1e-6 ? side.normalize().uniformScale(this.width / 2) : new vec3(0, this.width / 2, 0)
      const k = alphas ? alphas[Math.min(i, alphas.length - 1)] : 1
      for (let j = 0; j < P; j++) {
        const q = p.add(side.uniformScale(TRAIL_PROFILE[j].o))
        const c = this.cols[j]
        this.mb.setVertexInterleaved(i * P + j, [q.x, q.y, q.z, 0, 0, 1, c.x * k, c.y * k, c.z * k, c.w * k])
      }
    }
    this.mb.updateMesh()
  }

  setVisible(v: boolean): void {
    this.rmv.enabled = v
  }
}

/**
 * A straight line placed with transforms only: a unit-length strip along local +X. Move its ends
 * with `set(a, b)` every frame (cantilevers, leader lines) without rebuilding geometry.
 */
export class UnitLine {
  readonly so: SceneObject
  readonly mat: Material

  /** `shape`, if given, replaces the plain line: anything drawn along +X from 0 to 1. */
  constructor(parent: SceneObject, name: string, material: Material, width: number, color: vec4, halo: number = 0, shared?: Material, shape?: MeshKit) {
    let kit = shape
    if (!kit) {
      kit = new MeshKit(LIGHT_GLOW)
      kit.addLineXY(0, 0, 1, 0, width, color, halo)
    }
    const s = spawnMesh(parent, name, kit.build(), material, undefined, shared)
    this.so = s.so
    this.mat = s.mat
  }

  /** Ends in the parent's local XY plane. */
  set(a: vec3, b: vec3): void {
    const d = b.sub(a)
    const len = Math.max(1e-4, Math.sqrt(d.x * d.x + d.y * d.y))
    const tr = this.so.getTransform()
    tr.setLocalPosition(a)
    tr.setLocalRotation(quat.angleAxis(Math.atan2(d.y, d.x), vec3.forward()))
    tr.setLocalScale(new vec3(len, 1, 1))
  }
}
