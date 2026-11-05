/**
 * Lamp hero stage ("Bring it closer"), see devpost/lamp-hero.md (Phase B).
 *
 * A rim-only copy of the code-built floor lamp (CutawayLampModel) peels off the real lamp, rises and
 * flies to the coffee table on the hero flight arc, shrinking on the way to its table scale (60 cm
 * standing height, 0.3632x, or less if the table is small). It drops the last 20 cm under physics,
 * stands on its base and fills in. The cord and its foot switch lie on the table top, curving toward
 * the user. There the user moves and turns it, switches it on, lifts the shade, dims and warms it
 * and takes it apart. "Put it back" flies it home; Reset clears it from any state.
 *
 * Built on the shared stage helpers (CutawayStageKit: flight arc, table surface, hover disc, contact
 * glow) plus the lamp's own code. The camera and record player stages are not touched: one copy on
 * the table at a time is kept by CutawayMain, which sends the others home through their public
 * reset paths.
 *
 * Units: the copy is the model's own space (cm at 1x: origin on the floor at the base's centre, +Y
 * up), scaled by `scale` on the table.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {setFade, spawnMesh, TrailRibbon} from "./CutawayGeometry"
import {TableSurface} from "./CutawayHeroSurface"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {boxCorners, hull2, polyGap, toView, viewFrame} from "./CutawayLayout"
import {kelvinToWarmth, LAMP_K_DEFAULT, LampLight, LampLightInfo, LampLightTimes, RAYS_FROM, SHADE_LIFT_CM, warmthToKelvin} from "./CutawayLampLight"
import {LAMP_GEOM, LampModel} from "./CutawayLampModel"
import {LampPhysics} from "./CutawayLampPhysics"
import {LampRail, LampSliderKey} from "./CutawayLampRail"
import {arcControl, bezier, clampFoot, clearOfHead, contactGlowKit, DEG, fitScale, flatDir, Footprint, footprintOutlineXY, footRadius, footReach, hoverDiscKit, hullLowestY, placeGlowAndDisc, unclampFoot} from "./CutawayStageKit"
import {ENERGY, ink} from "./CutawayStyle"
import {clamp01, easeInOutCubic, easeOutCubic} from "./CutawayTween"

export type LampSound = "lift" | "flight" | "land" | "tap" | "part" | "click" | "rise" | "rustle"
export type LampState = "none" | "launch" | "landed" | "returning"
export type LampPose = "fly" | "drop" | "rest" | "rise" | "hover" | "descend" | "lift"

export interface LampContext {
  parent: SceneObject
  glowMat: Material
  /** LampShell, LampPaper and LampSteel: the model's solid look. */
  shellMat: Material
  paperMat: Material | null
  steelMat: Material | null
  labels: CutawayLabelsUI
  rail: LampRail
  camPos: () => vec3
  camera: Camera | null
  /** The real lamp: its base's centre on the floor (the model origin at 1x, unrotated). */
  realOrigin: () => vec3
  /** The real lamp's shade (lampMarker). */
  realShade: () => vec3
  /** The real lamp's bulb (bulbMarker): where the thread from the copy ends. */
  realBulb: () => vec3
  surface: () => TableSurface
  survey: (done: (s: TableSurface) => void) => void
  matter: Matter | null
  sound: (s: LampSound, p: vec3) => void
  moveSound: (s: LampSound, p: vec3) => void
  log: (p: string) => void
  caption: (text: string | null, topCenter?: vec3) => void
}

// =====================================================================================
// Geometry (model space, cm at 1x)
// =====================================================================================

const G = LAMP_GEOM

/** The table scale: a 60 cm standing height (lamp-hero.md §1), capped by what fits the table. */
export const LAMP_SCALE = 60 / G.height

/** Hull points: the base's foot ring, and the bottoms of the switch and the plug. */
const HULL: vec3[] = (() => {
  const pts: vec3[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push(new vec3((G.baseR - 0.3) * Math.cos(a), 0, (G.baseR - 0.3) * Math.sin(a)))
  }
  pts.push(new vec3(G.switchAt.x, 0, G.switchAt.z), new vec3(G.plugAt.x, 0, G.plugAt.z))
  return pts
})()

/** Physics proxy: the weighted base disc, as a low box (the mass of a floor lamp is in its base). */
const BOX_CENTER = new vec3(0, G.rimTop / 2, 0)
const BOX_SIZE = new vec3(2 * G.baseR, G.rimTop, 2 * G.baseR)
/** The copy's visual centre (the trail, the flight); the rail and the captions stand lower, at RAIL_Y. */
const CENTER = new vec3(0, G.height / 2, 0)
const RAIL_Y = 30
/** The shade's middle (the turn and lift handle). */
const SHADE_MID = new vec3(0, (G.paperY0 + G.paperY1) / 2, 0)

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

// Launch: rise off the real lamp, fly 1.7 s (shrinking), fill in over 400 ms once down.
const T_RISE = 0.7
const T_FLY0 = 0.75
const T_FLY1 = 2.45
const T_FILL = 0.4
// Put it back: the lamp switches off and the parts come home first, then it lifts, flies and melts in.
const RET_READY = 0.6
const RET_FLY0 = RET_READY + 0.25
const RET_FLY1 = RET_FLY0 + 1.6
const RET_END = RET_FLY1 + 0.7

const LIGHT = ENERGY.light

/** Captions, one line each (lamp-hero.md §2–§5). */
export const LAMP_CAPTIONS = {
  press: "Press the switch on the cord.",
  flow: "Electric energy flows up the cord.",
  chip: "The chip glows blue. A coating turns it white.",
  glow: "The paper scatters it into a soft glow.",
  harsh: "Without the paper, all the light comes from one tiny point. That's harsh light."
}
/**
 * Half the width of the widest caption, in caption design units: centred text runs about 0.34
 * units a character at the caption's size (measured), plus a little margin.
 */
const CAPTION_HALF_W = 10.5
/** How fast the parts follow the "Take apart" slider (slider units per second), as the other stages. */
const APART_RATE = 1.6
/** The foot switch's button (model cm): its stroke when pinched, and how far it stays down while on (push-push latch). */
const BUTTON_STROKE = 0.42
const BUTTON_LATCH = 0.16
/** How much brighter the LED chips and the frosted envelope's emissive get when lit (× the light's colour). */
const CHIP_GLOW = 2.4
const GLASS_GLOW = 1.7
/** The shade leaves its seat (a rustle) once lifted this far (world cm). */
const SHADE_LEFT_CM = 0.5
/** Released, the shade is lowered back onto its seat over this long (from the full 25 cm; less from lower). */
const SHADE_SETTLE_S = 0.34

interface Look {
  rmv: RenderMeshVisual
  mat: Material
  base: vec4
  emis: number
  emisCol: vec3
  rim: number
  group: string
  depthWrite: boolean
  twoSided: boolean
}

/** A look group's state: solid fill 0..1, rim boost, overall fade. */
interface GroupLook {
  fill: number
  rim: number
  fade: number
  /** Added to the part's emissive colour (the lit bulb). */
  glow: vec3 | null
}

export interface LampInfo {
  state: LampState
  pose: LampPose
  scale: number
  position: vec3
  up: vec3
  lowestY: number
  tableY: number
  /** The base's centre on the table (world). */
  foot: vec3
  tableCenter: vec3
  tableRadius: number
  /** How far the farthest point of the floor outline (base, cord, switch, plug) is from the table centre. */
  footReach: number
  speed: number
  held: boolean
  discShown: boolean
  glowShown: boolean
  landSound: vec3 | null
  lastDrop: {bounce: number; settle: number; restGap: number; tiltDeg: number} | null
}

export class LampHero {
  state: LampState = "none"
  /** Test hook: freeze the stage's timeline (for screenshots of one beat). */
  hold = false

  private root: SceneObject | null = null
  private model: LampModel | null = null
  private replica: SceneObject
  private layer: LayerSet
  private layerMade = false
  private looks: Look[] = []
  private groupLook: {[g: string]: GroupLook} = {}
  private foot0: Footprint | null = null

  private t = 0
  private scale = LAMP_SCALE
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
  private physics: LampPhysics | null = null
  private surf: TableSurface
  private pose: LampPose = "fly"
  private poseT = 0
  /** The base's centre (world; y = table top) and the lowest point's height above the table top. */
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
  private grabs: {slide: SceneObject; turn: SceneObject; sw: SceneObject} | null = null
  /** The take-apart value the parts follow: the slider's, rate-limited, and 0 until it hovers. */
  private sEff = 0
  /** Put it back: waiting for the light and the parts before it lifts. */
  private retWaiting = false
  /** Which side of the copy the rail stands on, as the user sees it (+1 right, −1 left), and its extra steps out and nearer (cm). */
  private railSide = 1
  private railShift = 0
  private railShiftTarget = 0
  private railFwd = 0
  private railFwdTarget = 0
  private railCheckT = 0
  private lookByRmv = new Map<RenderMeshVisual, Look>()
  private caption: string | null = null
  /** Where the caption was last placed (it is re-placed when the rail moves). */
  private captionAt: vec3 | null = null
  private grab: {kind: "slide" | "turn" | "lift"; p0: vec3; usePlane: boolean; foot0: vec3; yaw0: number; angPrev: number; turned: number; accum: vec3; lift0: number; dy: number} | null = null
  private contactGlow: SceneObject | null = null
  private contactGlowMat: Material | null = null
  private disc: SceneObject | null = null
  private discMat: Material | null = null
  private discR = 12
  private lastLandPos: vec3 | null = null
  private launchedAt = -1
  private landedAt = -1
  private homeAt = -1
  // The light, and the foot switch's button
  private light: LampLight | null = null
  private buttonRest: vec3 | null = null
  private buttonT = -1
  private buttonFrom = 0
  private buttonDepth = 0
  private buttonOn = false
  // The shade: its lift off the seat (world cm), its seat (local), being lowered back after release
  private shadeLift = 0
  private shadeRest: vec3 | null = null
  private shadeLeft = false
  private settle: {t: number; from: number; dur: number} | null = null
  private shadeReleasedAt = -1
  /** The "harsh light" caption is up (the shade lifted past RAYS_FROM); the light's own last caption. */
  private harsh = false
  private lightCaption: string | null = null

  constructor(private ctx: LampContext) {
    ctx.rail.onChange = (k, v) => this.onSlider(k, v)
  }

  // =====================================================================================
  // Public API
  // =====================================================================================

  get isOut(): boolean {
    return this.state !== "none"
  }

  /** "Bring it closer": build the copy on the real lamp and start the launch. */
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
    this.rStart = quat.quatIdentity()
    this.pStart = this.ctx.realOrigin()
    this.surf = this.ctx.surface()
    this.scale = this.fit(this.surf)
    const table = this.surf.center
    // The cord and its foot switch face the user, so the switch is easy to reach.
    const toUser = flatDir(this.head0.sub(table))
    const sw = G.switchAt
    this.rLand = quat.angleAxis(Math.atan2(toUser.x, toUser.z) - Math.atan2(sw.x, sw.z), vec3.up())
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
    this.ctx.log("lamp:launch")
    print(`Cutaway: lamp scale ${this.scale.toFixed(4)} (standing height ${(G.height * this.scale).toFixed(1)} cm; floor outline reach ${footRadius(this.foot0).toFixed(2)} cm at 1x, table radius ${this.surf.safeRadius.toFixed(2)} cm − ${EDGE_GAP} cm)`)
    this.applyLaunch()
    this.ctx.survey((s) => this.onSurface(s))
  }

  /** "Put it back": the lamp switches off, everything comes home, it lifts, flies home, grows and melts into the real lamp. */
  putBack(): void {
    if (this.state !== "landed") return
    if (this.physics) {
      if (this.pose === "drop") this.toRest(true)
      this.physics.freeze()
    }
    if (this.grab && this.grab.kind === "lift") this.lowerShade()
    this.grab = null
    this.pose = "lift"
    this.retFrom = {rot: this.replica.getTransform().getWorldRotation(), h: this.h}
    this.state = "returning"
    this.t = 0
    this.retWaiting = true
    if (this.light && this.light.isOn) {
      this.light.turnOff()
      this.buttonOn = false
      this.buttonT = -1
      this.ctx.log("lamp:off")
    }
    this.ctx.rail.setMode("none")
    this.showCaption(null)
    this.ctx.log("lamp:putBack")
  }

  /** Reset: remove everything instantly, from any state. */
  clear(): void {
    if (this.light) this.light.clear()
    this.light = null
    this.buttonRest = null
    this.buttonT = -1
    this.buttonFrom = 0
    this.buttonDepth = 0
    this.buttonOn = false
    this.shadeLift = 0
    this.shadeRest = null
    this.shadeLeft = false
    this.settle = null
    this.shadeReleasedAt = -1
    this.harsh = false
    this.lightCaption = null
    this.sEff = 0
    this.retWaiting = false
    this.railSide = 1
    this.railShift = 0
    this.railShiftTarget = 0
    this.railFwd = 0
    this.railFwdTarget = 0
    this.railCheckT = 0
    this.captionAt = null
    this.caption = null
    this.lookByRmv.clear()
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
    if ((this.state as LampState) === "none") return
    if (this.light) this.light.update(dt, this.lightParams())
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

  getModel(): LampModel | null {
    return this.state === "none" ? null : this.model
  }

  getScale(): number {
    return this.scale
  }

  /** The floor outline's farthest point from the base's centre at the chosen scale. */
  getFitReach(): number {
    return this.foot0 ? footRadius(this.foot0) * this.scale : 0
  }

  getInfo(): LampInfo {
    const live = this.state !== "none" && !!this.replica
    const tr = live ? this.replica.getTransform() : null
    const s = this.surf ?? this.ctx.surface()
    const foot = tr ? tr.getWorldTransform().multiplyPoint(vec3.zero()) : vec3.zero()
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
      footReach: tr && this.foot0 ? footReach(this.foot0, foot, tr.getWorldRotation(), tr.getWorldScale().x, s.center) : 0,
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

  getCaption(): string | null {
    return this.caption
  }

  /** The light's state (pulses, bulb, bubble, glows, the thread and the real lamp). */
  getLight(): LampLightInfo | null {
    return this.light ? this.light.getInfo() : null
  }

  /** When the light's beats happened (on, bulb, real lamp on, off, dark), or null before a light exists. */
  getLightTimes(): LampLightTimes | null {
    return this.light ? this.light.getTimes() : null
  }

  get lightOn(): boolean {
    return !!this.light && this.light.isOn
  }

  /** How far the foot switch's button is down (model cm). */
  getButtonDepth(): number {
    return this.buttonDepth
  }

  /** The shade's lift off its seat (world cm, 0 … 25), whether the hand holds it, and whether it is being lowered back. */
  getShade(): {lift: number; held: boolean; settling: boolean; releasedAt: number} {
    return {lift: this.shadeLift, held: !!this.grab && this.grab.kind === "lift", settling: !!this.settle, releasedAt: this.shadeReleasedAt}
  }

  /** The colour temperature the Warmth slider asks for (K). */
  getKelvin(): number {
    return warmthToKelvin(this.ctx.rail.getValue("warmth"))
  }

  /** The direction (flat, world) from the base's centre to the foot switch. */
  getSwitchSide(): vec3 {
    if (this.state === "none") return vec3.zero()
    return flatDir(this.replica.getTransform().getWorldRotation().multiplyVec3(G.switchAt))
  }

  /** A part of the copy by name ("LampShade", "LampSwitch", …). */
  getPart(name: string): SceneObject | null {
    return this.model ? this.model.parts[name] ?? null : null
  }

  /** World points of every visible mesh of the copy's floor parts (base, cord, switch, plug), from their vertex extents. */
  floorBoxes(): vec3[][] {
    return this.meshBoxes((p) => p === "LampBase" || p === "LampCord" || p === "LampSwitch" || p === "LampSwitchButton" || p === "LampPlug")
  }

  // =====================================================================================
  // Build
  // =====================================================================================

  private build(): void {
    this.clear()
    const root = global.scene.createSceneObject("LampStage")
    root.setParent(this.ctx.parent)
    const rtr = root.getTransform()
    rtr.setWorldPosition(vec3.zero())
    rtr.setWorldRotation(quat.quatIdentity())
    rtr.setWorldScale(vec3.one())
    this.root = root
    // One render layer for the stage's lifetime (a new unique layer per launch would never be released).
    if (!this.layerMade) {
      this.layer = LayerSet.makeUnique()
      if (this.ctx.camera) this.ctx.camera.renderLayer = this.ctx.camera.renderLayer.union(this.layer)
      this.layerMade = true
    }
    this.model = new LampModel({parent: root, shellMat: this.ctx.shellMat, paperMat: this.ctx.paperMat, steelMat: this.ctx.steelMat, layer: this.layer})
    this.replica = this.model.root
    this.replica.name = "LampReplica"
    if (!this.foot0) this.foot0 = {pts: this.model.floorOutline(), center: vec2.zero()}
    this.buildLooks()
    this.buildGlowAndDisc()
    this.buttonRest = this.model.parts["LampSwitchButton"].getTransform().getLocalPosition()
    this.shadeRest = this.model.parts["LampShade"].getTransform().getLocalPosition()
    const model = this.model
    this.light = new LampLight({
      parent: root,
      glowMat: this.ctx.glowMat,
      camPos: this.ctx.camPos,
      model,
      replica: this.replica,
      scale: () => this.scale,
      surface: () => this.getSurface(),
      foot: () => this.foot,
      realOrigin: this.ctx.realOrigin,
      realBulb: this.ctx.realBulb,
      bubbleSide: () => -this.railSide,
      setBulbGlow: (k, c) => this.setBulbGlow(k, c),
      sound: (s, p) => this.ctx.sound(s, p),
      log: (p) => this.ctx.log(p),
      caption: (stage) => {
        if (this.state !== "landed") return
        this.lightCaption = stage === 1 ? LAMP_CAPTIONS.flow : stage === 2 ? LAMP_CAPTIONS.chip : LAMP_CAPTIONS.glow
        // While the shade is off, the harsh-light caption stays; the light's own comes back with the shade.
        if (!this.harsh) this.showCaption(this.lightCaption)
      }
    })
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

  /** The table scale for a surface: 60 cm tall, or the largest whose floor outline fits the table. */
  private fit(s: TableSurface): number {
    return fitScale(this.foot0, s.safeRadius, EDGE_GAP, LAMP_SCALE)
  }

  /** Every mesh gets its own material, so parts fill in, fade and turn to outlines on their own. */
  private buildLooks(): void {
    this.looks = []
    this.groupLook = {}
    for (const m of this.model.meshList()) {
      const group = m.part
      const mat = m.rmv.mainMaterial.clone()
      m.rmv.mainMaterial = mat
      const pass = mat.mainPass
      const b = pass.baseColor
      const ec = pass.emissiveColor
      const look: Look = {rmv: m.rmv, mat, base: new vec4(b.x, b.y, b.z, b.w), emis: pass.emissiveIntensity, emisCol: new vec3(ec.x, ec.y, ec.z), rim: pass.rimIntensity, group, depthWrite: pass.depthWrite, twoSided: pass.twoSided}
      this.looks.push(look)
      this.lookByRmv.set(m.rmv, look)
      if (!this.groupLook[group]) this.groupLook[group] = {fill: 1, rim: 1, fade: 1, glow: null}
    }
  }

  /** Apply the look: the shell's fill (rim-only in flight) times each part's own fill and fade. */
  private applyLooks(): void {
    const g0 = this.globalFade
    for (const l of this.looks) {
      const gl = this.groupLook[l.group]
      const fade = g0 * (gl ? gl.fade : 1)
      const fill = this.shellFill * (gl ? gl.fill : 1)
      const pass = l.mat.mainPass
      const k = fill * fade
      pass.baseColor = new vec4(l.base.x * k, l.base.y * k, l.base.z * k, l.base.w)
      pass.emissiveIntensity = l.emis * k
      const glow = gl ? gl.glow : null
      pass.emissiveColor = glow ? l.emisCol.add(glow) : l.emisCol
      // Rim-only in flight (edges of light); a part turned to an outline keeps a thin rim.
      const rimOnly = this.shellRim
      const rim = fill >= 0.999 ? l.rim : rimOnly + (l.rim - rimOnly) * fill
      pass.rimIntensity = rim * fade * (gl ? gl.rim : 1)
      const solid = fill > 0.95 && fade > 0.95
      pass.depthWrite = l.depthWrite && solid
      pass.twoSided = l.twoSided && solid
    }
  }

  /** World boxes (8 corners) of the copy's visible meshes, from their vertex extents (optionally only some parts). */
  private meshBoxes(only?: (part: string) => boolean): vec3[][] {
    const out: vec3[][] = []
    if (!this.model) return out
    for (const m of this.model.meshList()) {
      if (only && !only(m.part)) continue
      const so = m.rmv.getSceneObject()
      if (!so.isEnabledInHierarchy) continue
      out.push(boxCorners(so.getTransform().getWorldTransform(), m.lo, m.hi))
    }
    return out
  }

  // =====================================================================================
  // Launch and land
  // =====================================================================================

  private makePhysics(): void {
    if (this.physics) this.physics.destroy()
    this.physics = new LampPhysics(this.root, this.surf, {matter: this.ctx.matter, boxCenter: BOX_CENTER, boxSize: BOX_SIZE, scale: this.scale})
    this.physics.onContact((p, imp) => this.onContact(p, imp))
  }

  /** A survey finished: aim the flight at the table it found (and its scale), rebuild the collider. */
  private onSurface(s: TableSurface): void {
    if (this.state === "none") return
    this.surf = s
    this.ctx.log("lamp:surface:" + s.method)
    if (this.state === "launch") {
      const sc = this.fit(s)
      if (Math.abs(sc - this.scale) > 1e-4) {
        this.scale = sc
        print(`Cutaway: lamp scale ${sc.toFixed(4)} for the surveyed table (radius ${s.safeRadius.toFixed(2)} cm)`)
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
    return this.ctx.realOrigin().add(CENTER)
  }

  private applyLaunch(): void {
    const t = this.t
    const tr = this.replica.getTransform()
    if (t < T_FLY0) {
      // The copy peels off the real lamp and rises to the meeting point.
      const k = easeOutCubic(t / T_RISE)
      tr.setWorldPosition(vec3.lerp(this.pStart, this.pMeet, k))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
    } else {
      const u = easeInOutCubic((t - T_FLY0) / (T_FLY1 - T_FLY0))
      tr.setWorldPosition(bezier(this.pMeet, this.ctrl, this.pLand, u))
      tr.setWorldRotation(quat.slerp(this.rStart, this.rLand, u))
      // The lamp is taller than anything else: the copy shrinks to its table scale on the way.
      tr.setWorldScale(vec3.one().uniformScale(1 + (this.scale - 1) * u))
      this.ctx.moveSound("flight", tr.getWorldPosition())
      if (!this.trail) this.trail = new TrailRibbon(this.root, "LampTrail", this.ctx.glowMat, 28, 5, ink(LIGHT, 0.9))
    }
    // The rim-only copy: edges of light until it lands.
    this.shellFill = 0
    this.shellRim = 0.9 * easeOutCubic(t / 0.25)
    if (t >= T_FLY0 && !this.flags.flight) {
      this.flags.flight = true
      this.ctx.sound("flight", tr.getWorldPosition())
      this.ctx.log("lamp:flight")
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

  /** Copy pivot (the base's centre on the floor) for `foot` (x, z), and its lowest point `h` cm above the table top. */
  private pivotFor(foot: vec3, yaw: number, h: number): vec3 {
    void yaw
    return new vec3(foot.x, this.surf.height + h, foot.z)
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
    this.ctx.log("lamp:drop")
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
    this.ctx.log("lamp:touch")
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
   * keeping its yaw and the base's place. A residual tilt is levelled out, and the gap to the table
   * is kept between 0 and 2 mm (it is logged as found).
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
    this.foot = new vec3(pr.pos.x, this.surf.height, pr.pos.z)
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
    print(`Cutaway: lamp rest: gap ${(gap * 10).toFixed(2)} mm, tilt ${tiltDeg.toFixed(3)}°, bounce ${(d.bounce * 10).toFixed(2)} mm, still ${d.settle.toFixed(3)} s after contact, drop ${d.t.toFixed(3)} s`)
    this.ctx.log("lamp:rest")
    if (this.firstRest) {
      this.firstRest = false
      this.landedAt = getTime()
      this.snapRailShift()
      this.placeRail()
      this.ctx.rail.setMode("rest")
      this.ctx.rail.setValue("apart", 0)
      this.ctx.rail.setValue("brightness", 1)
      this.ctx.rail.setValue("warmth", kelvinToWarmth(LAMP_K_DEFAULT))
      this.showCaption(LAMP_CAPTIONS.press)
      this.ctx.log("lamp:landed")
    }
  }

  /** Whether the stage wants to hover (the take-apart step). */
  private wantHover(): boolean {
    return this.state === "landed" && this.ctx.rail.getValue("apart") > 0.001 && !this.grab && this.shadeSeated()
  }

  /** The shade on its seat (not lifted, held or being lowered). */
  private shadeSeated(): boolean {
    return this.shadeLift <= 0 && !this.settle && !(this.grab && this.grab.kind === "lift")
  }

  private startRise(): void {
    this.pose = "rise"
    this.poseT = 0
    this.h0 = this.h
    this.ctx.log("lamp:rise")
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
        if (this.grab && this.grab.kind === "slide") this.holdK = Math.min(1, this.holdK + dt / HOLD_DUR)
        this.h = this.restGap + HOLD_CM * easeInOutCubic(this.holdK)
        if (wantHover) this.startRise()
        this.applyPose()
        break
      case "rise":
        this.h = this.h0 + (HOVER_CM - this.h0) * easeOutCubic(this.poseT / RISE_DUR)
        if (this.poseT >= RISE_DUR) {
          this.pose = "hover"
          this.poseT = 0
          this.ctx.log("lamp:hover")
        }
        this.applyPose()
        break
      case "hover":
        this.h = HOVER_CM + BOB_CM * Math.sin((2 * Math.PI * this.poseT) / BOB_PERIOD)
        if (!wantHover && partsHome) {
          this.pose = "descend"
          this.poseT = 0
          this.h0 = this.h
          this.ctx.log("lamp:descend")
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
        if (this.poseT >= DESCEND_DUR) this.startDrop()
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
    this.updateButton(dt)
    this.updateShade(dt)
  }

  /**
   * The shade: held, it sits at the hand's lift; released, it is lowered back onto its seat (and
   * lands exactly on it, with a rustle). Only its height changes: it stays level and on the axis.
   * Past RAYS_FROM of the lift the harsh-light caption shows; seated again, the light's own returns.
   */
  private updateShade(dt: number): void {
    if (this.settle) {
      const st = this.settle
      st.t += dt
      const u = clamp01(st.t / st.dur)
      this.shadeLift = st.from * (1 - easeInOutCubic(u))
      if (u >= 1) {
        this.shadeLift = 0
        this.settle = null
        if (this.shadeLeft && this.model) this.ctx.sound("rustle", this.shadeCenter())
        this.shadeLeft = false
        this.ctx.log("lamp:shadeSeated")
      }
    }
    if (this.model && this.shadeRest) this.model.parts["LampShade"].getTransform().setLocalPosition(this.shadeRest.add(new vec3(0, this.shadeLift / this.scale, 0)))
    const k = this.shadeLift / SHADE_LIFT_CM
    const on = this.lightOn && this.state === "landed"
    if (on && !this.harsh && k > RAYS_FROM) {
      this.harsh = true
      this.showCaption(LAMP_CAPTIONS.harsh)
      this.ctx.log("lamp:harsh")
    } else if (this.harsh && (!on || k < 0.05)) {
      this.harsh = false
      if (on) this.showCaption(this.lightCaption ?? LAMP_CAPTIONS.glow)
    }
  }

  /** The shade's middle (world), where its rustle comes from. */
  private shadeCenter(): vec3 {
    return this.model.parts["LampShade"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, SHADE_MID.y - G.shadeSeatY, 0))
  }

  /** A slider moved: everything it drives, in the same frame. */
  private onSlider(k: LampSliderKey, v: number): void {
    if (k === "warmth") this.ctx.rail.setLabel("warmth", "Warmth  " + Math.round(warmthToKelvin(v)) + " K")
  }

  /** What the light follows each frame: the rail's Brightness and Warmth, the shade's lift (0..1). */
  private lightParams(): {brightness: number; kelvin: number; lift: number} {
    return {brightness: this.ctx.rail.getValue("brightness"), kelvin: this.getKelvin(), lift: this.shadeLift / SHADE_LIFT_CM}
  }

  /** The lit bulb: its LED chips and frosted envelope glow in the light's colour. */
  private setBulbGlow(k: number, c: vec3): void {
    const set = (g: string, gain: number) => {
      const gl = this.groupLook[g]
      if (gl) gl.glow = k > 1e-4 ? c.uniformScale(k * gain) : null
    }
    set("LampLedChips", CHIP_GLOW)
    set("LampBulbGlass", GLASS_GLOW)
  }

  /** The button's push-push stroke: down when pinched, back up to the latch (on) or to the top (off). */
  private updateButton(dt: number): void {
    const end = this.buttonOn ? BUTTON_LATCH : 0
    let d = end
    if (this.buttonT >= 0) {
      this.buttonT += dt
      const t = this.buttonT
      if (t < 0.05) d = this.buttonFrom + (BUTTON_STROKE - this.buttonFrom) * easeOutCubic(t / 0.05)
      else if (t < 0.11) d = BUTTON_STROKE
      else if (t < 0.23) d = BUTTON_STROKE + (end - BUTTON_STROKE) * easeInOutCubic((t - 0.11) / 0.12)
      else this.buttonT = -1
    }
    this.buttonDepth = d
    if (this.model && this.buttonRest) this.model.parts["LampSwitchButton"].getTransform().setLocalPosition(this.buttonRest.add(new vec3(0, -d, 0)))
  }

  /** The caption above the rail (null hides it). */
  private showCaption(text: string | null): void {
    this.caption = text
    const at = this.captionAnchor(this.railRows())
    this.captionAt = text ? at : null
    this.ctx.caption(text, at)
  }

  // =====================================================================================
  // Grabs: slide it across the table (the base and stem), turn it (the shade), the foot switch
  // =====================================================================================

  /**
   * Grab handles live under the stage root (not the copy), so a drag never feeds back through the
   * copy's own motion. Their frame has local Z up, so SIK's drag plane is the table plane.
   */
  private buildGrabs(): void {
    const make = (name: string, size: vec3): {so: SceneObject; inter: Interactable} => {
      const so = this.node(this.root, name, vec3.zero())
      const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
      const box = Shape.createBoxShape()
      box.size = size
      col.shape = box
      col.debugDrawEnabled = false
      const inter = so.createComponent(Interactable.getTypeName()) as Interactable
      return {so, inter}
    }
    const S = this.scale
    // Box axes in the handle's frame: x across the lamp, y along its front, z up.
    const slide = make("LampGrab", new vec3(2 * G.baseR * S + 1.5, 2 * G.baseR * S + 1.5, G.shadeSeatY * S + 1))
    const turn = make("LampTurnGrab", new vec3(2 * G.shadeMaxR * S + 1, 2 * G.shadeMaxR * S + 1, (G.paperY1 - G.paperY0) * S))
    for (const [g, kind] of [
      [slide, "slide"],
      [turn, "turn"]
    ] as [{so: SceneObject; inter: Interactable}, "slide" | "turn"][]) {
      g.inter.enableInstantDrag = true
      g.inter.onDragStart.add((e) => this.onGrabStart(kind, e.interactor.planecastPoint))
      g.inter.onDragUpdate.add((e) => this.onGrabUpdate(e.interactor.planecastPoint, e.dragVector))
      g.inter.onDragEnd.add(() => this.onGrabEnd())
    }
    // The foot switch: a pinch target a little larger than the switch (it is small on the table).
    const sw = make("LampSwitchGrab", new vec3(Math.max(4, 2 * G.switchHalf.x * S + 2), Math.max(3, 2 * G.switchHalf.z * S + 2), Math.max(2.5, 2 * G.switchHalf.y * S + 1.5)))
    sw.inter.onTriggerStart.add(() => this.onSwitch())
    this.grabs = {slide: slide.so, turn: turn.so, sw: sw.so}
    this.syncGrabs()
    this.ctx.log("lamp:grabReady")
  }

  private canGrab(): boolean {
    return this.state === "landed" && this.pose !== "fly" && this.pose !== "lift"
  }

  private syncGrabs(): void {
    if (!this.grabs) return
    const on = this.canGrab()
    this.grabs.slide.enabled = on
    this.grabs.turn.enabled = on
    this.grabs.sw.enabled = this.state === "landed" && this.pose === "rest" && !this.grab
    const tr = this.replica.getTransform()
    const m = tr.getWorldTransform()
    const q = quat.lookAt(vec3.up(), flatDir(tr.getWorldRotation().multiplyVec3(vec3.forward())))
    if (this.grabs.sw.enabled) {
      const st = this.grabs.sw.getTransform()
      st.setWorldPosition(m.multiplyPoint(G.switchAt.add(new vec3(0, G.switchHalf.y, 0))))
      st.setWorldRotation(quat.lookAt(vec3.up(), flatDir(tr.getWorldRotation().multiplyVec3(new vec3(-Math.sin(G.switchDeg * DEG), 0, Math.cos(G.switchDeg * DEG))))))
    }
    if (this.grab || !on) return
    const gt = this.grabs.slide.getTransform()
    gt.setWorldPosition(m.multiplyPoint(new vec3(0, G.shadeSeatY / 2, 0)))
    gt.setWorldRotation(q)
    const tt = this.grabs.turn.getTransform()
    tt.setWorldPosition(m.multiplyPoint(SHADE_MID))
    tt.setWorldRotation(q)
  }

  /** While the lamp is on (standing, whole), the shade's grab lifts the shade instead of turning the lamp. */
  private canLift(): boolean {
    return this.state === "landed" && this.pose === "rest" && this.lightOn && this.sEff <= 0.001
  }

  private onGrabStart(kind: "slide" | "turn", p: vec3 | null): void {
    if (!this.canGrab() || this.grab || !this.physics) return
    if (kind === "turn" && this.canLift()) {
      // Caught on its way down: it lifts from where it is.
      this.settle = null
      this.grab = {kind: "lift", p0: vec3.zero(), usePlane: false, foot0: this.foot, yaw0: this.yaw, angPrev: 0, turned: 0, accum: vec3.zero(), lift0: this.shadeLift, dy: 0}
      this.ctx.log("lamp:shadeGrab")
      return
    }
    if (this.pose === "drop") this.toRest(true)
    const handle = kind === "slide" ? this.grabs.slide : this.grabs.turn
    const p0 = p ?? handle.getTransform().getWorldPosition()
    const rel = p0.sub(this.foot)
    const ang = Math.atan2(rel.x, rel.z)
    this.grab = {kind, p0, usePlane: !!p, foot0: this.unclampFoot(this.foot, this.rot()), yaw0: this.yaw, angPrev: ang, turned: 0, accum: vec3.zero(), lift0: 0, dy: 0}
    this.ctx.log("lamp:grab")
  }

  private onGrabUpdate(p: vec3 | null, dv: vec3 | null): void {
    const g = this.grab
    if (!g) return
    if (g.kind === "lift") {
      // Straight up and down with the hand (world cm), from the seat to 25 cm above it.
      g.dy += dv ? dv.y : 0
      this.shadeLift = Math.max(0, Math.min(SHADE_LIFT_CM, g.lift0 + g.dy))
      if (!this.shadeLeft && this.shadeLift > SHADE_LEFT_CM) {
        this.shadeLeft = true
        this.ctx.sound("rustle", this.shadeCenter())
        this.ctx.log("lamp:shadeLift")
      }
      return
    }
    let q = g.usePlane ? p : null
    if (!q) {
      g.accum = g.accum.add(dv ?? vec3.zero())
      q = g.p0.add(g.accum)
    }
    if (g.kind === "slide") {
      const d = q.sub(g.p0)
      this.foot = this.clampFoot(g.foot0.add(new vec3(d.x, 0, d.z)), this.rot())
    } else {
      // Swing it around the base's centre: the yaw follows the hand's angle around it.
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
    const kind = this.grab.kind
    this.grab = null
    if (kind === "lift") {
      this.shadeReleasedAt = getTime()
      this.lowerShade()
      this.ctx.log("lamp:shadeRelease")
      return
    }
    this.ctx.log("lamp:release")
    if (this.pose === "rest") this.startDrop()
  }

  /** Lower the shade back onto its seat (quicker from lower down). */
  private lowerShade(): void {
    if (this.shadeLift <= 0) {
      this.shadeLift = 0
      this.settle = null
      this.shadeLeft = false
      return
    }
    const k = this.shadeLift / SHADE_LIFT_CM
    this.settle = {t: 0, from: this.shadeLift, dur: SHADE_SETTLE_S * (0.55 + 0.45 * k)}
  }

  /**
   * The foot switch was pinched: a soft click from the switch and its button goes down; the lamp
   * turns on (the current leaves the switch, the rail shows Brightness and Warmth) or off.
   */
  private onSwitch(): void {
    if (this.state !== "landed" || !this.light || !this.model) return
    const on = !this.light.isOn
    this.ctx.log("lamp:switch")
    this.buttonFrom = this.buttonDepth
    this.buttonT = 0
    this.buttonOn = on
    this.ctx.sound("click", this.model.switchButtonTop())
    if (on) {
      this.ctx.rail.setMode("on")
      this.light.turnOn()
      this.ctx.log("lamp:on")
    } else {
      this.light.turnOff()
      this.ctx.rail.setMode("rest")
      this.showCaption(LAMP_CAPTIONS.press)
      this.ctx.log("lamp:off")
    }
  }

  private clampFoot(target: vec3, rot: quat): vec3 {
    return clampFoot(this.foot0, target, rot, this.scale, this.surf)
  }

  private unclampFoot(foot: vec3, rot: quat): vec3 {
    return unclampFoot(this.foot0, foot, rot, this.scale, this.surf)
  }

  // =====================================================================================
  // Contact glow, hover disc, trail
  // =====================================================================================

  private buildGlowAndDisc(): void {
    // Empty holders: their meshes are made once the landed scale is known (meshGlowAndDisc).
    this.contactGlowMat = this.glowMat()
    this.contactGlow = this.node(this.root, "LampContactGlow", vec3.zero())
    this.contactGlow.enabled = false
    this.discMat = this.glowMat()
    this.disc = this.node(this.root, "LampHoverDisc", vec3.zero())
    this.disc.enabled = false
  }

  /** The glow's and disc's meshes at the landed scale (built once the scale is known). */
  private meshGlowAndDisc(): void {
    if (!this.contactGlow || this.contactGlow.getChildrenCount() > 0) return
    // The contact glow hugs the base disc only (the cord lies on the table, it does not stand on it).
    const ring: vec2[] = []
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2
      ring.push(new vec2(G.baseR * Math.cos(a), G.baseR * Math.sin(a)))
    }
    spawnMesh(this.contactGlow, "Glow", contactGlowKit(footprintOutlineXY({pts: ring, center: vec2.zero()}, this.scale)).build(), this.ctx.glowMat, undefined, this.contactGlowMat)
    // A little wider than the base.
    this.discR = G.baseR * this.scale * 1.6
    spawnMesh(this.disc, "Disc", hoverDiscKit(this.discR).build(), this.ctx.glowMat, undefined, this.discMat)
  }

  private updateGlowAndDisc(): void {
    if (!this.contactGlow || !this.disc) return
    if (this.state === "launch") return
    this.meshGlowAndDisc()
    const tr = this.replica.getTransform()
    const fw = tr.getWorldTransform().multiplyPoint(vec3.zero())
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

  /** Whether everything that must stop before the flight home has stopped (the light, the parts). */
  private readyToFly(): boolean {
    return this.sEff <= 0 && (!this.light || this.light.isOff) && this.shadeLift <= 0 && !this.settle
  }

  private updateReturn(dt: number): void {
    if (this.retWaiting) {
      this.t = 0
      // The parts gather (twice the take-apart rate) while the light fades.
      this.sEff = Math.max(0, this.sEff - 2 * APART_RATE * dt)
      this.updateButton(dt)
      this.updateShade(dt)
      if (!this.readyToFly()) return
      this.retWaiting = false
      this.retFrom = {rot: this.replica.getTransform().getWorldRotation(), h: this.h}
      this.t = RET_READY
      this.ctx.log("lamp:ready")
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
      // It grows back to scale 1 on the way home.
      tr.setWorldScale(vec3.one().uniformScale(this.scale + (1 - this.scale) * u))
      // Back to edges of light so it can melt into the real lamp.
      this.shellFill = 1 - easeOutCubic((t - RET_FLY0) / 0.4)
      this.shellRim = 0.3 + 0.6 * (1 - this.shellFill)
      if (!this.retFlags.flight) {
        this.retFlags.flight = true
        this.ctx.sound("flight", tr.getWorldPosition())
      }
      this.ctx.moveSound("flight", tr.getWorldPosition())
    } else {
      // It sinks into the real lamp and melts.
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
      this.ctx.log("lamp:home")
      this.clear()
    }
  }

  // =====================================================================================
  // Rail and caption placement
  // =====================================================================================

  /** Slider rows showing above "Put it back". */
  private railRows(): number {
    return this.ctx.rail.getMode() === "on" ? 3 : 1
  }

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
    const settled = !this.ctx.rail.isDragging() && this.sEff <= 0.001 && this.ctx.rail.getValue("apart") <= 0.001 && this.pose === "rest" && !this.grab
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
    if (this.caption && this.captionAt && this.railShift === this.railShiftTarget && this.railFwd === this.railFwdTarget) {
      const want = this.captionAnchor(this.railRows())
      if (want.distance(this.captionAt) > 2) this.showCaption(this.caption)
    }
  }

  /** Snap the rail's place now (on landing, before the rail and caption appear). */
  private snapRailShift(): void {
    const want = this.findRailShift()
    this.railSide = want.side
    this.railShift = this.railShiftTarget = want.shift
    this.railFwd = this.railFwdTarget = want.fwd
    this.railCheckT = 0.25
    print(`Cutaway: lamp rail on the ${want.side > 0 ? "right" : "left"}, ${want.shift} cm further out and ${want.fwd} cm nearer (reaches ${want.reach.toFixed(1)} cm from the copy's centre in view)`)
  }

  /**
   * Where the rail stands: for each side of the copy and each step towards the user (0–36 cm), the
   * smallest step out (0–90 cm in 3 cm steps) at which the rail's full layout (all three slider
   * rows, so it never has to move when the lamp comes on) and its caption clear the copy's meshes
   * from the user's eye, and the foot switch stays uncovered; of those, the most compact. The cord
   * itself lies on the table and may pass under it.
   */
  private findRailShift(): {side: number; shift: number; fwd: number; reach: number} {
    const none = {side: this.railSide, shift: 0, fwd: 0, reach: 0}
    const eye = this.ctx.camPos()
    const F = viewFrame(eye, this.stageCenter())
    const copy: {h: vec2[]; x0: number; x1: number; y0: number; y1: number}[] = []
    for (const b of this.meshBoxes((p) => p !== "LampCord")) {
      const h = hull2(b.map((q) => toView(F, q)))
      copy.push({h, x0: Math.min(...h.map((q) => q.x)), x1: Math.max(...h.map((q) => q.x)), y0: Math.min(...h.map((q) => q.y)), y1: Math.max(...h.map((q) => q.y))})
    }
    if (!copy.length) return none
    const rows = 3
    const top = 4.3 + 6.2 * (rows - 1)
    const unitAt = (p: vec3, k: number) => (k * F.D) / Math.max(1, p.sub(eye).dot(F.f))
    const rect = (c: vec2, u: number, x0: number, x1: number, y0: number, y1: number) => [new vec2(c.x + u * x0, c.y + u * y0), new vec2(c.x + u * x1, c.y + u * y0), new vec2(c.x + u * x1, c.y + u * y1), new vec2(c.x + u * x0, c.y + u * y1)]
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
          const shapes = [rect(toView(F, a), unitAt(a, LampRail.scaleAt(a, eye)), -8.5, 8.5, -7, top + 0.5), rect(toView(F, ca), unitAt(ca, Math.min(6, Math.max(0.3, ca.distance(eye) / dd))), -CAPTION_HALF_W, CAPTION_HALF_W, -4.8, 0.3)]
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
    const reach = G.baseR * this.scale
    return c.add(toUser.uniformScale(reach + 13 + this.railFwd)).add(right.uniformScale(this.railSide * (reach + 4 + this.railShift))).add(new vec3(0, 2, 0))
  }

  /** The caption sits right above the rail; `rows` = slider rows showing above "Put it back". */
  private captionAnchor(rows: number): vec3 {
    const head = this.ctx.camPos()
    const rail = this.railAnchor()
    const k = LampRail.scaleAt(rail, head)
    return rail.add(new vec3(0, k * (4.1 + 6.2 * (rows - 1) + 5), 0))
  }

  private replicaCenter(): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(CENTER)
  }

  private lowestWorldY(): number {
    return hullLowestY(HULL, this.replica.getTransform().getWorldTransform())
  }

  /** Where the rail's reference point is when the copy stands on the table here: the rail and captions stay put while it hovers or bobs. */
  private stageCenter(): vec3 {
    if (this.state === "launch" || this.pose === "fly" || !this.surf) return this.replicaCenter()
    return this.pivotFor(this.foot, this.yaw, this.restGap).add(new vec3(0, RAIL_Y * this.scale, 0))
  }
}
