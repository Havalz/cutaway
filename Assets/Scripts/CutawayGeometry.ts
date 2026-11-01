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

export class MeshKit {
  private data: number[] = []
  private indices: number[] = []
  private count = 0

  vert(p: vec3, n: vec3, c: vec4): number {
    this.data.push(p.x, p.y, p.z, n.x, n.y, n.z, c.x, c.y, c.z, c.w)
    return this.count++
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c)
  }

  addTube(points: vec3[], radius: number, color: vec4, sides: number = 6, step: number = 4): void {
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

/** Creates a child SceneObject with a RenderMeshVisual and its own material clone. */
export function spawnMesh(parent: SceneObject, name: string, mesh: RenderMesh, material: Material, localPos?: vec3): Spawned {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  if (localPos) so.getTransform().setLocalPosition(localPos)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  const mat = material.clone()
  rmv.mainMaterial = mat
  return {so, rmv, mat}
}

/** Fade an additive/vertex-colored material by scaling its base color. */
export function setFade(mat: Material, k: number, alphaOnly: boolean = false): void {
  const f = Math.max(0, k)
  mat.mainPass.baseColor = alphaOnly ? new vec4(1, 1, 1, f) : new vec4(f, f, f, f)
}

export interface GlowOpts {
  radius: number
  color: vec4
  halo?: number
  haloAlpha?: number
  sides?: number
  step?: number
}

/** A glowing tube along a path; `setRange` reveals any arc-length window of it. */
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
    const sides = opts.sides ?? 6
    this.pts = resample(localPoints, opts.step ?? 3)
    for (let i = 1; i < this.pts.length; i++) this.cum.push(this.cum[i - 1] + this.pts[i].distance(this.pts[i - 1]))
    this.length = this.cum[this.cum.length - 1]
    const frames = pathFrames(this.pts)
    const layers: {r: number; c: vec4}[] = [{r: opts.radius, c: opts.color}]
    if (opts.halo && opts.halo > 0) layers.push({r: opts.halo, c: scaleColor(opts.color, opts.haloAlpha ?? 0.22)})

    const data: number[] = []
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

/** Flat ribbon in the local XY plane whose sample points are rewritten each frame. */
export class DynamicRibbon {
  readonly so: SceneObject
  readonly mat: Material
  private mb: MeshBuilder

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private count: number,
    private width: number,
    private color: vec4
  ) {
    this.mb = new MeshBuilder(LAYOUT)
    this.mb.topology = MeshTopology.Triangles
    this.mb.indexType = MeshIndexType.UInt16
    const data: number[] = []
    for (let i = 0; i < count * 2; i++) data.push(0, 0, 0, 0, 0, 1, color.x, color.y, color.z, color.w)
    this.mb.appendVerticesInterleaved(data)
    const idx: number[] = []
    for (let i = 0; i < count - 1; i++) {
      const a = i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
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
    const c = this.color
    const pts: vec3[] = []
    for (let i = 0; i < this.count; i++) pts.push(pointAt(i))
    for (let i = 0; i < this.count; i++) {
      const a = pts[Math.max(0, i - 1)]
      const b = pts[Math.min(this.count - 1, i + 1)]
      const t = b.sub(a)
      let perp = new vec3(-t.y, t.x, 0)
      perp = perp.length > 1e-6 ? perp.normalize().uniformScale(this.width / 2) : new vec3(0, this.width / 2, 0)
      const p0 = pts[i].add(perp)
      const p1 = pts[i].sub(perp)
      this.mb.setVertexInterleaved(i * 2, [p0.x, p0.y, p0.z, 0, 0, 1, c.x, c.y, c.z, c.w])
      this.mb.setVertexInterleaved(i * 2 + 1, [p1.x, p1.y, p1.z, 0, 0, 1, c.x, c.y, c.z, c.w])
    }
    this.mb.updateMesh()
  }
}
