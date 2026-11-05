/**
 * Lamp hero: real physics for the copy on the table (lamp-hero.md, Phase B), a copy of the record
 * player's (CutawayRpPhysics, not touched; the rules are camera-hero-pass2.md §2-4).
 *
 * Its own physics world (the root world has Lens Studio's infinite floor at y = 0, above the coffee
 * table): a static cylinder for the table top and a proxy body for the lamp. The proxy is only the
 * weighted base, a low box as wide as the base disc: a tall, slim lamp with its mass in its base lands
 * flat and stands, and the shade, stem and cord follow it. Kinematic during the flight, while grabbed
 * and while hovering; dynamic only while it drops and settles. The copy's visual follows the proxy.
 *
 * Geometry is the model's own (CutawayLampModel, cm at 1x: origin on the floor at the base's centre,
 * +Y up), at the landed scale.
 */
import {TableSurface} from "./CutawayHeroSurface"

export interface LampPhysicsOptions {
  matter: Matter | null
  /** Proxy box (model space at 1x): centre and size. */
  boxCenter: vec3
  boxSize: vec3
  scale: number
}

export class LampPhysics {
  readonly so: SceneObject
  private world: WorldComponent
  private settings: Physics.WorldSettingsAsset
  private tableSo: SceneObject
  private tableCol: ColliderComponent
  private proxySo: SceneObject
  private body: BodyComponent
  private offset: vec3
  private contactCb: ((p: vec3, impulse: number) => void) | null = null

  constructor(parent: SceneObject, surface: TableSurface, opts: LampPhysicsOptions) {
    this.so = global.scene.createSceneObject("LampPhysics")
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

    this.tableSo = global.scene.createSceneObject("LampTableTop")
    this.tableSo.setParent(this.so)
    this.tableCol = this.tableSo.createComponent("Physics.ColliderComponent") as ColliderComponent
    if (opts.matter) this.tableCol.matter = opts.matter
    this.setSurface(surface)

    this.offset = opts.boxCenter.uniformScale(opts.scale)
    this.proxySo = global.scene.createSceneObject("LampProxy")
    this.proxySo.setParent(this.so)
    this.body = this.proxySo.createComponent("Physics.BodyComponent") as BodyComponent
    this.body.dynamic = false
    const box = Shape.createBoxShape()
    box.size = opts.boxSize.uniformScale(opts.scale)
    this.body.shape = box
    this.body.mass = 4
    if (opts.matter) this.body.matter = opts.matter
    // The engine reports a contact (with no impulse) a step before the box actually reaches the
    // table, about 1 cm above it: only a contact that pushes back counts as touching down.
    const onHit = (c: Collision) => {
      if (!this.body.dynamic || !c || c.contactCount === 0) return
      let p = vec3.zero()
      let imp = 0
      for (const k of c.contacts) {
        p = p.add(k.position)
        imp += k.impulse
      }
      if (imp <= 1e-4) return
      p = p.uniformScale(1 / c.contacts.length)
      if (this.contactCb) this.contactCb(p, imp)
    }
    this.body.onCollisionEnter.add((e) => onHit(e.collision))
    this.body.onCollisionStay.add((e) => onHit(e.collision))
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
