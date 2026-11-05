import {MeshKit, setLevel, spawnMesh} from "./CutawayGeometry"
import {LampModel, ROOM_LAMP} from "./CutawayLampModel"
import {RecordPlayerModel} from "./CutawayRecordPlayerModel"
import {softOutline} from "./CutawayStageKit"
import {HALO, INK, lit, NO_LIGHT, packed, withAlpha} from "./CutawayStyle"

export type HaloKey = "camera" | "recordPlayer" | "lamp"

/** One mesh of the shell, posed exactly where it is on the real object. */
interface ShellPiece {
  mesh: RenderMesh
  position: vec3
  rotation: quat
  scale: vec3
  tris: number
}

/** The ring of light on the surface under the object. */
interface Footprint {
  center: vec3
  yaw: quat
  halfX: number
  halfZ: number
  corner: number
  /** How far the ring's light runs in and out of the outline (cm). */
  soft: number
}

export interface HaloShell {
  pieces: ShellPiece[]
  footprint: Footprint
  /** How tightly the rim hugs the silhouette: flat faces need it tight, round ones can carry it wider. */
  power: number
}

interface HaloSet {
  key: HaloKey
  root: SceneObject
  power: number
  mat: Material
  ringMat: Material
  /** World heights the glint sweeps between. */
  y0: number
  y1: number
  center: vec3
  level: number
  /** What the level was last asked to reach: the glint fires when that rises to the full rim. */
  lastTarget: number
  /** Seconds into the glint, or negative when none is running. */
  glintT: number
  glints: number
  tris: number
}

export interface HaloInfo {
  /** Halos whose meshes are enabled at all. */
  enabled: HaloKey[]
  /** The rim level (landed light at its brightest) of the first of them. */
  level: number
  /** The ring's landed level. */
  ring: number
  glinting: boolean
  /** How many glints each halo has run. */
  glints: {[key: string]: number}
  /** Triangles each halo adds while visible (rim shell + ring). */
  tris: {[key: string]: number}
}

/** A rounded rectangle's outline (or a circle, when the corners are as big as the half widths). */
function roundedOutline(hx: number, hz: number, corner: number): vec2[] {
  const r = Math.min(corner, hx, hz)
  const pts: vec2[] = []
  const STEPS = 8
  const corners = [new vec2(hx - r, hz - r), new vec2(-hx + r, hz - r), new vec2(-hx + r, -hz + r), new vec2(hx - r, -hz + r)]
  corners.forEach((c, i) => {
    for (let s = 0; s <= STEPS; s++) {
      const a = ((i + s / STEPS) * Math.PI) / 2
      const q = new vec2(c.x + r * Math.cos(a), c.y + r * Math.sin(a))
      // Where the straight sides have no length, the corners share a point: a repeat would give the ring's offsets no direction.
      const last = pts.length ? pts[pts.length - 1] : null
      if (!last || q.distance(last) > 1e-3) pts.push(q)
    }
  })
  if (pts[0].distance(pts[pts.length - 1]) <= 1e-3) pts.pop()
  return pts
}

function corners(p: ShellPiece): vec3[] {
  const a = p.mesh.aabbMin
  const b = p.mesh.aabbMax
  const out: vec3[] = []
  for (const x of [a.x, b.x]) for (const y of [a.y, b.y]) for (const z of [a.z, b.z]) out.push(p.position.add(p.rotation.multiplyVec3(new vec3(x * p.scale.x, y * p.scale.y, z * p.scale.z))))
  return out
}

/**
 * The halo: a fresnel rim on the object's scale-1 shell, a soft ring on the surface under it, and
 * one glint up the silhouette when it appears. One at a time: every other halo's meshes are
 * disabled, so only the gazed object's triangles draw. CutawayMain says what it wants each frame.
 */
export class Halos {
  private root: SceneObject
  private sets = new Map<HaloKey, HaloSet>()
  private queue: {key: HaloKey; build: () => HaloShell}[] = []
  private wantKey: HaloKey | null = null
  private wantLevel = 0

  constructor(
    parent: SceneObject,
    private haloMat: Material,
    private glowMat: Material
  ) {
    this.root = global.scene.createSceneObject("Halos")
    this.root.setParent(parent)
    // World coordinates, whatever the parent does.
    this.root.getTransform().setWorldPosition(vec3.zero())
  }

  /** Queue an object's shell: they are built one a frame, so looking at something never hitches. */
  add(key: HaloKey, build: () => HaloShell): void {
    this.queue.push({key, build})
  }

  /** What should show now, at what landed level; null for nothing. */
  want(key: HaloKey | null, level: number): void {
    this.wantKey = key
    this.wantLevel = key ? level : 0
  }

  update(dt: number): void {
    const next = this.queue.shift()
    if (next) this.sets.set(next.key, this.build(next.key, next.build()))
    const wanted = this.wantKey ? this.sets.get(this.wantKey) ?? null : null
    // Another halo goes first, quickly when one is waiting, so there is never more than one.
    let othersOut = true
    this.sets.forEach((s) => {
      if (s === wanted) return
      if (s.root.enabled) {
        s.level = Math.max(0, s.level - (HALO.rim / (wanted ? HALO.switchS : HALO.fadeS)) * dt)
        s.lastTarget = 0
        if (s.level <= 0) {
          s.root.enabled = false
          s.glintT = -1
        } else othersOut = false
      }
    })
    if (wanted && othersOut) {
      wanted.root.enabled = true
      if (this.wantLevel >= HALO.rim && wanted.lastTarget < HALO.rim) {
        wanted.glintT = 0
        wanted.glints++
      }
      wanted.lastTarget = this.wantLevel
      const step = (HALO.rim / HALO.fadeS) * dt
      wanted.level += Math.max(-step, Math.min(step, this.wantLevel - wanted.level))
    }
    this.sets.forEach((s) => {
      if (s.root.enabled) this.apply(s, dt)
    })
  }

  info(): HaloInfo {
    const enabled: HaloKey[] = []
    const glints: {[key: string]: number} = {}
    const tris: {[key: string]: number} = {}
    let level = 0
    let glinting = false
    this.sets.forEach((s, k) => {
      glints[k] = s.glints
      tris[k] = s.tris
      if (s.root.enabled) {
        if (!enabled.length) level = s.level
        enabled.push(k)
        glinting = glinting || s.glintT >= 0
      }
    })
    return {enabled, level, ring: (level / HALO.rim) * HALO.contact, glinting, glints, tris}
  }

  private apply(s: HaloSet, dt: number): void {
    let glintY = s.y0
    let glint = 0
    if (s.glintT >= 0) {
      s.glintT += dt
      const k = Math.min(1, s.glintT / HALO.glintS)
      glintY = s.y0 - HALO.glintWidth + (s.y1 - s.y0 + 2 * HALO.glintWidth) * k
      glint = HALO.glintLevel * Math.sin(Math.PI * k)
      if (k >= 1) s.glintT = -1
    }
    s.mat.mainPass.haloParams = packed(s.level, s.power, glintY, HALO.glintWidth)
    s.mat.mainPass.haloColor = withAlpha(INK, glint)
    setLevel(s.ringMat, (s.level / HALO.rim) * HALO.contact)
  }

  private build(key: HaloKey, shell: HaloShell): HaloSet {
    const root = global.scene.createSceneObject("Halo_" + key)
    root.setParent(this.root)
    const mat = this.haloMat.clone()
    let y0 = Infinity
    let y1 = -Infinity
    let lo = new vec3(Infinity, Infinity, Infinity)
    let hi = new vec3(-Infinity, -Infinity, -Infinity)
    let tris = 0
    shell.pieces.forEach((p, i) => {
      const {so} = spawnMesh(root, "HaloShell" + i, p.mesh, this.haloMat, undefined, mat)
      const tr = so.getTransform()
      tr.setWorldPosition(p.position)
      tr.setWorldRotation(p.rotation)
      tr.setWorldScale(p.scale)
      tris += p.tris
      for (const c of corners(p)) {
        y0 = Math.min(y0, c.y)
        y1 = Math.max(y1, c.y)
        lo = new vec3(Math.min(lo.x, c.x), Math.min(lo.y, c.y), Math.min(lo.z, c.z))
        hi = new vec3(Math.max(hi.x, c.x), Math.max(hi.y, c.y), Math.max(hi.z, c.z))
      }
    })
    const center = lo.add(hi).uniformScale(0.5)
    mat.mainPass.haloCenter = packed(center.x, center.y, center.z, HALO.lean)

    // The ring lies flat on the surface: its outline is drawn in XY and turned down onto XZ.
    const f = shell.footprint
    const k = new MeshKit()
    // Its brightest band sits just outside the object, where it can be seen, and tails off softly.
    softOutline(k, roundedOutline(f.halfX, f.halfZ, f.corner), [-0.5 * f.soft, 0.3 * f.soft, 1.2 * f.soft, 2.4 * f.soft], [NO_LIGHT, lit(INK, 1), lit(INK, 0.5), NO_LIGHT])
    const ringMat = this.glowMat.clone()
    const ring = spawnMesh(root, "HaloRing", k.build(), this.glowMat, undefined, ringMat)
    const rt = ring.so.getTransform()
    rt.setWorldPosition(f.center.add(new vec3(0, HALO.ringLift, 0)))
    rt.setWorldRotation(f.yaw.multiply(quat.angleAxis(-Math.PI / 2, vec3.right())))
    tris += k.triangleCount
    setLevel(ringMat, 0)
    root.enabled = false
    print(`Cutaway: ${key} halo: ${shell.pieces.length} meshes, ${tris} triangles when it shows`)
    return {key, root, power: shell.power, mat, ringMat, y0, y1, center, level: 0, lastTarget: 0, glintT: -1, glints: 0, tris}
  }
}

function pieceOf(rmv: RenderMeshVisual, tris: number): ShellPiece {
  const tr = rmv.getSceneObject().getTransform()
  return {mesh: rmv.mesh, position: tr.getWorldPosition(), rotation: tr.getWorldRotation(), scale: tr.getWorldScale(), tris}
}

/** The record player's shell: the deck and its dust cover, posed on the real spot. Its meshes outlive the geometry-only model they came from. */
export function recordPlayerShell(opts: {parent: SceneObject; shellMat: Material; glowMat: Material; layer: LayerSet; origin: vec3}): HaloShell {
  const model = new RecordPlayerModel({parent: opts.parent, shellMat: opts.shellMat, glowMat: opts.glowMat, layer: opts.layer, shellOnly: true})
  const tr = model.root.getTransform()
  tr.setWorldPosition(opts.origin)
  tr.setWorldRotation(quat.quatIdentity())
  tr.setWorldScale(vec3.one())
  const picks = model.meshList().filter((m) => !m.accent && (m.part === "RpPlinth" || m.part === "RpFeet" || m.part === "RpDustCover"))
  const pieces = picks.map((m) => pieceOf(m.rmv, m.tris))
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  let y0 = Infinity
  pieces.forEach((p, i) => {
    if (picks[i].part === "RpDustCover") return
    for (const c of corners(p)) {
      x0 = Math.min(x0, c.x)
      x1 = Math.max(x1, c.x)
      z0 = Math.min(z0, c.z)
      z1 = Math.max(z1, c.z)
      y0 = Math.min(y0, c.y)
    }
  })
  model.destroy()
  return {
    pieces,
    footprint: {center: new vec3((x0 + x1) / 2, y0, (z0 + z1) / 2), yaw: quat.quatIdentity(), halfX: (x1 - x0) / 2, halfZ: (z1 - z0) / 2, corner: 2, soft: 3},
    power: HALO.power
  }
}

/** The lamp's shell: the whole lamp's outer surface, without the cord on the floor. */
export function lampShell(opts: {parent: SceneObject; shellMat: Material; paperMat: Material | null; steelMat: Material | null; layer: LayerSet; origin: vec3}): HaloShell {
  const model = new LampModel({parent: opts.parent, shellMat: opts.shellMat, paperMat: opts.paperMat, steelMat: opts.steelMat, layer: opts.layer, shellOnly: true})
  const tr = model.root.getTransform()
  tr.setWorldPosition(opts.origin)
  tr.setWorldRotation(quat.quatIdentity())
  tr.setWorldScale(vec3.one())
  // What makes the lamp's outline: nothing under the paper can reach the silhouette.
  const outline = ["LampBaseMesh", "LampCollarMesh", "LampStemMesh", "LampStemNipple", "LampBottomRingMesh", "LampTopRingMesh", "LampPaperOuterA", "LampPaperOuterB"]
  const pieces = model
    .meshList()
    .filter((m) => outline.indexOf(m.rmv.getSceneObject().name) >= 0)
    .map((m) => pieceOf(m.rmv, m.tris))
  model.destroy()
  const r = ROOM_LAMP.baseDiameter / 2
  return {pieces, footprint: {center: opts.origin, yaw: quat.quatIdentity(), halfX: r, halfZ: r, corner: r, soft: 4}, power: HALO.powerRound}
}

/** The camera's shell: the body only, since the real lens sits in its bag. */
export function cameraShell(mesh: RenderMesh, pose: {position: vec3; rotation: quat}): HaloShell {
  const piece: ShellPiece = {mesh, position: pose.position, rotation: pose.rotation, scale: vec3.one(), tris: mesh.extractIndices().length / 3}
  const a = mesh.aabbMin
  const b = mesh.aabbMax
  const center = pose.position.add(pose.rotation.multiplyVec3(new vec3((a.x + b.x) / 2, a.y, (a.z + b.z) / 2)))
  return {pieces: [piece], footprint: {center, yaw: pose.rotation, halfX: (b.x - a.x) / 2, halfZ: (b.z - a.z) / 2, corner: 1, soft: 1.6}, power: HALO.power}
}
