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
import {RpApart, RpApartInfo} from "./CutawayRpApart"
import {DeckEvent, RP_CUE_CM, RpDeck} from "./CutawayRpDeck"
import {RpPhysics} from "./CutawayRpPhysics"
import {RpRail, SliderKey} from "./CutawayRpRail"
import {pitchToFreq, RpSoundInfo, RpSoundShow} from "./CutawayRpSound"
import {RpTone} from "./CutawayRpTone"
import {arcControl, bezier, clampFoot, clearOfHead, contactGlowKit, DEG, fitScale, flatDir, footprint, Footprint, footprintOutlineXY, footRadius, footReach, hoverDiscKit, hullLowestY, placeGlowAndDisc, unclampFoot} from "./CutawayStageKit"
import {hull2, meshBoxes, polyGap, toView, viewFrame} from "./CutawayLayout"
import {ENERGY, ink, keyWord} from "./CutawayStyle"
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

/** Captions, one line each (recordplayer-hero.md §2). */
const CAPTIONS = [
  "Lift the arm and place the needle on the record.",
  keyWord("The needle rides the wiggle and *shakes*.", ENERGY.motion),
  keyWord("A magnet and coils turn that shaking into *signal*.", ENERGY.signal),
  keyWord("The speaker pushes *air*. That's the sound you hear.", ENERGY.motion),
  keyWord("Wiggle a magnet near a coil, and *current* flows.", ENERGY.signal)
]
/**
 * Half the width of the widest caption, in caption design units: centred text runs about 0.34
 * units a character at the caption's size (measured), plus a little margin.
 */
const CAPTION_HALF_W = Math.min(10.5, (0.34 * Math.max(...CAPTIONS.map((c) => c.replace(/<[^>]*>/g, "").length)) + 1) / 2)
/** Taken apart: the caption for the live detail. */
const CAPTION_APART = 4
/** How fast the parts follow the "Take apart" slider (slider units per second), as the camera. */
const APART_RATE = 1.6
/** Defaults for the sliders when the record first plays: comfortable, and 440 Hz. */
const LOUDNESS_DEFAULT = 0.6
const PITCH_DEFAULT = 2 / 3

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
  private grabs: {slide: SceneObject; turn: SceneObject; arm: SceneObject} | null = null
  private deck: RpDeck | null = null
  private sound: RpSoundShow | null = null
  private apart: RpApart | null = null
  /** The take-apart value the parts follow: the slider's, rate-limited, and 0 until it hovers. */
  private sEff = 0
  /** Put it back: waiting for the arm, the platter and the parts before it lifts. */
  private retWaiting = false
  /**
   * Which side of the copy the rail stands on, as the user sees it (+1 right, −1 left), and its extra
   * step outwards (cm), so it and its caption stay clear of the copy and inside the view.
   */
  private railSide = 1
  private railShift = 0
  private railShiftTarget = 0
  /** And its extra step towards the user (cm). */
  private railFwd = 0
  private railFwdTarget = 0
  private railCheckT = 0
  private lookByRmv = new Map<RenderMeshVisual, Look>()
  /** The tonearm in the hand: where its handle and the hand were at the grab, the yaw then, the hand's vertical travel. */
  private armGrab: {h0: vec3; q0: vec3 | null; accum: vec3; dy: number; ang0: number; yaw0: number} | null = null
  private captionStage = -1
  /** Where the caption was last placed (it is re-placed when the rail moves). */
  private captionAt: vec3 | null = null
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

  constructor(private ctx: RpContext) {
    ctx.rail.onChange = (k, v) => this.onSlider(k, v)
  }

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
    this.armGrab = null
    this.pose = "lift"
    this.retFrom = {rot: this.replica.getTransform().getWorldRotation(), h: this.h}
    this.state = "returning"
    this.t = 0
    // First the arm goes back to its rest and the platter stops (and any parts gather); then it flies.
    this.retWaiting = true
    if (this.deck) this.deck.toRest(true)
    this.ctx.rail.setMode("none")
    this.showCaption(-1)
    this.ctx.log("rp:putBack")
  }

  /** Reset: remove everything instantly, from any state. */
  clear(): void {
    if (this.sound) this.sound.clear()
    this.sound = null
    if (this.apart) this.apart.hideLabels()
    this.apart = null
    this.sEff = 0
    this.retWaiting = false
    this.railSide = 1
    this.railShift = 0
    this.railShiftTarget = 0
    this.railFwd = 0
    this.railFwdTarget = 0
    this.railCheckT = 0
    this.captionAt = null
    this.lookByRmv.clear()
    this.deck = null
    this.armGrab = null
    this.captionStage = -1
    this.ctx.tone.stop()
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
        this.updateDeck(dt)
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
  getApartInfo(): RpApartInfo | null {
    return this.apart ? this.apart.getInfo() : null
  }

  getApartValue(): number {
    return this.sEff
  }

  getDeck(): RpDeck | null {
    return this.state === "none" ? null : this.deck
  }

  getSoundInfo(): RpSoundInfo | null {
    return this.sound ? this.sound.getInfo() : null
  }

  /** A part of the copy by name ("RpPlatter", "RpTonearm", …). */
  getPart(name: string): SceneObject | null {
    return this.model ? this.model.parts[name] ?? null : null
  }

  /** The record's top surface at the platter axis (world). */
  recordTopWorld(): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(new vec3(G.axis.x, G.recordTop, G.axis.y))
  }

  /** The tonearm's pivot (world), for tests. */
  pivotWorldForTest(): vec3 {
    return this.pivotWorld()
  }

  getCaptionStage(): number {
    return this.captionStage
  }

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
    // Built while the model is still at the origin, unrotated, at scale 1 (the deck reads its stylus tip then).
    this.deck = new RpDeck(this.model)
    this.sound = new RpSoundShow(root, this.ctx.glowMat, () => this.ctx.camPos(), () => this.ctx.speaker(), this.ctx.tone, {
      log: (p) => this.ctx.log(p),
      caption: (stage) => this.showCaption(stage)
    })
    this.apart = new RpApart(this.model, this.deck, {
      labels: this.ctx.labels,
      glowMat: this.ctx.glowMat,
      camPos: () => this.ctx.camPos(),
      stageCenter: () => this.stageCenter(),
      // The rail as one outline (its labels, tracks, knobs and pills together): no part label slips
      // into the gaps between its rows.
      railBoxes: () => {
        const boxes = this.ctx.rail.isVisible() ? this.ctx.rail.getBoxes() : []
        return boxes.length ? [([] as vec3[]).concat(...boxes)] : []
      },
      setGroup: (g, fill, fade) => {
        const gl = this.groupLook[g]
        if (gl) {
          gl.fill = fill
          gl.fade = fade
        }
      },
      groupSolid: (g) => this.groupSolid(g),
      meshSolid: (rmv) => this.meshSolid(rmv),
      partSound: (p) => this.ctx.sound("part", p),
      log: (p) => this.ctx.log(p)
    })
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
      // The open dust cover is a tall box of glass: drawn additively its edges pile up, so it is toned down.
      const dim = group === "cover" && !m.accent ? 0.6 : 1
      const b = pass.baseColor
      const look: Look = {rmv: m.rmv, mat, base: new vec4(b.x * dim, b.y * dim, b.z * dim, b.w), emis: 0, rim: 0, accent: m.accent, group, depthWrite: true, twoSided: false}
      if (!m.accent) {
        look.emis = pass.emissiveIntensity * dim
        look.rim = pass.rimIntensity * (0.5 + 0.5 * dim)
        look.depthWrite = pass.depthWrite
        look.twoSided = pass.twoSided
      }
      this.looks.push(look)
      this.lookByRmv.set(m.rmv, look)
      if (!this.groupLook[group]) this.groupLook[group] = {fill: 1, rim: 1, fade: 1}
    }
  }

  /** Whether a look group is drawn solid now. */
  private groupSolid(g: string): boolean {
    const gl = this.groupLook[g]
    return this.shellFill * (gl ? gl.fill : 1) >= 0.95 && this.globalFade * (gl ? gl.fade : 1) >= 0.95
  }

  /** A mesh as the user sees it: solid (true), an outline or ghost (false), or not drawn (null). */
  private meshSolid(rmv: RenderMeshVisual): boolean | null {
    const l = this.lookByRmv.get(rmv)
    if (!l || l.accent || !rmv.getSceneObject().isEnabledInHierarchy) return null
    const gl = this.groupLook[l.group]
    const fill = this.shellFill * (gl ? gl.fill : 1)
    const fade = this.globalFade * (gl ? gl.fade : 1)
    if (fill >= 0.95 && fade >= 0.95) return true
    return fade > 0.05 ? false : null
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
      this.snapRailShift("rest")
      this.placeRail()
      this.ctx.rail.setMode("rest")
      this.ctx.rail.setValue("apart", 0)
      this.ctx.rail.setValue("loudness", LOUDNESS_DEFAULT)
      this.ctx.rail.setValue("pitch", PITCH_DEFAULT)
      this.showCaption(0)
      this.ctx.log("rp:landed")
    }
  }

  /** Whether the stage wants to hover (the take-apart step). */
  private wantHover(): boolean {
    // Taking it apart works with the arm at rest (spec §4).
    return this.state === "landed" && this.ctx.rail.getValue("apart") > 0.001 && !!this.deck && this.deck.atRest && !this.armGrab
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
    // The parts separate only once it hovers, and gather again before it comes down.
    const target = this.pose === "hover" && this.wantHover() ? this.ctx.rail.getValue("apart") : 0
    const step = APART_RATE * dt
    this.sEff = Math.abs(target - this.sEff) <= step ? target : this.sEff + Math.sign(target - this.sEff) * step
    this.updatePose(dt, this.sEff <= 0.001)
    this.updateDeck(dt)
    this.updateApart(dt)
  }

  /** The parts, the live detail and the caption for the take-apart. */
  private updateApart(dt: number): void {
    if (!this.apart) return
    this.apart.update(dt, this.sEff, pitchToFreq(this.ctx.rail.getValue("pitch")))
    const busy = !this.deck || !this.deck.atRest
    if (this.apart.live) {
      if (this.captionStage !== CAPTION_APART) this.showCaption(CAPTION_APART)
    } else if (this.sEff > 0.001) {
      if (this.captionStage === 0) this.showCaption(-1)
    } else if (!busy && this.pose === "rest" && (this.captionStage === CAPTION_APART || this.captionStage === -1)) this.showCaption(0)
  }

  // =====================================================================================
  // The record plays: the tonearm, the platter and the sound in the room
  // =====================================================================================

  /** Every frame on the table: the deck's mechanics, what they set off, and the sound in the room. */
  private updateDeck(dt: number): void {
    const deck = this.deck
    if (!deck) return
    deck.update(dt)
    for (const e of deck.takeEvents()) this.onDeckEvent(e)
    if (this.sound) this.sound.update(dt, this.soundParams())
  }

  private onDeckEvent(e: DeckEvent): void {
    switch (e) {
      case "touchdown": {
        const tip = this.stylusWorld()
        this.ctx.sound("crackle", tip)
        this.ctx.log("rp:needleDown")
        this.ctx.rail.setMode("play")
        this.sound.start(this.threadPoints(), tip)
        break
      }
      case "liftoff":
        if (this.sound) this.sound.stop()
        if (this.state === "landed") {
          this.ctx.rail.setMode("rest")
          this.showCaption(0)
        }
        this.ctx.log("rp:lift")
        break
      case "rested":
        this.ctx.log("rp:armRest")
        if (this.state === "landed") this.showCaption(0)
        break
    }
  }

  /** A slider moved: its label, and everything it drives, in the same frame. */
  private onSlider(k: SliderKey, v: number): void {
    if (k === "pitch") this.ctx.rail.setLabel("pitch", "Pitch  " + Math.round(pitchToFreq(v)) + " Hz")
    if ((k === "pitch" || k === "loudness") && this.sound && this.deck && this.model) this.sound.refresh(this.soundParams())
  }

  /** Loudness and pitch from the rail, the platter's speed, where the stylus is. */
  private soundParams(): {loudness: number; freq: number; speedRatio: number; stylus: vec3; stylusR: number} {
    const rail = this.ctx.rail
    const deck = this.deck
    return {
      loudness: rail.getValue("loudness"),
      freq: pitchToFreq(rail.getValue("pitch")),
      speedRatio: deck ? deck.speedRatio : 0,
      stylus: this.stylusWorld(),
      stylusR: deck ? deck.radiusAt(deck.yaw) : 0
    }
  }

  /** The stylus tip in world space (from the model's own stylus transform). */
  stylusWorld(): vec3 {
    return this.model ? this.model.stylusTip() : vec3.zero()
  }

  /**
   * The signal's way from the cartridge to the real speaker: back along the arm to its pivot, down
   * the pivot into the plinth, under the platter to the side that faces the speaker (where the
   * deck's wires run), out of the deck and across the room in a soft arc to the speaker.
   */
  private threadPoints(): vec3[] {
    const tr = this.replica.getTransform()
    const m = tr.getWorldTransform()
    const pts: vec3[] = [this.stylusWorld()]
    pts.push(this.model.parts["RpCartridge"].getTransform().getWorldPosition())
    const lift = this.model.parts["RpTonearmLift"].getTransform().getWorldTransform()
    const path = G.armPath
    for (let i = path.length - 1; i >= 0; i--) pts.push(lift.multiplyPoint(new vec3(path[i].x, 0, path[i].y)))
    const P = G.pivot
    const low = 1.6
    pts.push(m.multiplyPoint(new vec3(P.x, low, P.z)))
    // Inside the plinth toward the speaker, to its edge.
    const sp = this.ctx.speaker()
    const inv = tr.getInvertedWorldTransform()
    const spM = inv.multiplyPoint(sp)
    let d = new vec2(spM.x - P.x, spM.z - P.z)
    d = d.length > 1e-4 ? d.normalize() : new vec2(-1, 0)
    const hw = G.plinthHalf.x
    const hd = G.plinthHalf.y
    const tx = d.x > 1e-6 ? (hw - P.x) / d.x : d.x < -1e-6 ? (-hw - P.x) / d.x : 1e9
    const tz = d.y > 1e-6 ? (hd - P.z) / d.y : d.y < -1e-6 ? (-hd - P.z) / d.y : 1e9
    const te = Math.min(tx, tz)
    const edge = m.multiplyPoint(new vec3(P.x + d.x * te, low, P.z + d.y * te))
    const out = m.multiplyPoint(new vec3(P.x + d.x * (te + 1.2), low, P.z + d.y * (te + 1.2)))
    pts.push(edge, out)
    // Across the room: a soft arc that rises over the gap and comes down to the speaker.
    const dist = out.distance(sp)
    const c = vec3.lerp(out, sp, 0.5).add(new vec3(0, 0.18 * dist + 12, 0))
    for (let i = 1; i <= 40; i++) pts.push(bezier(out, c, sp, i / 40))
    return pts
  }

  /** The caption for a stage of the story (0 = place the needle; 1–3 while it plays), above the rail. */
  private showCaption(stage: number): void {
    this.captionStage = stage
    const rows = this.ctx.rail.getMode() === "play" ? 2 : 1
    const at = this.captionAnchor(rows)
    this.captionAt = stage >= 0 ? at : null
    this.ctx.caption(stage >= 0 && stage < CAPTIONS.length ? CAPTIONS[stage] : null, at)
  }

  private canArm(): boolean {
    return this.state === "landed" && this.pose === "rest" && !this.grab && !!this.deck
  }

  private onArmStart(p: vec3 | null): void {
    if (!this.canArm() || this.armGrab) return
    const deck = this.deck
    const h0 = this.grabs.arm.getTransform().getWorldPosition()
    const piv = this.pivotWorld()
    const rel = h0.sub(piv)
    this.armGrab = {h0, q0: p, accum: vec3.zero(), dy: 0, ang0: Math.atan2(rel.x, rel.z), yaw0: deck.yaw}
    deck.grab()
    this.ctx.log("rp:armGrab")
  }

  private onArmUpdate(p: vec3 | null, dv: vec3 | null): void {
    const g = this.armGrab
    if (!g || !this.deck) return
    const d = dv ?? vec3.zero()
    g.accum = g.accum.add(d)
    g.dy += d.y
    // Where the hand has carried the finger lift: the hand's travel on the drag plane since the grab.
    const target = g.q0 && p ? g.h0.add(p.sub(g.q0)) : g.h0.add(g.accum)
    const rel = target.sub(this.pivotWorld())
    if (Math.sqrt(rel.x * rel.x + rel.z * rel.z) < 1) return
    let da = Math.atan2(rel.x, rel.z) - g.ang0
    while (da > Math.PI) da -= Math.PI * 2
    while (da < -Math.PI) da += Math.PI * 2
    this.deck.hold(g.yaw0 + da, RP_CUE_CM + g.dy / this.scale)
  }

  private onArmEnd(): void {
    if (!this.armGrab || !this.deck || this.hold) return
    this.armGrab = null
    const r = this.deck.release()
    this.ctx.log(r === "drop" ? "rp:armDrop" : "rp:armReturn")
  }

  /** The tonearm's pivot (world). */
  private pivotWorld(): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(G.pivot)
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
    // The tonearm, by its finger lift: a small handle round the headshell that follows it.
    const arm = this.node(this.root, "RpArmGrab", vec3.zero())
    const acol = arm.createComponent("Physics.ColliderComponent") as ColliderComponent
    const abox = Shape.createBoxShape()
    abox.size = new vec3(4.5 * S, 4.5 * S, 3.6 * S)
    acol.shape = abox
    acol.debugDrawEnabled = false
    const ai = arm.createComponent(Interactable.getTypeName()) as Interactable
    ai.enableInstantDrag = true
    ai.onDragStart.add((e) => this.onArmStart(e.interactor.planecastPoint))
    ai.onDragUpdate.add((e) => this.onArmUpdate(e.interactor.planecastPoint, e.dragVector))
    ai.onDragEnd.add(() => this.onArmEnd())
    this.grabs = {slide, turn, arm}
    this.syncGrabs()
    this.ctx.log("rp:grabReady")
  }

  private canGrab(): boolean {
    // Not while the record plays or the arm is off its rest (a real deck isn't shoved mid-play).
    return this.state === "landed" && this.pose !== "fly" && this.pose !== "lift" && !this.armGrab && (!this.deck || this.deck.atRest)
  }

  private syncGrabs(): void {
    if (!this.grabs) return
    const armOn = this.canArm() || !!this.armGrab
    this.grabs.arm.enabled = armOn
    if (armOn && !this.armGrab) {
      // Round the finger lift and the cartridge, level, turned with the copy.
      const a = this.model.parts["RpFingerLift"].getTransform().getWorldPosition()
      const b = this.model.parts["RpCartridge"].getTransform().getWorldPosition()
      const at = this.grabs.arm.getTransform()
      at.setWorldPosition(vec3.lerp(a, b, 0.5))
      at.setWorldRotation(quat.lookAt(vec3.up(), flatDir(this.replica.getTransform().getWorldRotation().multiplyVec3(vec3.forward()))))
    }
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
    if (this.retWaiting) {
      this.t = 0
      // The parts gather (twice the take-apart rate) while the arm returns and the platter stops.
      this.sEff = Math.max(0, this.sEff - 2 * APART_RATE * dt)
      if (this.apart) this.apart.update(dt, this.sEff, pitchToFreq(this.ctx.rail.getValue("pitch")))
      const stopped = !this.deck || this.deck.stopped
      if (!stopped || this.sEff > 0 || (this.sound && this.sound.isOn)) return
      this.retWaiting = false
      this.retFrom = {rot: this.replica.getTransform().getWorldRotation(), h: this.h}
      // Straight into the lift: the wait was its pause.
      this.t = RET_READY
      this.ctx.log("rp:ready")
    }
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
    if (this.state === "landed") this.updateRailShift(getDeltaTime())
    this.ctx.rail.place(this.railAnchor())
  }

  /**
   * Keep the rail and its caption clear of the copy as the user sees it: a few times a second, while
   * nothing is held and the copy is assembled, find the place that clears every visible mesh of the
   * copy (findRailShift) and glide there; the caption follows once the rail settles.
   */
  private updateRailShift(dt: number): void {
    this.railCheckT -= dt
    // Never under a finger, and not while the parts are out: the rail keeps its place while a slider
    // is held or the copy is apart (the part labels are laid out around it and its caption).
    const settled = !this.ctx.rail.isDragging() && this.sEff <= 0.001 && this.ctx.rail.getValue("apart") <= 0.001 && this.pose === "rest"
    if (this.railCheckT <= 0 && this.ctx.rail.isVisible() && settled) {
      this.railCheckT = 0.25
      const want = this.findRailShift()
      if (want.side !== this.railSide) {
        // The other side: jump there (gliding across would sweep the rail through the copy).
        this.railSide = want.side
        this.railShift = want.shift
        this.railFwd = want.fwd
      }
      this.railShiftTarget = want.shift
      this.railFwdTarget = want.fwd
    }
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.12)
    this.railShift += (this.railShiftTarget - this.railShift) * k
    this.railFwd += (this.railFwdTarget - this.railFwd) * k
    if (Math.abs(this.railShiftTarget - this.railShift) < 0.05) this.railShift = this.railShiftTarget
    if (Math.abs(this.railFwdTarget - this.railFwd) < 0.05) this.railFwd = this.railFwdTarget
    // Once the rail has settled somewhere new, the caption moves with it (one cross-fade).
    if (this.captionStage >= 0 && this.captionAt && this.railShift === this.railShiftTarget && this.railFwd === this.railFwdTarget) {
      const want = this.captionAnchor(this.ctx.rail.getMode() === "play" ? 2 : 1)
      if (want.distance(this.captionAt) > 2) this.showCaption(this.captionStage)
    }
  }

  /** Snap the rail's place now (on landing, before the rail and caption appear). */
  private snapRailShift(mode: "rest" | "play"): void {
    const want = this.findRailShift(mode)
    this.railSide = want.side
    this.railShift = this.railShiftTarget = want.shift
    this.railFwd = this.railFwdTarget = want.fwd
    this.railCheckT = 0.25
    print(`Cutaway: rp rail on the ${want.side > 0 ? "right" : "left"}, ${want.shift} cm further out and ${want.fwd} cm nearer (reaches ${want.reach.toFixed(1)} cm from the copy's centre in view)`)
  }

  /**
   * Where the rail stands. For each side of the copy and each step towards the user (0–36 cm), the
   * smallest step out (0–90 cm in 3 cm steps) at which the rail's full layout and its caption clear
   * the copy's meshes from the user's eye; of those, the most compact: the one whose farthest corner
   * is nearest the copy's centre in view, so it stays close to where the user is looking (the
   * current side keeps it unless the other is clearly closer). The copy faces its tonearm to the
   * user, so its open dust cover stands tall on the user's right: there the caption would sit on the
   * cover, and the rail usually stands on the left. Both face the eye at a constant apparent size,
   * so their outlines are rectangles in view: the rail's sliders and pill span x −8.5…8.5 and
   * y −7…4.8 design units (11 with the Pitch row); the caption, centred below its top centre, is as
   * wide as its longest line (CAPTION_HALF_W) and about 5 tall.
   */
  private findRailShift(mode: "rest" | "play" = this.ctx.rail.getMode() === "play" ? "play" : "rest"): {side: number; shift: number; fwd: number; reach: number} {
    const none = {side: this.railSide, shift: 0, fwd: 0, reach: 0}
    const eye = this.ctx.camPos()
    const F = viewFrame(eye, this.stageCenter())
    const copy: {h: vec2[]; x0: number; x1: number; y0: number; y1: number}[] = []
    for (const b of meshBoxes(this.replica)) {
      const h = hull2(b.map((q) => toView(F, q)))
      copy.push({h, x0: Math.min(...h.map((q) => q.x)), x1: Math.max(...h.map((q) => q.x)), y0: Math.min(...h.map((q) => q.y)), y1: Math.max(...h.map((q) => q.y))})
    }
    if (!copy.length) return none
    const rows = mode === "play" ? 2 : 1
    const top = rows > 1 ? 10.5 : 4.3
    const unitAt = (p: vec3, k: number) => (k * F.D) / Math.max(1, p.sub(eye).dot(F.f))
    const rect = (c: vec2, u: number, x0: number, x1: number, y0: number, y1: number) => [new vec2(c.x + u * x0, c.y + u * y0), new vec2(c.x + u * x1, c.y + u * y0), new vec2(c.x + u * x1, c.y + u * y1), new vec2(c.x + u * x0, c.y + u * y1)]
    // Clear of every mesh by 1 view unit (boxes far from the rectangle are skipped cheaply).
    const clearOf = (r: vec2[]) => {
      const x0 = Math.min(r[0].x, r[2].x) - 1
      const x1 = Math.max(r[0].x, r[2].x) + 1
      const y0 = Math.min(r[0].y, r[2].y) - 1
      const y1 = Math.max(r[0].y, r[2].y) + 1
      return copy.every((m) => m.x1 < x0 || m.x0 > x1 || m.y1 < y0 || m.y0 > y1 || polyGap(r, m.h) >= 1)
    }
    const savedSide = this.railSide
    const saved = this.railShift
    const savedFwd = this.railFwd
    const dd = this.ctx.labels.getDesignDistance()
    const best = new Map<number, {side: number; shift: number; fwd: number; reach: number}>()
    for (const side of [1, -1]) {
      this.railSide = side
      for (let fwd = 0; fwd <= 36; fwd += 6) {
        this.railFwd = fwd
        for (let shift = 0; shift <= 90; shift += 3) {
          this.railShift = shift
          const a = this.railAnchor()
          const ca = this.captionAnchor(rows)
          const shapes = [
            rect(toView(F, a), unitAt(a, RpRail.scaleAt(a, eye)), -8.5, 8.5, -7, top + 0.5),
            rect(toView(F, ca), unitAt(ca, Math.min(6, Math.max(0.3, ca.distance(eye) / dd))), -CAPTION_HALF_W, CAPTION_HALF_W, -4.8, 0.3)
          ]
          if (!shapes.every(clearOf)) continue
          let reach = 0
          for (const h of shapes) for (const q of h) reach = Math.max(reach, q.length)
          const b = best.get(side)
          if (!b || reach < b.reach - 0.5) best.set(side, {side, shift, fwd, reach})
          break
        }
      }
    }
    this.railSide = savedSide
    this.railShift = saved
    this.railFwd = savedFwd
    const mine = best.get(savedSide)
    const other = best.get(-savedSide)
    if (mine && (!other || mine.reach <= other.reach + 5)) return mine
    return other || none
  }

  /** The rail: beside the copy on the user's side, in front of it and to the side `railSide` picks. */
  private railAnchor(): vec3 {
    const c = this.stageCenter()
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(c))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    const reach = G.plinthHalf.x * this.scale
    return c.add(toUser.uniformScale(reach + 13 + this.railFwd)).add(right.uniformScale(this.railSide * (reach + 4 + this.railShift))).add(new vec3(0, 2, 0))
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
