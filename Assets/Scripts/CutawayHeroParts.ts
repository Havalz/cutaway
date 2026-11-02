/**
 * Camera hero, pass 2 §5: solid geometry for the replica's interior parts, built in code
 * (lathe, extrude, bevel, convex clipping). Everything is in part-local cm at 1x; the replica is
 * shown at 3x. Faces are wound to match their normals (MeshKit.triOut), so the parts render with
 * back faces culled and the PBR rim highlight reads as a real fresnel edge.
 */
import {MeshKit} from "./CutawayGeometry"

const TAU = Math.PI * 2

/** A lathe profile point: radius `r`, height `z` along the axis (+Z), outward normal (`nr` radial, `nz` axial). */
export interface LP {
  r: number
  z: number
  nr: number
  nz: number
}

/** Smooth surface of revolution around local +Z (through `o`) between angles a0 and a1. */
export function latheSmooth(k: MeshKit, prof: LP[], seg: number, color: vec4, a0: number = 0, a1: number = TAU, o: vec3 = vec3.zero()): void {
  const base = k.vertexCount
  const cols = seg + 1
  for (const p of prof) {
    const nl = Math.sqrt(p.nr * p.nr + p.nz * p.nz) || 1
    for (let s = 0; s <= seg; s++) {
      const a = a0 + ((a1 - a0) * s) / seg
      const c = Math.cos(a)
      const sn = Math.sin(a)
      k.vert(new vec3(o.x + c * p.r, o.y + sn * p.r, o.z + p.z), new vec3((c * p.nr) / nl, (sn * p.nr) / nl, p.nz / nl), color)
    }
  }
  for (let j = 0; j < prof.length - 1; j++)
    for (let s = 0; s < seg; s++) {
      const a = base + j * cols + s
      const b = a + cols
      k.triOut(a, a + 1, b)
      k.triOut(a + 1, b + 1, b)
    }
}

/**
 * A closed (r, z) outline revolved around +Z with flat bands (hard edges, e.g. a chamfered ring).
 * A partial revolution (a0..a1) gets flat end caps; the outline must then be convex.
 */
export function latheLoop(k: MeshKit, loop: vec2[], seg: number, color: vec4, a0: number = 0, a1: number = TAU, o: vec3 = vec3.zero()): void {
  const n = loop.length
  let area = 0
  for (let i = 0; i < n; i++) area += loop[i].x * loop[(i + 1) % n].y - loop[(i + 1) % n].x * loop[i].y
  const sgn = area > 0 ? 1 : -1
  for (let i = 0; i < n; i++) {
    const p = loop[i]
    const q = loop[(i + 1) % n]
    const dx = q.x - p.x
    const dz = q.y - p.y
    const L = Math.sqrt(dx * dx + dz * dz)
    if (L < 1e-6) continue
    const nr = (sgn * dz) / L
    const nz = (-sgn * dx) / L
    latheSmooth(k, [{r: p.x, z: p.y, nr, nz}, {r: q.x, z: q.y, nr, nz}], seg, color, a0, a1, o)
  }
  if (Math.abs(a1 - a0 - TAU) < 1e-6) return
  let cx = 0
  let cz = 0
  for (const p of loop) {
    cx += p.x / n
    cz += p.y / n
  }
  for (const [a, out] of [
    [a0, -1],
    [a1, 1]
  ]) {
    const c = Math.cos(a)
    const s = Math.sin(a)
    const nrm = new vec3(-s * out, c * out, 0)
    const ctr = k.vert(new vec3(o.x + c * cx, o.y + s * cx, o.z + cz), nrm, color)
    const ids = loop.map((p) => k.vert(new vec3(o.x + c * p.x, o.y + s * p.x, o.z + p.y), nrm, color))
    for (let i = 0; i < n; i++) k.triOut(ctr, ids[i], ids[(i + 1) % n])
  }
}

/** A chamfered rectangle in (r, z): a ring's cross-section (r0..r1, z0..z1, chamfer b). */
export function chamferRect(r0: number, r1: number, z0: number, z1: number, b: number): vec2[] {
  return [
    new vec2(r0 + b, z0),
    new vec2(r1 - b, z0),
    new vec2(r1, z0 + b),
    new vec2(r1, z1 - b),
    new vec2(r1 - b, z1),
    new vec2(r0 + b, z1),
    new vec2(r0, z1 - b),
    new vec2(r0, z0 + b)
  ]
}

function sag(R: number, x: number): number {
  return Math.sign(R) * (Math.abs(R) - Math.sqrt(Math.max(0, R * R - x * x)))
}

/**
 * A lens element of radius `r` and centre thickness `t`, centred at z = 0, with spherical faces.
 * `R1` = front (+Z) radius, `R2` = rear radius; positive = convex outward, negative = concave
 * (so R1 > 0, R2 > 0 is biconvex and R1 > 0, R2 < 0 a positive meniscus). Real curvature, real
 * normals, a cylindrical rim with hard edges.
 */
export function lensProfile(r: number, t: number, R1: number, R2: number, n: number): LP[] {
  const out: LP[] = []
  const c1 = t / 2 - R1
  const c2 = -t / 2 + R2
  for (let i = 0; i <= n; i++) {
    const x = Math.max(1e-4, (r * i) / n)
    const z = t / 2 - sag(R1, x)
    out.push({r: x, z, nr: x / R1, nz: (z - c1) / R1})
  }
  out.push({r, z: t / 2 - sag(R1, r), nr: 1, nz: 0})
  out.push({r, z: -t / 2 + sag(R2, r), nr: 1, nz: 0})
  for (let i = n; i >= 0; i--) {
    const x = Math.max(1e-4, (r * i) / n)
    const z = -t / 2 + sag(R2, x)
    out.push({r: x, z, nr: x / R2, nz: (z - c2) / R2})
  }
  return out
}

/** Front and rear rim z of a lens from lensProfile (for edge highlights). */
export function lensRim(r: number, t: number, R1: number, R2: number): {front: number; rear: number} {
  return {front: t / 2 - sag(R1, r), rear: -t / 2 + sag(R2, r)}
}

/**
 * A box with chamfered edges and corners (26 flat faces). `ax`, `ay`, `az` are unit axes, `h` the
 * half extents along them, `b` the chamfer.
 */
export function bevelBox(k: MeshKit, c: vec3, ax: vec3, ay: vec3, az: vec3, h: vec3, b: number, color: vec4): void {
  const P = (x: number, y: number, z: number) => c.add(ax.uniformScale(x)).add(ay.uniformScale(y)).add(az.uniformScale(z))
  const N = (x: number, y: number, z: number) => ax.uniformScale(x).add(ay.uniformScale(y)).add(az.uniformScale(z)).normalize()
  const quad = (pts: vec3[], n: vec3) => {
    const i = pts.map((p) => k.vert(p, n, color))
    k.triOut(i[0], i[1], i[2])
    k.triOut(i[0], i[2], i[3])
  }
  const hx = h.x
  const hy = h.y
  const hz = h.z
  const ix = hx - b
  const iy = hy - b
  const iz = hz - b
  for (const s of [-1, 1]) {
    quad([P(s * hx, -iy, -iz), P(s * hx, iy, -iz), P(s * hx, iy, iz), P(s * hx, -iy, iz)], N(s, 0, 0))
    quad([P(-ix, s * hy, -iz), P(ix, s * hy, -iz), P(ix, s * hy, iz), P(-ix, s * hy, iz)], N(0, s, 0))
    quad([P(-ix, -iy, s * hz), P(ix, -iy, s * hz), P(ix, iy, s * hz), P(-ix, iy, s * hz)], N(0, 0, s))
  }
  for (const a of [-1, 1])
    for (const d of [-1, 1]) {
      quad([P(a * hx, d * iy, -iz), P(a * hx, d * iy, iz), P(a * ix, d * hy, iz), P(a * ix, d * hy, -iz)], N(a, d, 0))
      quad([P(a * hx, -iy, d * iz), P(a * hx, iy, d * iz), P(a * ix, iy, d * hz), P(a * ix, -iy, d * hz)], N(a, 0, d))
      quad([P(-ix, a * hy, d * iz), P(ix, a * hy, d * iz), P(ix, a * iy, d * hz), P(-ix, a * iy, d * hz)], N(0, a, d))
    }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const n = N(sx, sy, sz)
        k.triOut(k.vert(P(sx * hx, sy * iy, sz * iz), n, color), k.vert(P(sx * ix, sy * hy, sz * iz), n, color), k.vert(P(sx * ix, sy * iy, sz * hz), n, color))
      }
}

/** A rectangular frame (four bevelled bars) around a window, in the XY plane, thickness along Z. */
export function bevelFrame(k: MeshKit, c: vec3, inner: vec2, outer: vec2, depth: number, b: number, color: vec4): void {
  const X = new vec3(1, 0, 0)
  const Y = new vec3(0, 1, 0)
  const Z = new vec3(0, 0, 1)
  const ty = (outer.y - inner.y) / 2
  const tx = (outer.x - inner.x) / 2
  for (const s of [-1, 1]) {
    bevelBox(k, c.add(new vec3(0, s * (inner.y + ty), 0)), X, Y, Z, new vec3(outer.x, ty, depth / 2), b, color)
    bevelBox(k, c.add(new vec3(s * (inner.x + tx), 0, 0)), X, Y, Z, new vec3(tx, inner.y, depth / 2), b, color)
  }
}

/**
 * A thin plate between an inner and an outer edge (paired points, XY), extruded from z0 to z1:
 * caps, both edges and both ends. Used for the aperture blades.
 */
export function extrudeStrip(k: MeshKit, inner: vec2[], outer: vec2[], z0: number, z1: number, color: vec4): void {
  const n = inner.length
  const V = (p: vec2, z: number, nrm: vec3) => k.vert(new vec3(p.x, p.y, z), nrm, color)
  for (const [z, nz] of [
    [z0, -1],
    [z1, 1]
  ]) {
    const nrm = new vec3(0, 0, nz)
    for (let i = 0; i < n - 1; i++) {
      const a = V(inner[i], z, nrm)
      const b = V(outer[i], z, nrm)
      const c = V(outer[i + 1], z, nrm)
      const d = V(inner[i + 1], z, nrm)
      k.triOut(a, b, c)
      k.triOut(a, c, d)
    }
  }
  const wall = (p: vec2, q: vec2, away: vec2) => {
    const e = q.sub(p)
    let nrm = new vec3(-e.y, e.x, 0)
    if (nrm.length < 1e-9) return
    nrm = nrm.normalize()
    const mid = p.add(q).uniformScale(0.5)
    if (nrm.x * (mid.x - away.x) + nrm.y * (mid.y - away.y) < 0) nrm = nrm.uniformScale(-1)
    const a = V(p, z0, nrm)
    const b = V(q, z0, nrm)
    const c = V(q, z1, nrm)
    const d = V(p, z1, nrm)
    k.triOut(a, b, c)
    k.triOut(a, c, d)
  }
  for (let i = 0; i < n - 1; i++) {
    wall(inner[i], inner[i + 1], outer[i].add(outer[i + 1]).uniformScale(0.5))
    wall(outer[i], outer[i + 1], inner[i].add(inner[i + 1]).uniformScale(0.5))
  }
  wall(inner[0], outer[0], inner[1].add(outer[1]).uniformScale(0.5))
  wall(inner[n - 1], outer[n - 1], inner[n - 2].add(outer[n - 2]).uniformScale(0.5))
}

// ---------------- Convex polyhedra (the pentaprism) ----------------

/** A convex polyhedron as a list of planar faces (vertex loops). */
export type Poly = vec3[][]

/** A prism: the (z, y) outline extruded across x in [-hx, hx]. */
export function extrudeX(outline: vec2[], hx: number): Poly {
  const faces: Poly = []
  faces.push(outline.map((p) => new vec3(-hx, p.y, p.x)))
  faces.push(outline.map((p) => new vec3(hx, p.y, p.x)))
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]
    const q = outline[(i + 1) % outline.length]
    faces.push([new vec3(-hx, p.y, p.x), new vec3(-hx, q.y, q.x), new vec3(hx, q.y, q.x), new vec3(hx, p.y, p.x)])
  }
  return faces
}

/** Cut a convex polyhedron with a plane, keeping n·p <= d, and close the cut with a new face. */
export function clipPoly(faces: Poly, n: vec3, d: number): Poly {
  const eps = 1e-6
  const out: Poly = []
  const onPlane: vec3[] = []
  for (const f of faces) {
    const res: vec3[] = []
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      const da = n.dot(a) - d
      const db = n.dot(b) - d
      if (da <= eps) res.push(a)
      if (Math.abs(da) <= eps) onPlane.push(a)
      if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
        const p = a.add(b.sub(a).uniformScale(da / (da - db)))
        res.push(p)
        onPlane.push(p)
      }
    }
    if (res.length >= 3 && polyArea(res) > 1e-6) out.push(res)
  }
  const uniq: vec3[] = []
  for (const p of onPlane) if (!uniq.some((q) => q.distance(p) < 1e-5)) uniq.push(p)
  if (uniq.length >= 3) {
    let c = vec3.zero()
    for (const p of uniq) c = c.add(p)
    c = c.uniformScale(1 / uniq.length)
    const u = uniq[0].sub(c).normalize()
    const v = n.cross(u)
    uniq.sort((p, q) => Math.atan2(p.sub(c).dot(v), p.sub(c).dot(u)) - Math.atan2(q.sub(c).dot(v), q.sub(c).dot(u)))
    out.push(uniq)
  }
  return out
}

function polyArea(f: vec3[]): number {
  let s = vec3.zero()
  for (let i = 1; i < f.length - 1; i++) s = s.add(f[i].sub(f[0]).cross(f[i + 1].sub(f[0])))
  return s.length / 2
}

/** Flat-shaded faces of a convex polyhedron (normals point away from its centre). Returns its edges. */
export function addPoly(k: MeshKit, faces: Poly, color: vec4): [vec3, vec3][] {
  let c = vec3.zero()
  let m = 0
  for (const f of faces)
    for (const p of f) {
      c = c.add(p)
      m++
    }
  c = c.uniformScale(1 / Math.max(1, m))
  const edges: [vec3, vec3][] = []
  for (const f of faces) {
    let nrm = vec3.zero()
    for (let i = 1; i < f.length - 1; i++) nrm = nrm.add(f[i].sub(f[0]).cross(f[i + 1].sub(f[0])))
    if (nrm.length < 1e-9) continue
    nrm = nrm.normalize()
    let fc = vec3.zero()
    for (const p of f) fc = fc.add(p)
    fc = fc.uniformScale(1 / f.length)
    if (nrm.dot(fc.sub(c)) < 0) nrm = nrm.uniformScale(-1)
    const ids = f.map((p) => k.vert(p, nrm, color))
    for (let i = 1; i < ids.length - 1; i++) k.triOut(ids[0], ids[i], ids[i + 1])
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      if (!edges.some((e) => (e[0].distance(a) < 1e-4 && e[1].distance(b) < 1e-4) || (e[0].distance(b) < 1e-4 && e[1].distance(a) < 1e-4))) edges.push([a, b])
    }
  }
  return edges
}

/** Points on a circle of radius r at height z around +Z (closed). */
export function ringPts(r: number, z: number, n: number): vec3[] {
  const pts: vec3[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU
    pts.push(new vec3(Math.cos(a) * r, Math.sin(a) * r, z))
  }
  return pts
}

// ---------------- Aperture blades ----------------

export interface Blade {
  /** Pivot (aperture-local XY) the blade turns about to close the iris. */
  pivot: vec2
  /** Inner (opening) and outer edge points relative to the pivot. */
  inner: vec2[]
  outer: vec2[]
}

/**
 * Seven curved, overlapping iris blades. Blade i's inner edge is an arc that comes closest to the
 * axis (at `rOpen`) in the middle of its sector; together the seven arcs make a near-round opening.
 * Each blade spans more than its own sector, so neighbours overlap, and the outer edge tucks under
 * the housing. Turning every blade about its pivot by the same angle closes the iris (stretch S1).
 */
export function irisBlades(count: number, rOpen: number, rOuter: number, span: number, n: number): Blade[] {
  const blades: Blade[] = []
  const delta = 0.25
  const rho = rOpen + delta
  for (let i = 0; i < count; i++) {
    const phi = (i / count) * TAU
    const inner: vec2[] = []
    const outer: vec2[] = []
    for (let j = 0; j <= n; j++) {
      const u = j / n
      const psi = phi - span / 2 + span * u
      // Inner arc: circle of radius rho centred delta behind the axis (away from this blade).
      const dp = psi - phi
      const tIn = -delta * Math.cos(dp) + Math.sqrt(rho * rho - delta * delta * Math.sin(dp) * Math.sin(dp))
      // The outer edge tapers to the inner one at both tips: a crescent.
      const taper = Math.max(0.12, Math.pow(Math.sin(Math.PI * u), 0.45))
      const tOut = tIn + (rOuter - tIn) * taper
      inner.push(new vec2(Math.cos(psi) * tIn, Math.sin(psi) * tIn))
      outer.push(new vec2(Math.cos(psi) * tOut, Math.sin(psi) * tOut))
    }
    // Pivot near the leading tip, just inside the outer edge.
    const pa = phi - span / 2 + span * 0.12
    const pivot = new vec2(Math.cos(pa) * (rOuter - 0.18), Math.sin(pa) * (rOuter - 0.18))
    blades.push({pivot, inner: inner.map((p) => p.sub(pivot)), outer: outer.map((p) => p.sub(pivot))})
  }
  return blades
}

/** Radius of the iris opening when every blade is turned by `ang` about its pivot. */
export function irisOpening(blades: Blade[], ang: number): number {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  let m = 1e9
  for (const b of blades)
    for (const p of b.inner) {
      const x = b.pivot.x + p.x * c - p.y * s
      const y = b.pivot.y + p.x * s + p.y * c
      m = Math.min(m, Math.sqrt(x * x + y * y))
    }
  return m
}
