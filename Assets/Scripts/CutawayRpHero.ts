/**
 * Record player hero stage ("Bring it closer"), see devpost/recordplayer-hero.md (Phase B).
 *
 * A rim-only copy of the code-built deck (CutawayRecordPlayerModel) peels off the real record
 * player, rises and flies to the coffee table on the hero flight arc, growing to the largest scale
 * that fits the table (up to 2x). It drops the last 20 cm under physics, settles, and fills in. The
 * tonearm side faces the user. There the user moves and turns it, drops the needle, and takes it
 * apart. "Put it back" flies it home; Reset clears it from any state.
 *
 * Built on the shared stage helpers (CutawayStageKit: flight arc, table surface, hover disc,
 * contact glow) plus its own code. The camera hero is not touched: one copy on the table at a time
 * is kept by CutawayMain, which sends the camera home through its public reset path.
 *
 * Units: the copy is the model's own space (cm at 1x: origin on the shelf at the footprint centre,
 * +X toward the tonearm, +Y up, +Z toward the front), scaled by `scale` on the table.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {setFade, spawnMesh, TrailRibbon} from "./CutawayGeometry"
import {TableSurface} from "./CutawayHeroSurface"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {RecordPlayerModel, RP_GEOM} from "./CutawayRecordPlayerModel"
import {RpPhysics} from "./CutawayRpPhysics"
import {RpRail} from "./CutawayRpRail"
import {RpTone} from "./CutawayRpTone"
import {arcControl, bezier, clampFoot, clearOfHead, contactGlowKit, DEG, fitScale, flatDir, footprint, Footprint, footprintOutlineXY, footRadius, footReach, hoverDiscKit, hullLowestY, placeGlowAndDisc, unclampFoot} from "./CutawayStageKit"
import {ENERGY, ink} from "./CutawayStyle"
import {clamp01, easeInOutCubic, easeOutCubic} from "./CutawayTween"

export type RpSound = "lift" | "flight" | "land" | "tap" | "part" | "crackle"
export type RpState = "none" | "launch" | "landed" | "returning"
export type RpPose = "fly" | "drop" | "rest" | "rise" | "hover" | "descend" | "lift"

export interface RpContext {
  parent: SceneObject
  glowMat: Material
  /** RecordPlayerShell: the model's solid look. */
  shellMat: Material
  labels: CutawayLabelsUI
  rail: RpRail
  tone: RpTone
  camPos: () => vec3
  camera: Camera | null
  /** The real deck: the model origin (footprint centre on the shelf) and its rotation. */
  realOrigin: () => vec3
  realRotation: quat
  /** The real speaker (speakerMarker). */
  speaker: () => vec3
  surface: () => TableSurface
  survey: (done: (s: TableSurface) => void) => void
  matter: Matter | null
  sound: (s: RpSound, p: vec3) => void
  moveSound: (s: RpSound, p: vec3) => void
  log: (p: string) => void
  caption: (text: string | null, topCenter?: vec3) => void
}

// =====================================================================================
// Geometry (model space, cm at 1x)
// =====================================================================================

const G = RP_GEOM

/** The plinth's outline seen from above: what sits on the table. */
const FOOT: Footprint = (() => {
  const pts: vec2[] = []
  const hw = G.plinthHalf.x
  const hd = G.plinthHalf.y
  const r = G.plinthCorner
  const corners = [new vec2(hw - r, hd - r), new vec2(-(hw - r), hd - r), new vec2(-(hw - r), -(hd - r)), new vec2(hw - r, -(hd - r))]
  corners.forEach((c, i) => {
    for (let s = 0; s <= 4; s++) {
      const a = ((i + s / 4) * Math.PI) / 2
      pts.push(new vec2(c.x + r * Math.cos(a), c.y + r * Math.sin(a)))
    }
  })
  return footprint(pts)
})()

/** Hull points: the feet's soles, the base band's lower corners and the top plate's corners. */
const HULL: vec3[] = (() => {
  const pts: vec3[] = []
  for (const f of G.feet)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      pts.push(new vec3(f.x + G.footSole * Math.cos(a), 0, f.y + G.footSole * Math.sin(a)))
    }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      pts.push(new vec3(sx * (G.plinthHalf.x - 0.15), 0.9, sz * (G.plinthHalf.y - 0.15)))
      pts.push(new vec3(sx * G.plinthHalf.x, G.topY, sz * G.plinthHalf.y))
    }
  return pts
})()

/** Physics proxy: a box from the soles to the top plate. */
const BOX_CENTER = new vec3(0, G.topY / 2, 0)
const BOX_SIZE = new vec3(2 * G.plinthHalf.x, G.topY, 2 * G.plinthHalf.y)
/** The open dust cover's panel (model space): centre and size (across, thickness, height). */
const COVER_CENTER = (() => {
  const a = G.coverOpenDeg * DEG
  const y = 2.85
  const z = G.coverDepth / 2
  return new vec3(0, G.hinge.y + y * Math.cos(a) - z * Math.sin(a), G.hinge.z + y * Math.sin(a) + z * Math.cos(a))
})()
/** The copy's visual centre (thread, trail, rail and captions attach around it). */
const CENTER = new vec3(0, 6, 0)

const MAX_SCALE = 2
const EDGE_GAP = 3

const DROP_CM = 20
const HOLD_CM = 1.5
const HOVER_CM = 12
const PUTBACK_LIFT_CM = 3
const BOB_CM = 0.2
const BOB_PERIOD = 4
const RISE_DUR = 0.5
const DESCEND_DUR = 0.45
const HOLD_DUR = 0.18
const STILL_SPEED = 0.5
const STILL_SPIN = 0.02

// Launch: rise off the real deck, fly 1.7 s, fill in over 400 ms once down.
const T_RISE = 0.7
const T_FLY0 = 0.75
const T_FLY1 = 2.45
const T_FILL = 0.4
// Put it back: the arm and the parts come home first, then it lifts, flies and melts in.
const RET_READY = 0.6
const RET_FLY0 = RET_READY + 0.25
const RET_FLY1 = RET_FLY0 + 1.6
const RET_END = RET_FLY1 + 0.7

const LIGHT = ENERGY.light

/** Which look group a part belongs to (its nearest named ancestor in this list). */
const GROUPS: {[part: string]: string} = {
  RpDustCover: "cover",
  RpRecord: "record",
  RpPlatter: "platter",
  RpTonearm: "arm",
  RpCounterweight: "counterweight",
  RpCartridge: "cartridge",
  RpStylus: "stylus",
  RpCartridgeMagnet: "magnet",
  RpCartridgeCoils: "coils",
  RpInterior: "interior",
  RpMotor: "motor",
  RpBelt: "belt",
  RpSubPlatter: "subPlatter",
  RpSignalWiresArm: "wires",
  RpSignalWires: "wires"
}

interface Look {
  rmv: RenderMeshVisual
  mat: Material
  base: vec4
  emis: number
  rim: number
  accent: boolean
  group: string
  depthWrite: boolean
  twoSided: boolean
}

/** A look group's state: solid fill 0..1, rim boost, overall fade. */
interface GroupLook {
  fill: number
  rim: number
  fade: number
}

export interface RpInfo {
  state: RpState
  pose: RpPose
  scale: number
  position: vec3
  up: vec3
  lowestY: number
  tableY: number
  foot: vec3
  tableCenter: vec3
  tableRadius: number
  footReach: number
  speed: number
  held: boolean
  discShown: boolean
  glowShown: boolean
  landSound: vec3 | null
  lastDrop: {bounce: number; settle: number; restGap: number; tiltDeg: number} | null
}

export class RecordPlayerHero {
  state: RpState = "none"
  /** Test hook: freeze the stage's timeline (for screenshots of one beat). */
  hold = false

  private root: SceneObject | null = null
  private model: RecordPlayerModel | null = null
  private replica: SceneObject
  private layer: LayerSet
  private layerMade = false
  private looks: Look[] = []
  private groupLook: {[g: string]: GroupLook} = {}

  private t = 0
  private scale = 1.5
  private shellFill = 0
  private shellRim = 0.9
  private globalFade = 1
  // Flight (world)
  private head0: vec3
  private pStart: vec3
  private rStart: quat
  private pMeet: vec3
  private pLand: vec3
  private ctrl: vec3
  private rLand: quat
  private yaw = 0
  private trail: TrailRibbon | null = null
  private trailPts: vec3[] = []
  private flags = {flight: false}
  private retFlags = {flight: false}
  private retFrom: {rot: quat; h: number} | null = null
  private retPos: vec3 | null = null
  // On the table
  private physics: RpPhysics | null = null
  private surf: TableSurface
  private pose: RpPose = "fly"
  private poseT = 0
  /** Footprint centre (world; y = table top) and the lowest point's height above the table top. */
  private foot = vec3.zero()
  private h = 0
  private h0 = 0
  private restGap = 0
  private holdK = 0
  private discK = 0
  private firstRest = true
  private drop = {t: 0, touched: false, touchT: -1, stillT: 0, bounce: 0, settle: -1}
  private lastDrop: {bounce: number; settle: number; restGap: number; tiltDeg: number} | null = null
  private lastPivot: vec3 | null = null
  private speed = 0
  private grabs: {slide: SceneObject; turn: SceneObject} | null = null
  private grab: {kind: "slide" | "turn"; p0: vec3; usePlane: boolean; foot0: vec3; yaw0: number; angPrev: number; turned: number; accum: vec3} | null = null
  private contactGlow: SceneObject | null = null
  private contactGlowMat: Material | null = null
  private disc: SceneObject | null = null
  private discMat: Material | null = null
  private discR = 30
  private lastLandPos: vec3 | null = null
  private launchedAt = -1
  private landedAt = -1
  private homeAt = -1

  constructor(private ctx: RpContext) {}

  // =====================================================================================
  // Public API
  // =====================================================================================

  get isOut(): boolean {
    return this.state !== "none"
  }

  /** "Bring it closer": build the copy on the real deck and start the launch. */
  launch(): void {
    if (this.state !== "none") return
    this.build()
    this.state = "launch"
    this.t = 0
    this.flags = {flight: false}
    this.retFlags = {flight: false}
    this.globalFade = 1
    this.trailPts = []
    this.lastLandPos = null
    this.launchedAt = getTime()
    this.landedAt = -1
    this.head0 = this.ctx.camPos()
    this.rStart = this.ctx.realRotation
    this.pStart = this.ctx.realOrigin()
    this.surf = this.ctx.surface()
    this.scale = fitScale(FOOT, this.surf.safeRadius, EDGE_GAP, MAX_SCALE)
    const table = this.surf.center
    // The tonearm side (+X) faces the user, so the arm is easy to reach.
    const toUser = flatDir(this.head0.sub(table))
    this.rLand = quat.lookAt(toUser.cross(vec3.up()), vec3.up())
    this.yaw = 0
    this.foot = new vec3(table.x, this.surf.height, table.z)
    this.pose = "fly"
    this.firstRest = true
    this.discK = 0
    this.holdK = 0
    this.grab = null
    this.lastDrop = null
    this.lastPivot = null
    this.speed = 0
    this.pMeet = clearOfHead(this.pStart.add(new vec3(0, 30, 0)), this.head0, 40, table.sub(this.head0))
    this.makePhysics()
    this.pLand = this.pivotFor(this.foot, 0, DROP_CM)
    this.ctrl = arcControl(this.pMeet, this.pLand, this.head0)
    this.ctx.sound("lift", this.realCenter())
    this.ctx.rail.setMode("none", true)
    this.ctx.log("rp:launch")
    print(`Cutaway: rp scale ${this.scale.toFixed(4)} (footprint reach ${footRadius(FOOT).toFixed(2)} cm at 1x, table radius ${this.surf.safeRadius.toFixed(2)} cm − ${EDGE_GAP} cm)`)
    this.applyLaunch()
    this.ctx.survey((s) => this.onSurface(s))
  }

  /** "Put it back": everything comes home, it lifts, flies home, shrinks and melts into the real deck. */
  putBack(): void {
    if (this.state !== "landed") return
    if (this.physics) {
      if (this.pose === "drop") this.toRest(true)
      this.physics.freeze()
    }
    this.grab = null
    this.pose = "lift"
    this.retFrom = {rot: this.replica.getTransform().getWorldRotation(), h: this.h}
    this.state = "returning"
    this.t = 0
    this.ctx.rail.setMode("none")
    this.ctx.caption(null)
    this.ctx.log("rp:putBack")
  }

  /** Reset: remove everything instantly, from any state. */
  clear(): void {
    if (this.root) this.root.destroy()
    this.root = null
    this.model = null
    this.state = "none"
    this.looks = []
    this.groupLook = {}
    this.trail = null
    this.physics = null
    this.grabs = null
    this.grab = null
    this.contactGlow = null
    this.disc = null
    this.pose = "fly"
    this.ctx.rail.setMode("none", true)
    this.ctx.caption(null)
  }

  update(dt: number): void {
    this.ctx.rail.update(dt)
    this.ctx.tone.update()
    if (this.state === "none") return
    if (this.hold) dt = 0
    this.t += dt
    switch (this.state) {
      case "launch":
        this.applyLaunch()
        if (this.t >= T_FLY1) this.endFlight()
        break
      case "landed":
        this.updateLanded(dt)
        break
      case "returning":
        this.updateReturn(dt)
        break
    }
    if ((this.state as RpState) === "none") return
    this.syncGrabs()
    this.updateGlowAndDisc()
    this.updateTrail()
    this.applyLooks()
    this.placeRail()
    const piv = this.replica.getTransform().getWorldPosition()
    if (this.lastPivot && dt > 0) this.speed = piv.distance(this.lastPivot) / dt
    this.lastPivot = piv
  }

  // ---------------- Test hooks / read-only state ----------------

  getReplica(): SceneObject | null {
    return this.state === "none" ? null : this.replica
  }

  getScale(): number {
    return this.scale
  }

  /** The footprint's farthest point from its centre at the chosen scale (the scale rule fits this inside the table radius minus 3 cm). */
  getFitReach(): number {
    return footRadius(FOOT) * this.scale
  }

  getInfo(): RpInfo {
    const live = this.state !== "none" && !!this.replica
    const tr = live ? this.replica.getTransform() : null
    const s = this.surf ?? this.ctx.surface()
    const foot = tr ? tr.getWorldTransform().multiplyPoint(new vec3(FOOT.center.x, 0, FOOT.center.y)) : vec3.zero()
    return {
      state: this.state,
      pose: this.pose,
      scale: tr ? tr.getWorldScale().x : 0,
      position: tr ? tr.getWorldPosition() : vec3.zero(),
      up: tr ? tr.up : vec3.up(),
      lowestY: tr ? this.lowestWorldY() : 0,
      tableY: s.height,
      foot,
      tableCenter: s.center,
      tableRadius: s.safeRadius,
      footReach: tr ? footReach(FOOT, foot, tr.getWorldRotation(), tr.getWorldScale().x, s.center) : 0,
      speed: this.speed,
      held: !!this.grab,
      discShown: !!this.disc && this.disc.enabled && this.discK > 0.95,
      glowShown: !!this.contactGlow && this.contactGlow.enabled,
      landSound: this.lastLandPos,
      lastDrop: this.lastDrop
    }
  }

  getSurface(): TableSurface {
    return this.surf ?? this.ctx.surface()
  }

  getTimes(): {launchedAt: number; landedAt: number; homeAt: number} {
    return {launchedAt: this.launchedAt, landedAt: this.landedAt, homeAt: this.homeAt}
  }

  getYawDeg(): number {
    return this.yaw / DEG
  }

  /** The direction the tonearm side (+X) faces, flat (world). */
  getArmSide(): vec3 {
    return this.state === "none" ? vec3.zero() : flatDir(this.replica.getTransform().getWorldRotation().multiplyVec3(new vec3(1, 0, 0)))
  }

  // =====================================================================================
  // Build
  // =====================================================================================

  private build(): void {
    this.clear()
    const root = global.scene.createSceneObject("RpStage")
    root.setParent(this.ctx.parent)
    const rtr = root.getTransform()
    rtr.setWorldPosition(vec3.zero())
    rtr.setWorldRotation(quat.quatIdentity())
    rtr.setWorldScale(vec3.one())
    this.root = root
    // One render layer for the stage's lifetime (the camera stage learnt this: a new unique layer per
    // launch is never released and the camera's layer set overflows).
    if (!this.layerMade) {
      this.layer = LayerSet.makeUnique()
      if (this.ctx.camera) this.ctx.camera.renderLayer = this.ctx.camera.renderLayer.union(this.layer)
      this.layerMade = true
    }
    this.model = new RecordPlayerModel({parent: root, shellMat: this.ctx.shellMat, glowMat: this.ctx.glowMat, layer: this.layer})
    this.replica = this.model.root
    this.replica.name = "RpReplica"
    this.buildLooks()
    this.buildGlowAndDisc()
  }

  private node(parent: SceneObject, name: string, localPos: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(localPos)
    return so
  }

  private glowMat(): Material {
    return this.ctx.glowMat.clone()
  }

  /** Every mesh gets its own material, so parts fill in, fade and turn to outlines on their own. */
  private buildLooks(): void {
    this.looks = []
    this.groupLook = {}
    for (const m of this.model.meshList()) {
      let group = "plinth"
      let p: SceneObject | null = m.rmv.getSceneObject()
      while (p) {
        if (GROUPS[p.name]) {
          group = GROUPS[p.name]
          break
        }
        p = p.getParent()
      }
      const mat = m.rmv.mainMaterial.clone()
      m.rmv.mainMaterial = mat
      const pass = mat.mainPass
      const look: Look = {rmv: m.rmv, mat, base: pass.baseColor, emis: 0, rim: 0, accent: m.accent, group, depthWrite: true, twoSided: false}
      if (!m.accent) {
        look.emis = pass.emissiveIntensity
        look.rim = pass.rimIntensity
        look.depthWrite = pass.depthWrite
        look.twoSided = pass.twoSided
      }
      this.looks.push(look)
      if (!this.groupLook[group]) this.groupLook[group] = {fill: 1, rim: 1, fade: 1}
    }
  }

  /** Apply the look: the shell's fill (rim-only in flight) times each group's own fill and fade. */
  private applyLooks(): void {
    const g0 = this.globalFade
    for (const l of this.looks) {
      const gl = this.groupLook[l.group]
      const fade = g0 * (gl ? gl.fade : 1)
      if (l.accent) {
        setFade(l.mat, fade)
        continue
      }
      const fill = this.shellFill * (gl ? gl.fill : 1)
      const pass = l.mat.mainPass
      const k = fill * fade
      pass.baseColor = new vec4(l.base.x * k, l.base.y * k, l.base.z * k, l.base.w)
      pass.emissiveIntensity = l.emis * k
      // Rim-only in flight (edges of light); a part turned to an outline keeps a thin rim.
      const rimOnly = this.shellRim
      const rim = fill >= 0.999 ? l.rim : rimOnly + (l.rim - rimOnly) * fill
      pass.rimIntensity = rim * fade * (gl ? gl.rim : 1)
      const solid = fill > 0.95 && fade > 0.95
      pass.depthWrite = l.depthWrite && solid
      pass.twoSided = l.twoSided && solid
    }
  }

  // =====================================================================================
  // Launch and land
  // =====================================================================================

  private makePhysics(): void {
    if (this.physics) this.physics.destroy()
    this.physics = new RpPhysics(this.root, this.surf, {matter: this.ctx.matter, boxCenter: BOX_CENTER, boxSize: BOX_SIZE, scale: this.scale})
    this.physics.onContact((p, imp) => this.onContact(p, imp))
  }

  /** A survey finished: aim the flight at the table it found (and its scale), rebuild the collider. */
  private onSurface(s: TableSurface): void {
    if (this.state === "none") return
    this.surf = s
    this.ctx.log("rp:surface:" + s.method)
    if (this.state === "launch") {
      const sc = fitScale(FOOT, s.safeRadius, EDGE_GAP, MAX_SCALE)
      if (Math.abs(sc - this.scale) > 1e-4) {
        this.scale = sc
        print(`Cutaway: rp scale ${sc.toFixed(4)} for the surveyed table (radius ${s.safeRadius.toFixed(2)} cm)`)
      }
      this.makePhysics()
      this.foot = new vec3(s.center.x, s.height, s.center.z)
      this.pLand = this.pivotFor(this.foot, 0, DROP_CM)
      this.ctrl = arcControl(this.pMeet, this.pLand, this.head0)
    } else {
      if (this.physics) this.physics.setSurface(s)
      if (this.pose === "rest" && !this.grab) {
        this.foot = this.clampFoot(this.foot, this.rot())
        this.startDrop()
      }
    }
  }

  private realCenter(): vec3 {
    return this.ctx.realOrigin().add(this.ctx.realRotation.multiplyVec3(CENTER))
  }

  private applyLaunch(): void {
    const t = this.t
    const tr = this.replica.getTransform()
    if (t < T_FLY0) {
      // The copy peels off the real deck and rises to the meeting point.
      const k = easeOutCubic(t / T_RISE)
      tr.setWorldPosition(vec3.lerp(this.pStart, this.pMeet, k))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
    } else {
      const u = easeInOutCubic((t - T_FLY0) / (T_FLY1 - T_FLY0))
      tr.setWorldPosition(bezier(this.pMeet, this.ctrl, this.pLand, u))
      tr.setWorldRotation(quat.slerp(this.rStart, this.rLand, u))
      tr.setWorldScale(vec3.one().uniformScale(1 + (this.scale - 1) * u))
      this.ctx.moveSound("flight", tr.getWorldPosition())
      if (!this.trail) this.trail = new TrailRibbon(this.root, "RpTrail", this.ctx.glowMat, 28, 5, ink(LIGHT, 0.9))
    }
    // The rim-only copy: edges of light until it lands.
    this.shellFill = 0
    this.shellRim = 0.9 * easeOutCubic(t / 0.25)
    if (t >= T_FLY0 && !this.flags.flight) {
      this.flags.flight = true
      this.ctx.sound("flight", tr.getWorldPosition())
      this.ctx.log("rp:flight")
    }
  }

  /** The flight is over, 20 cm above the table centre: let go, and it drops onto the table. */
  private endFlight(): void {
    this.state = "landed"
    this.t = 0
    this.h = DROP_CM
    this.applyPose()
    this.buildGrabs()
    this.startDrop()
  }

  /** Rotation for a yaw (only ever about the vertical axis). */
  private rot(yaw: number = this.yaw): quat {
    return quat.angleAxis(yaw, vec3.up()).multiply(this.rLand)
  }

  /** Copy pivot for footprint centre `foot` (x, z), `yaw`, and its lowest point `h` cm above the table top. */
  private pivotFor(foot: vec3, yaw: number, h: number): vec3 {
    const off = this.rot(yaw).multiplyVec3(new vec3(FOOT.center.x * this.scale, 0, FOOT.center.y * this.scale))
    return new vec3(foot.x, this.surf.height + h, foot.z).sub(off)
  }

  /** Kinematic: place the copy (and its physics proxy) from foot, yaw and height. */
  private applyPose(): void {
    const tr = this.replica.getTransform()
    const r = this.rot()
    const p = this.pivotFor(this.foot, this.yaw, this.h)
    tr.setWorldPosition(p)
    tr.setWorldRotation(r)
    tr.setWorldScale(vec3.one().uniformScale(this.scale))
    if (this.physics) this.physics.setPose(p, r)
  }

  /** Dynamic from here: it falls under gravity, touches the table and settles. */
  private startDrop(): void {
    this.pose = "drop"
    this.poseT = 0
    this.drop = {t: 0, touched: false, touchT: -1, stillT: 0, bounce: 0, settle: -1}
    this.applyPose()
    this.holdK = 0
    this.physics.drop()
    this.ctx.log("rp:drop")
  }

  /** First contact: the soft tap (and, on the first landing, the landing tone) from the contact point. */
  private onContact(p: vec3, impulse: number): void {
    if (this.pose !== "drop" || this.drop.touched) return
    this.drop.touched = true
    this.drop.touchT = this.drop.t
    this.physics.settle()
    this.ctx.sound("tap", p)
    if (this.firstRest) {
      this.ctx.sound("land", p)
      this.lastLandPos = p
    }
    this.ctx.log("rp:touch")
    void impulse
  }

  private updateDrop(dt: number): void {
    const d = this.drop
    d.t += dt
    const pr = this.physics.pose()
    const tr = this.replica.getTransform()
    tr.setWorldPosition(pr.pos)
    tr.setWorldRotation(pr.rot)
    tr.setWorldScale(vec3.one().uniformScale(this.scale))
    const gap = this.lowestWorldY() - this.surf.height
    this.h = gap
    const v = this.physics.velocity().length
    if (!d.touched && d.t > 0.05 && gap < 0.05 && v < 5) this.onContact(new vec3(this.foot.x, this.surf.height, this.foot.z), 0)
    if (d.touched) {
      d.bounce = Math.max(d.bounce, gap)
      const still = v < STILL_SPEED && this.physics.angularSpeed() < STILL_SPIN
      if (!still) {
        d.stillT = 0
        d.settle = -1
      } else {
        if (d.settle < 0) d.settle = d.t - d.touchT
        d.stillT += dt
      }
      if (d.stillT >= 0.05) this.toRest(false)
    } else if (d.t > 1.5) {
      this.toRest(false)
    }
  }

  /**
   * At rest (or caught mid-settle by a grab): kinematic again, exactly where the physics left it,
   * keeping its yaw and footprint. A residual tilt is levelled out, and the gap to the table is
   * kept between 0 and 2 mm (it is logged as found).
   */
  private toRest(early: boolean): void {
    const pr = this.physics.pose()
    this.physics.freeze()
    const tr = this.replica.getTransform()
    tr.setWorldPosition(pr.pos)
    tr.setWorldRotation(pr.rot)
    tr.setWorldScale(vec3.one().uniformScale(this.scale))
    const gap = this.lowestWorldY() - this.surf.height
    const f = flatDir(pr.rot.multiplyVec3(vec3.forward()))
    const f0 = flatDir(this.rLand.multiplyVec3(vec3.forward()))
    const tiltDeg = Math.acos(Math.max(-1, Math.min(1, pr.rot.multiplyVec3(vec3.up()).y))) / DEG
    this.yaw = Math.atan2(f.x, f.z) - Math.atan2(f0.x, f0.z)
    const fw = pr.pos.add(pr.rot.multiplyVec3(new vec3(FOOT.center.x * this.scale, 0, FOOT.center.y * this.scale)))
    this.foot = new vec3(fw.x, this.surf.height, fw.z)
    this.restGap = Math.max(0, Math.min(0.2, gap))
    this.h = this.restGap
    this.pose = "rest"
    this.poseT = 0
    this.holdK = 0
    this.applyPose()
    this.lastPivot = this.replica.getTransform().getWorldPosition()
    this.speed = 0
    if (early) return
    const d = this.drop
    this.lastDrop = {bounce: d.bounce, settle: d.settle, restGap: gap, tiltDeg}
    print(`Cutaway: rp rest: gap ${(gap * 10).toFixed(2)} mm, tilt ${tiltDeg.toFixed(3)}°, bounce ${(d.bounce * 10).toFixed(2)} mm, still ${d.settle.toFixed(3)} s after contact, drop ${d.t.toFixed(3)} s`)
    this.ctx.log("rp:rest")
    if (this.firstRest) {
      this.firstRest = false
      this.landedAt = getTime()
      this.ctx.rail.setMode("rest")
      this.ctx.rail.setValue("apart", 0)
      this.ctx.log("rp:landed")
    }
  }

  /** Whether the stage wants to hover (the take-apart step). */
  private wantHover(): boolean {
    return false
  }

  /** How far the parts may separate this frame (0 until it hovers). */
  private apartAllowed(): boolean {
    return this.pose === "hover"
  }

  private startRise(): void {
    this.pose = "rise"
    this.poseT = 0
    this.h0 = this.h
    this.ctx.log("rp:rise")
  }

  /**
   * Every frame on the table: rest (lifted 1.5 cm while held), rise to hover for the take-apart,
   * hover with a slow bob, and once the parts are back together, come down and drop.
   */
  private updatePose(dt: number, partsHome: boolean): void {
    if (!this.physics) return
    const wantHover = this.wantHover()
    this.poseT += dt
    switch (this.pose) {
      case "drop":
        this.updateDrop(dt)
        break
      case "rest":
        if (this.grab) this.holdK = Math.min(1, this.holdK + dt / HOLD_DUR)
        this.h = this.restGap + HOLD_CM * easeInOutCubic(this.holdK)
        if (wantHover) this.startRise()
        this.applyPose()
        break
      case "rise":
        this.h = this.h0 + (HOVER_CM - this.h0) * easeOutCubic(this.poseT / RISE_DUR)
        if (this.poseT >= RISE_DUR) {
          this.pose = "hover"
          this.poseT = 0
          this.ctx.log("rp:hover")
        }
        this.applyPose()
        break
      case "hover":
        this.h = HOVER_CM + BOB_CM * Math.sin((2 * Math.PI * this.poseT) / BOB_PERIOD)
        if (!wantHover && partsHome) {
          this.pose = "descend"
          this.poseT = 0
          this.h0 = this.h
          this.ctx.log("rp:descend")
        }
        this.applyPose()
        break
      case "descend":
        if (wantHover) {
          this.startRise()
          this.applyPose()
          break
        }
        this.h = this.h0 + (HOLD_CM - this.h0) * easeInOutCubic(this.poseT / DESCEND_DUR)
        this.applyPose()
        if (this.poseT >= DESCEND_DUR) {
          if (this.grab) {
            this.pose = "rest"
            this.restGap = 0
            this.holdK = 1
          } else this.startDrop()
        }
        break
    }
    // The disc fades in as it rises and out as it comes down.
    const want = this.pose === "rise" || this.pose === "hover" ? 1 : 0
    const ds = dt / 0.35
    this.discK = Math.abs(want - this.discK) <= ds ? want : this.discK + Math.sign(want - this.discK) * ds
  }

  private updateLanded(dt: number): void {
    // Fill in from rim-only to the solid look over 400 ms.
    this.shellFill = easeOutCubic(this.t / T_FILL)
    this.shellRim = 0.9 + (0.3 - 0.9) * this.shellFill
    this.updatePose(dt, true)
  }

  // =====================================================================================
  // Grabs: slide it across the table (the plinth), turn it (the dust cover)
  // =====================================================================================

  /**
   * Grab handles live under the stage root (not the copy), so a drag never feeds back through the
   * copy's own motion. Their frame has local Z up, so SIK's drag plane is the table plane.
   */
  private buildGrabs(): void {
    const make = (name: string, kind: "slide" | "turn", size: vec3): SceneObject => {
      const so = this.node(this.root, name, vec3.zero())
      const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
      const box = Shape.createBoxShape()
      box.size = size
      col.shape = box
      col.debugDrawEnabled = false
      const inter = so.createComponent(Interactable.getTypeName()) as Interactable
      inter.enableInstantDrag = true
      inter.onDragStart.add((e) => this.onGrabStart(kind, e.interactor.planecastPoint))
      inter.onDragUpdate.add((e) => this.onGrabUpdate(e.interactor.planecastPoint, e.dragVector))
      inter.onDragEnd.add(() => this.onGrabEnd())
      return so
    }
    const S = this.scale
    // Box axes in the handle's frame: x across the deck, y along its front, z up.
    const slide = make("RpGrab", "slide", new vec3(BOX_SIZE.x * S + 1.5, BOX_SIZE.z * S + 1.5, BOX_SIZE.y * S + 1.5))
    const turn = make("RpTurnGrab", "turn", new vec3(2 * G.coverHalfW * S + 1.5, 5.7 * S + 2, G.coverDepth * S))
    this.grabs = {slide, turn}
    this.syncGrabs()
    this.ctx.log("rp:grabReady")
  }

  private canGrab(): boolean {
    return this.state === "landed" && this.pose !== "fly" && this.pose !== "lift"
  }

  private syncGrabs(): void {
    if (!this.grabs) return
    const on = this.canGrab()
    this.grabs.slide.enabled = on
    this.grabs.turn.enabled = on
    if (this.grab || !on) return
    const tr = this.replica.getTransform()
    const m = tr.getWorldTransform()
    const q = quat.lookAt(vec3.up(), flatDir(tr.getWorldRotation().multiplyVec3(vec3.forward())))
    const st = this.grabs.slide.getTransform()
    st.setWorldPosition(m.multiplyPoint(BOX_CENTER))
    st.setWorldRotation(q)
    const tt = this.grabs.turn.getTransform()
    tt.setWorldPosition(m.multiplyPoint(COVER_CENTER))
    tt.setWorldRotation(q)
  }

  private onGrabStart(kind: "slide" | "turn", p: vec3 | null): void {
    if (!this.canGrab() || this.grab || !this.physics) return
    if (this.pose === "drop") this.toRest(true)
    const handle = kind === "slide" ? this.grabs.slide : this.grabs.turn
    const p0 = p ?? handle.getTransform().getWorldPosition()
    const rel = p0.sub(this.foot)
    const ang = Math.atan2(rel.x, rel.z)
    this.grab = {kind, p0, usePlane: !!p, foot0: this.unclampFoot(this.foot, this.rot()), yaw0: this.yaw, angPrev: ang, turned: 0, accum: vec3.zero()}
    this.ctx.log("rp:grab")
  }

  private onGrabUpdate(p: vec3 | null, dv: vec3 | null): void {
    const g = this.grab
    if (!g) return
    let q = g.usePlane ? p : null
    if (!q) {
      g.accum = g.accum.add(dv ?? vec3.zero())
      q = g.p0.add(g.accum)
    }
    if (g.kind === "slide") {
      const d = q.sub(g.p0)
      this.foot = this.clampFoot(g.foot0.add(new vec3(d.x, 0, d.z)), this.rot())
    } else {
      // Swing it around the footprint centre: the yaw follows the hand's angle around it.
      const rel = q.sub(this.foot)
      if (Math.sqrt(rel.x * rel.x + rel.z * rel.z) < 2) return
      const ang = Math.atan2(rel.x, rel.z)
      let da = ang - g.angPrev
      while (da > Math.PI) da -= Math.PI * 2
      while (da < -Math.PI) da += Math.PI * 2
      g.angPrev = ang
      g.turned += da
      this.yaw = g.yaw0 + g.turned
      this.foot = this.clampFoot(g.foot0, this.rot())
    }
  }

  private onGrabEnd(): void {
    if (!this.grab || this.hold) return
    this.grab = null
    this.ctx.log("rp:release")
    if (this.pose === "rest") this.startDrop()
  }

  private clampFoot(target: vec3, rot: quat): vec3 {
    return clampFoot(FOOT, target, rot, this.scale, this.surf)
  }

  private unclampFoot(foot: vec3, rot: quat): vec3 {
    return unclampFoot(FOOT, foot, rot, this.scale, this.surf)
  }

  // =====================================================================================
  // Contact glow, hover disc, trail
  // =====================================================================================

  private buildGlowAndDisc(): void {
    // Empty holders: their meshes are made once the landed scale is known (meshGlowAndDisc).
    this.contactGlowMat = this.glowMat()
    this.contactGlow = this.node(this.root, "RpContactGlow", vec3.zero())
    this.contactGlow.enabled = false
    this.discMat = this.glowMat()
    this.disc = this.node(this.root, "RpHoverDisc", vec3.zero())
    this.disc.enabled = false
  }

  /** The glow's and disc's meshes at the landed scale (built once the scale is known). */
  private meshGlowAndDisc(): void {
    if (!this.contactGlow || this.contactGlow.getChildrenCount() > 0) return
    spawnMesh(this.contactGlow, "Glow", contactGlowKit(footprintOutlineXY(FOOT, this.scale)).build(), this.ctx.glowMat, undefined, this.contactGlowMat)
    // As wide as the deck is deep (front to back).
    this.discR = G.plinthHalf.y * this.scale
    spawnMesh(this.disc, "Disc", hoverDiscKit(this.discR).build(), this.ctx.glowMat, undefined, this.discMat)
  }

  private updateGlowAndDisc(): void {
    if (!this.contactGlow || !this.disc) return
    if (this.state === "launch") return
    this.meshGlowAndDisc()
    const tr = this.replica.getTransform()
    const fw = tr.getWorldTransform().multiplyPoint(new vec3(FOOT.center.x, 0, FOOT.center.y))
    const fwd = tr.getWorldRotation().multiplyVec3(vec3.forward())
    placeGlowAndDisc({glow: this.contactGlow, glowMat: this.contactGlowMat, disc: this.disc, discMat: this.discMat}, this.surf, fw, fwd, true, easeInOutCubic(this.discK), this.discR, this.globalFade, this.state !== "returning")
  }

  private updateTrail(): void {
    if (!this.trail) return
    const flying = (this.state === "launch" && this.t >= T_FLY0) || (this.state === "returning" && this.t >= RET_FLY0 && this.t < RET_FLY1)
    const head = this.replicaCenter()
    if (flying) {
      if (this.trailPts.length === 0 || this.trailPts[this.trailPts.length - 1].distance(head) > 2) this.trailPts.push(head)
      if (this.trailPts.length > 28) this.trailPts.shift()
    } else if (this.trailPts.length > 0) {
      this.trailPts.shift()
      if (this.trailPts.length > 0) this.trailPts.shift()
    }
    if (this.trailPts.length < 2) {
      this.trail.setVisible(false)
      return
    }
    this.trail.setVisible(true)
    const n = this.trailPts.length
    const alphas = this.trailPts.map((_, i) => Math.pow(i / (n - 1), 0.8))
    this.trail.update(this.trailPts, this.ctx.camPos().sub(head).normalize(), alphas)
  }

  // =====================================================================================
  // Put it back
  // =====================================================================================

  private updateReturn(dt: number): void {
    void dt
    const t = this.t
    const tr = this.replica.getTransform()
    const from = this.retFrom
    if (t < RET_FLY0) {
      // Whole again: it lifts 3 cm off the table (0.25 s), then flies home.
      this.h = from.h + PUTBACK_LIFT_CM * easeOutCubic((t - RET_READY) / (RET_FLY0 - RET_READY))
      this.applyPose()
      this.retPos = tr.getWorldPosition()
      this.shellFill = 1
      this.shellRim = 0.3
    } else if (t < RET_FLY1) {
      const u = easeInOutCubic((t - RET_FLY0) / (RET_FLY1 - RET_FLY0))
      tr.setWorldPosition(bezier(this.retPos ?? this.pLand, this.ctrl, this.pMeet, u))
      tr.setWorldRotation(quat.slerp(from.rot, this.rStart, u))
      tr.setWorldScale(vec3.one().uniformScale(this.scale + (1 - this.scale) * u))
      // Back to edges of light so it can melt into the real deck.
      this.shellFill = 1 - easeOutCubic((t - RET_FLY0) / 0.4)
      this.shellRim = 0.3 + 0.6 * (1 - this.shellFill)
      if (!this.retFlags.flight) {
        this.retFlags.flight = true
        this.ctx.sound("flight", tr.getWorldPosition())
      }
      this.ctx.moveSound("flight", tr.getWorldPosition())
    } else {
      // It sinks into the real deck and melts.
      const k = easeInOutCubic((t - RET_FLY1) / (RET_END - RET_FLY1 - 0.1))
      tr.setWorldPosition(vec3.lerp(this.pMeet, this.pStart, k))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
      this.shellFill = 0
      this.shellRim = 0.9
      this.globalFade = 1 - clamp01((t - (RET_END - 0.4)) / 0.35)
    }
    if (t >= RET_END) {
      this.homeAt = getTime()
      this.ctx.log("rp:home")
      this.clear()
    }
  }

  // =====================================================================================
  // Shared per-frame
  // =====================================================================================

  private placeRail(): void {
    if (this.state !== "landed" && !(this.state === "returning" && this.ctx.rail.isVisible())) return
    this.ctx.rail.place(this.railAnchor())
  }

  /** The rail: beside the copy on the user's side, in front of the tonearm and to its right. */
  private railAnchor(): vec3 {
    const c = this.stageCenter()
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(c))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    const reach = G.plinthHalf.x * this.scale
    return c.add(toUser.uniformScale(reach + 13)).add(right.uniformScale(reach + 4)).add(new vec3(0, 2, 0))
  }

  /** The caption sits right above the rail; `rows` = slider rows showing above "Put it back". */
  private captionAnchor(rows: number): vec3 {
    const head = this.ctx.camPos()
    const rail = this.railAnchor()
    const k = RpRail.scaleAt(rail, head)
    return rail.add(new vec3(0, k * ((rows > 1 ? 10.3 : 4.1) + 5), 0))
  }

  private replicaCenter(): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(CENTER)
  }

  private lowestWorldY(): number {
    return hullLowestY(HULL, this.replica.getTransform().getWorldTransform())
  }

  /** Where the copy's centre is when it sits on the table here: the rail and captions stay put while it hovers or bobs. */
  private stageCenter(): vec3 {
    if (this.state === "launch" || this.pose === "fly" || !this.surf) return this.replicaCenter()
    return this.pivotFor(this.foot, this.yaw, this.restGap).add(this.rot().multiplyVec3(CENTER.uniformScale(this.scale)))
  }
}
