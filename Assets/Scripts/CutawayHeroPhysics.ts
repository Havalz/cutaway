/**
 * Camera hero, pass 2: real physics for the replica on the table (devpost/camera-hero-pass2.md §2–4).
 *
 * The physics lives in its own world (a WorldComponent): the root world has Lens Studio's infinite
 * "ground is zero" floor at y = 0, well above the coffee table, and custom worlds do not inherit it.
 * In that world: a static cylinder for the table top (from the surface found by hit test or the
 * fallback) and a proxy body for the replica, a compound of a box (the body) and a cylinder (the
 * lens), fitted to the imported model at 3x. The proxy is kinematic (dynamic = false) during the
 * flight, while grabbed and while hovering, and dynamic only while it drops and settles.
 *
 * The replica's visual follows the proxy. Geometry below is replica-local at 1x (cm): pivot at the
 * lens mount, lens along +Z, Y up.
 */
import {TableSurface} from "./CutawayHeroSurface"

export const HERO_SCALE = 3

/** The imported body mesh's bounds (replica-local, 1x). */
export const BODY_BOX_CENTER = new vec3(-1.36, 1.135, -3.7)
export const BODY_BOX_SIZE = new vec3(14, 10.83, 7.64)
/** The lens barrel: a cylinder along +Z from the mount. */
export const LENS_RADIUS = 3.65
export const LENS_LENGTH = 9.95
export const LENS_Z0 = 0
/** Underside of the body (the lowest point of the assembled model). */
export const BODY_MIN_Y = BODY_BOX_CENTER.y - BODY_BOX_SIZE.y / 2

const BX0 = BODY_BOX_CENTER.x - BODY_BOX_SIZE.x / 2
const BX1 = BODY_BOX_CENTER.x + BODY_BOX_SIZE.x / 2
const BZ0 = BODY_BOX_CENTER.z - BODY_BOX_SIZE.z / 2
const BZ1 = BODY_BOX_CENTER.z + BODY_BOX_SIZE.z / 2
const LZ1 = LENS_Z0 + LENS_LENGTH

/**
 * The footprint: the replica's outline seen from above (body rectangle plus the lens in front of
 * it), replica-local (x, z) at 1x, counter-clockwise from above.
 */
export const FOOTPRINT: vec2[] = [
  new vec2(BX0, BZ0),
  new vec2(BX0, BZ1),
  new vec2(-LENS_RADIUS, BZ1),
  new vec2(-LENS_RADIUS, LZ1),
  new vec2(LENS_RADIUS, LZ1),
  new vec2(LENS_RADIUS, BZ1),
  new vec2(BX1, BZ1),
  new vec2(BX1, BZ0)
]
/** Footprint centre: the centre of its bounding rectangle (replica-local x, z at 1x). */
export const FOOT_CENTER = new vec2((BX0 + BX1) / 2, (BZ0 + LZ1) / 2)
/** Footprint size at 3x (cm): across the lens axis, along it. */
export const FOOT_SIZE = new vec2((BX1 - BX0) * HERO_SCALE, (LZ1 - BZ0) * HERO_SCALE)

/** World offset of footprint point `p` (replica-local x, z at 1x) from the footprint centre, for rotation `rot`. */
export function footOffset(p: vec2, rot: quat): vec3 {
  const v = rot.multiplyVec3(new vec3((p.x - FOOT_CENTER.x) * HERO_SCALE, 0, (p.y - FOOT_CENTER.y) * HERO_SCALE))
  return new vec3(v.x, 0, v.z)
}

/**
 * Largest distance the footprint centre can be from the table centre, in the flat direction `u`,
 * with every footprint point still within `radius`.
 */
export function maxFootDistance(u: vec3, rot: quat, radius: number): number {
  let best = 1e9
  for (const p of FOOTPRINT) {
    const r = footOffset(p, rot)
    const ur = u.x * r.x + u.z * r.z
    const disc = ur * ur - (r.x * r.x + r.z * r.z) + radius * radius
    if (disc < 0) return 0
    best = Math.min(best, -ur + Math.sqrt(disc))
  }
  return Math.max(0, best)
}

/** How far the farthest footprint point is from `center` (flat). */
export function footReach(foot: vec3, rot: quat, center: vec3): number {
  let m = 0
  for (const p of FOOTPRINT) {
    const q = foot.add(footOffset(p, rot))
    m = Math.max(m, new vec3(q.x - center.x, 0, q.z - center.z).length)
  }
  return m
}

/** Sample points on the replica's hull (replica-local, 1x): the body box corners and the lens rim. */
export const HULL: vec3[] = (() => {
  const pts: vec3[] = []
  for (const x of [BX0, BX1]) for (const y of [BODY_MIN_Y, BODY_BOX_CENTER.y + BODY_BOX_SIZE.y / 2]) for (const z of [BZ0, BZ1]) pts.push(new vec3(x, y, z))
  for (const z of [LENS_Z0, LZ1])
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      pts.push(new vec3(Math.cos(a) * LENS_RADIUS, Math.sin(a) * LENS_RADIUS, z))
    }
  return pts
})()

/** Lowest world Y of the replica's hull for a replica world transform. */
export function hullLowestY(m: mat4): number {
  let y = 1e9
  for (const p of HULL) y = Math.min(y, m.multiplyPoint(p).y)
  return y
}

/** Matter used when none is wired: Lens Studio has no runtime constructor for it. */
export interface HeroPhysicsOptions {
  matter: Matter | null
  log: (s: string) => void
}

/**
 * The physics world for the stage: the table top and the replica's proxy body.
 * `setReplicaPose` / `replicaPose` speak in the replica pivot's world pose (scale 3).
 */
export class HeroPhysics {
  readonly so: SceneObject
  private world: WorldComponent
  private settings: Physics.WorldSettingsAsset
  private tableSo: SceneObject
  private tableCol: ColliderComponent
  private proxySo: SceneObject
  private body: BodyComponent
  private lensCol: ColliderComponent
  private contactCb: ((p: vec3, impulse: number) => void) | null = null
  /** Proxy origin in replica-local cm at 3x (the body box centre). */
  private static readonly PROXY_OFFSET = BODY_BOX_CENTER.uniformScale(HERO_SCALE)

  constructor(parent: SceneObject, surface: TableSurface, private opts: HeroPhysicsOptions) {
    this.so = global.scene.createSceneObject("HeroPhysics")
    this.so.setParent(parent)
    this.so.getTransform().setWorldPosition(vec3.zero())
    this.so.getTransform().setWorldRotation(quat.quatIdentity())
    this.so.getTransform().setWorldScale(vec3.one())
    this.world = this.so.createComponent("Physics.WorldComponent") as WorldComponent
    this.settings = Physics.WorldSettingsAsset.create()
    this.settings.gravity = new vec3(0, -980, 0)
    // 240 Hz (the maximum): at ~2 m/s on contact, each step sinks the body less than 1 cm into the
    // table before the contact resolves; the default 60 Hz would sink it 3 cm and bounce.
    this.settings.simulationRate = 240
    if (opts.matter) this.settings.defaultMatter = opts.matter
    this.world.worldSettings = this.settings

    // Table top: a static cylinder whose top face is the surface.
    this.tableSo = global.scene.createSceneObject("HeroTableTop")
    this.tableSo.setParent(this.so)
    this.tableCol = this.tableSo.createComponent("Physics.ColliderComponent") as ColliderComponent
    if (opts.matter) this.tableCol.matter = opts.matter
    this.setSurface(surface)

    // Replica proxy: box (body) + child cylinder (lens), one rigid compound when dynamic.
    this.proxySo = global.scene.createSceneObject("HeroProxy")
    this.proxySo.setParent(this.so)
    this.body = this.proxySo.createComponent("Physics.BodyComponent") as BodyComponent
    this.body.dynamic = false
    const box = Shape.createBoxShape()
    box.size = BODY_BOX_SIZE.uniformScale(HERO_SCALE)
    this.body.shape = box
    this.body.mass = 1.2
    if (opts.matter) this.body.matter = opts.matter
    const lensSo = global.scene.createSceneObject("HeroProxyLens")
    lensSo.setParent(this.proxySo)
    lensSo.getTransform().setLocalPosition(new vec3(0, 0, LENS_Z0 + LENS_LENGTH / 2).sub(BODY_BOX_CENTER).uniformScale(HERO_SCALE))
    this.lensCol = lensSo.createComponent("Physics.ColliderComponent") as ColliderComponent
    const cyl = Shape.createCylinderShape()
    cyl.axis = Axis.Z
    cyl.radius = LENS_RADIUS * HERO_SCALE
    cyl.length = LENS_LENGTH * HERO_SCALE
    this.lensCol.shape = cyl
    if (opts.matter) this.lensCol.matter = opts.matter
    this.body.onCollisionEnter.add((e) => {
      const c = e.collision
      if (!this.body.dynamic || !c || c.contactCount === 0) return
      let p = vec3.zero()
      let imp = 0
      for (const k of c.contacts) {
        p = p.add(k.position)
        imp += k.impulse
      }
      p = p.uniformScale(1 / c.contacts.length)
      if (this.contactCb) this.contactCb(p, imp)
    })
  }

  /** Rebuild the table collider for a newly found surface. */
  setSurface(s: TableSurface): void {
    const cyl = Shape.createCylinderShape()
    cyl.axis = Axis.Y
    cyl.radius = s.safeRadius
    cyl.length = 20
    this.tableCol.shape = cyl
    this.tableSo.getTransform().setWorldPosition(new vec3(s.center.x, s.height - 10, s.center.z))
  }

  onContact(cb: (p: vec3, impulse: number) => void): void {
    this.contactCb = cb
  }

  get isDynamic(): boolean {
    return this.body.dynamic
  }

  /** Kinematic: place the proxy for a replica pivot pose. */
  setReplicaPose(pos: vec3, rot: quat): void {
    const tr = this.proxySo.getTransform()
    tr.setWorldPosition(pos.add(rot.multiplyVec3(HeroPhysics.PROXY_OFFSET)))
    tr.setWorldRotation(rot)
  }

  /** The replica pivot pose for the proxy's current pose. */
  replicaPose(): {pos: vec3; rot: quat} {
    const tr = this.proxySo.getTransform()
    const rot = tr.getWorldRotation()
    return {pos: tr.getWorldPosition().sub(rot.multiplyVec3(HeroPhysics.PROXY_OFFSET)), rot}
  }

  /** Let go: the proxy falls under gravity from where it is, at rest. */
  drop(): void {
    this.body.dynamic = true
    this.body.damping = 0
    this.body.angularDamping = 0.2
    this.body.clearMotion()
    this.body.velocity = vec3.zero()
    this.body.angularVelocity = vec3.zero()
  }

  /** Once it has touched down: soak up the remaining motion so it is still within 0.3 s. */
  settle(): void {
    this.body.damping = 0.4
    this.body.angularDamping = 0.95
  }

  /** Kinematic again (grabbed, hovering, flying, or at rest). */
  freeze(): void {
    if (this.body.dynamic) this.body.clearMotion()
    this.body.dynamic = false
  }

  velocity(): vec3 {
    return this.body.dynamic ? this.body.velocity : vec3.zero()
  }

  angularSpeed(): number {
    return this.body.dynamic ? this.body.angularVelocity.length : 0
  }

  destroy(): void {
    this.so.destroy()
  }
}
