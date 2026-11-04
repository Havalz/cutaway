/**
 * Record player hero: real physics for the copy on the table (recordplayer-hero.md, Phase B; the
 * rules are camera-hero-pass2.md §2–4).
 *
 * Its own physics world (a WorldComponent: the root world has Lens Studio's infinite floor at
 * y = 0, well above the coffee table, and custom worlds do not inherit it). In it: a static cylinder
 * for the table top and a proxy body for the deck, a box from the feet's soles to the top plate.
 * The proxy is kinematic during the flight, while grabbed and while hovering, and dynamic only while
 * it drops and settles. The copy's visual follows the proxy.
 *
 * Geometry is the model's own (CutawayRecordPlayerModel, cm at 1x: origin on the shelf at the
 * footprint centre, +Y up); the landed scale is a runtime value (the largest that fits the table).
 */
import {TableSurface} from "./CutawayHeroSurface"

export interface RpPhysicsOptions {
  matter: Matter | null
  /** Proxy box (model space at 1x): centre and size. */
  boxCenter: vec3
  boxSize: vec3
  scale: number
}

export class RpPhysics {
  readonly so: SceneObject
  private world: WorldComponent
  private settings: Physics.WorldSettingsAsset
  private tableSo: SceneObject
  private tableCol: ColliderComponent
  private proxySo: SceneObject
  private body: BodyComponent
  private offset: vec3
  private contactCb: ((p: vec3, impulse: number) => void) | null = null

  constructor(parent: SceneObject, surface: TableSurface, opts: RpPhysicsOptions) {
    this.so = global.scene.createSceneObject("RpPhysics")
    this.so.setParent(parent)
    const tr = this.so.getTransform()
    tr.setWorldPosition(vec3.zero())
    tr.setWorldRotation(quat.quatIdentity())
    tr.setWorldScale(vec3.one())
    this.world = this.so.createComponent("Physics.WorldComponent") as WorldComponent
    this.settings = Physics.WorldSettingsAsset.create()
    this.settings.gravity = new vec3(0, -980, 0)
    // 240 Hz (the maximum), as for the camera: each step sinks the body well under 1 cm into the
    // table before the contact resolves, so it lands without a bounce.
    this.settings.simulationRate = 240
    if (opts.matter) this.settings.defaultMatter = opts.matter
    this.world.worldSettings = this.settings

    this.tableSo = global.scene.createSceneObject("RpTableTop")
    this.tableSo.setParent(this.so)
    this.tableCol = this.tableSo.createComponent("Physics.ColliderComponent") as ColliderComponent
    if (opts.matter) this.tableCol.matter = opts.matter
    this.setSurface(surface)

    this.offset = opts.boxCenter.uniformScale(opts.scale)
    this.proxySo = global.scene.createSceneObject("RpProxy")
    this.proxySo.setParent(this.so)
    this.body = this.proxySo.createComponent("Physics.BodyComponent") as BodyComponent
    this.body.dynamic = false
    const box = Shape.createBoxShape()
    box.size = opts.boxSize.uniformScale(opts.scale)
    this.body.shape = box
    this.body.mass = 4
    if (opts.matter) this.body.matter = opts.matter
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

  /** Kinematic: place the proxy for a copy pivot pose (model origin, world). */
  setPose(pos: vec3, rot: quat): void {
    const tr = this.proxySo.getTransform()
    tr.setWorldPosition(pos.add(rot.multiplyVec3(this.offset)))
    tr.setWorldRotation(rot)
  }

  /** The copy's pivot pose for the proxy's current pose. */
  pose(): {pos: vec3; rot: quat} {
    const tr = this.proxySo.getTransform()
    const rot = tr.getWorldRotation()
    return {pos: tr.getWorldPosition().sub(rot.multiplyVec3(this.offset)), rot}
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
