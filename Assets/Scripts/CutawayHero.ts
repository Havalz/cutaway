/**
 * Camera hero stage ("Bring it closer"), see devpost/camera-hero.md.
 *
 * A glowing copy of the DSLR peels off the real camera, the lens rises out of its bag and
 * twists onto the body in mid-air, and the assembled copy flies to the coffee table, growing
 * from 1x to 3x. There the user turns it (yaw only), takes it apart with a slider, focuses a
 * live thin-lens light path and takes a photo whose blur is the sensor's blur. "Put it back"
 * flies it home; Reset clears it from any state.
 *
 * Units: replica parts are authored in the replica's local space at 1x (cm, pivot at the lens
 * mount, lens along +Z, Y up). The landed replica is scaled 3x, so world cm = 3 × local cm.
 * The optics (f, d_o, d_i, L, h, c) are in world cm, measured along the optical axis.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {CutawayHeroUI} from "./CutawayHeroUI"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {GlowPath, MeshKit, setFade, spawnMesh, TrailRibbon} from "./CutawayGeometry"
import {ENERGY, ink, keyWord, UI_WHITE} from "./CutawayStyle"
import {clamp01, easeIn, easeInOutCubic, easeOutCubic, faceToward} from "./CutawayTween"

export type HeroSound = "lift" | "bayonet" | "flight" | "land" | "part" | "mirror" | "shutter" | "print"
export type HeroState = "none" | "launch" | "landed" | "light" | "returning"

export interface HeroContext {
  parent: SceneObject
  glowMat: Material
  shellMat: Material
  bodyMesh: RenderMesh
  lensMesh: RenderMesh
  labels: CutawayLabelsUI
  rail: CutawayHeroUI
  camPos: () => vec3
  camera: Camera | null
  /** The real camera's bounds (world center + size). */
  realBounds: () => {center: vec3; size: vec3}
  /** Direction the real camera's lens points (horizontal). */
  realFacing: vec3
  /** Centre of the coffee table's top surface. */
  table: () => vec3
  /** The lens inside its bag. */
  bag: () => vec3
  sound: (s: HeroSound, p: vec3) => void
  /** Move a (looping) sound with its source without restarting it. */
  moveSound: (s: HeroSound, p: vec3) => void
  log: (p: string) => void
  caption: (text: string | null, topCenter?: vec3) => void
}

export interface HeroOptics {
  d_o: number
  d_i: number
  L: number
  h_i: number
  c: number
  sharp: boolean
}

export interface HeroPartInfo {
  key: string
  label: string
  /** World displacement from the part's assembled position (cm). */
  offset: number
  /** The displacement's component along the optical axis (cm). */
  alongAxis: number
  labelShown: boolean
}

// ---------------- Optics (world cm, replica space at 3x) ----------------
export const HERO_F = 15
export const HERO_N = 2.8
export const HERO_A = HERO_F / HERO_N
export const HERO_H_O = 5
export const HERO_D_MIN = 25
export const HERO_D_MAX = 90
export const HERO_L_MIN = 16
export const HERO_L_MAX = 40
/** Blur circles at or under this read as sharp (cm on the 3x sensor, ≈ 0.1 mm on a real one). */
const SHARP_C = 0.3

export function imageDistance(d_o: number): number {
  return 1 / (1 / HERO_F - 1 / d_o)
}
export function blurCircle(d_o: number, L: number): number {
  const di = imageDistance(d_o)
  return (HERO_A * Math.abs(L - di)) / di
}

// ---------------- Replica geometry (local cm at 1x) ----------------
const SCALE = 3
const BODY_MIN_Y = -4.28
const BODY_CENTER = new vec3(-1.36, 1.135, -3.7)
const LENS_CENTER_Z = 4.97
const LIFT_CM = 10
/** Thin-lens plane, measured from the barrel's rear. */
const PLANE_IN_BARREL = 2.0
const BARREL_MIN = 0.9
const BARREL_APART = 3.0
const SENSOR_Z = -4.4
const SENSOR_APART_Z = -5.6
const L_APART = SCALE * (BARREL_APART + PLANE_IN_BARREL - SENSOR_APART_Z)
const MIRROR_Z = -2.0
const MIRROR_HALF = 2.0
const SENSOR_W = 3.6
const SENSOR_H = 2.4

// ---------------- Timeline (s) ----------------
const T_RISE = 0.7
const T_SEAT = 0.9
const T_TWIST = 1.1
const T_FLY0 = 1.12
const T_FLY1 = 2.87
const T_FILL = 0.4
const VF_BEAT = 3.0
const MIRROR_UP_DUR = 0.3
const LIVE_AT = VF_BEAT + 0.4
const RET_ASSEMBLE = 0.6
const RET_FLY0 = 0.7
const RET_FLY1 = 2.3
const RET_END = 3.0

const LIGHT = ENERGY.light
const SIGNAL = ENERGY.signal
const DEG = Math.PI / 180
const ROOT2 = Math.SQRT1_2

interface Part {
  key: string
  label: string
  so: SceneObject
  rest: vec3
  apart: vec3
  a: number
  w: number
  e: number
  freed: boolean
  mat: Material | null
  /** Label anchor on the part (part-local) and where the words go (replica-local offset from the anchor). */
  anchor: vec3
  labelOff: vec3
}

interface Beam {
  so: SceneObject
  rmv: RenderMeshVisual
}

function flatDir(v: vec3): vec3 {
  const f = new vec3(v.x, 0, v.z)
  return f.length > 1e-4 ? f.normalize() : new vec3(0, 0, -1)
}

function bezier(a: vec3, c: vec3, b: vec3, t: number): vec3 {
  const u = 1 - t
  return a.uniformScale(u * u).add(c.uniformScale(2 * u * t)).add(b.uniformScale(t * t))
}

function circle(center: vec3, u: vec3, v: vec3, r: number, n: number): vec3[] {
  const pts: vec3[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push(center.add(u.uniformScale(Math.cos(a) * r)).add(v.uniformScale(Math.sin(a) * r)))
  }
  return pts
}

/**
 * The subject's silhouette (an upright arrow, base at the origin, tip at +1) drawn as N additive
 * copies spread over a disc. Moving the copies apart is the blur; only transforms change.
 */
class BlurImage {
  readonly so: SceneObject
  readonly mat: Material
  private copies: SceneObject[] = []
  private offsets: vec2[] = []

  constructor(parent: SceneObject, name: string, material: Material, color: vec4, rings: number) {
    this.so = global.scene.createSceneObject(name)
    this.so.setParent(parent)
    // Copies spread evenly over the blur disk on a sunflower spiral (even density, no lattice).
    const count = 1 + 3 * rings * (rings + 1)
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt((i + 0.5) / count)
      const a = i * 2.399963
      this.offsets.push(new vec2(Math.cos(a) * r, Math.sin(a) * r))
    }
    const k = new MeshKit()
    // The glow material blends Add with source alpha, and ink() premultiplies, so a copy's light
    // goes with k²: k = 1/√N gives each copy 1/N of the light and N stacked copies exactly 1.
    const c = ink(color, 1 / Math.sqrt(this.offsets.length))
    // Centred on the axis: base at -0.5, tip at +0.5.
    k.addRectXY(-0.07, -0.5, 0.07, 0.16, c)
    const base = 0.1
    const top = 0.5
    const hw = 0.24
    const n = new vec3(0, 0, 1)
    const i0 = k.vert(new vec3(-hw, base, 0), n, c)
    const i1 = k.vert(new vec3(hw, base, 0), n, c)
    const i2 = k.vert(new vec3(0, top, 0), n, c)
    k.tri(i0, i1, i2)
    const mesh = k.build()
    this.mat = material.clone()
    this.mat.mainPass.twoSided = true
    this.offsets.forEach((_, i) => {
      const so = global.scene.createSceneObject(name + "Copy" + i)
      so.setParent(this.so)
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = mesh
      rmv.mainMaterial = this.mat
      this.copies.push(so)
    })
    setFade(this.mat, 0)
  }

  /** Height `h` (negative = upside down), blur circle diameter `c`, in the parent's units. */
  update(h: number, c: number, alpha: number): void {
    const s = Math.max(1e-4, Math.abs(h))
    this.copies.forEach((so, i) => {
      const o = this.offsets[i]
      const tr = so.getTransform()
      tr.setLocalPosition(new vec3((o.x * c) / 2, (o.y * c) / 2, 0))
      tr.setLocalScale(new vec3(s, h >= 0 ? s : -s, 1))
    })
    // Each copy carries 1/N of the light, so a sharp image adds up to full brightness. Spread
    // wide, the same light becomes too faint to read on an additive display, so the copies get
    // brighter as the blur grows (up to 4x when the blur circle is as big as the image).
    // setFade's factor also lands squared, hence √gain.
    const gain = 1 + 3 * Math.min(1, c / Math.max(1e-3, s))
    setFade(this.mat, alpha * Math.sqrt(gain))
  }
}

/** The camera hero stage. Owned by CutawayMain; one instance, created on launch, cleared on finish/Reset. */
export class CameraHero {
  state: HeroState = "none"
  /** Test hook: freeze the stage's timeline (for screenshots of one beat). */
  hold = false

  private root: SceneObject
  private replica: SceneObject
  private layer: LayerSet
  private bodySo: SceneObject
  private bodyMat: Material
  private barrelSo: SceneObject
  private barrelMat: Material
  private elementsSo: SceneObject
  private elementSos: SceneObject[] = []
  private elementsMat: Material
  private apertureSo: SceneObject
  private apertureMat: Material
  private parts: Part[] = []
  private lensPart: Part
  private elementsPart: Part
  private aperturePart: Part
  private bodyPart: Part
  private mirrorPart: Part
  private prismPart: Part
  private viewfinderPart: Part
  private shutterPart: Part
  private sensorPart: Part
  private mirrorPlate: SceneObject
  private curtains: SceneObject[] = []
  private sensorImage: BlurImage
  private sensorFlash: BlurImage

  private t = 0
  private s = 0
  private shellFill = 0
  private shellRim = 0.9
  private globalFade = 1
  // Launch / flight geometry (world)
  private head0: vec3
  private realCenter: vec3
  private rStart: quat
  private pStart: vec3
  private pMeet: vec3
  private pLand: vec3
  private ctrl: vec3
  private rLand: quat
  private yaw = 0
  private bagRot: quat
  private trail: TrailRibbon | null = null
  private trailPts: vec3[] = []
  private thread: GlowPath | null = null
  private threadT = -1
  private pulse: SceneObject | null = null
  private pulseMat: Material | null = null
  private tableRing: SceneObject | null = null
  private tableRingMat: Material | null = null
  private brackets: SceneObject | null = null
  private bracketMat: Material | null = null
  private landed = false
  // Returning
  private retFrom: {s: number; rot: quat; lightK: number} | null = null
  // Light path
  private lightT = 0
  private live = false
  private d_o = 50
  private L = L_APART
  private mirrorUp = 0
  private subject: SceneObject | null = null
  private subjectMat: Material | null = null
  private raysSo: SceneObject | null = null
  private beams: Beam[] = []
  private beamMesh: RenderMesh | null = null
  private rayMat: Material | null = null
  private rayFaintMat: Material | null = null
  private bubble: SceneObject | null = null
  private bubbleFace: SceneObject | null = null
  private bubbleMat: Material | null = null
  private bubbleImage: BlurImage | null = null
  private bubbleFlash: BlurImage | null = null
  private bubbleSharp: SceneObject | null = null
  private bubbleSharpMat: Material | null = null
  private bubbleLeader: Beam | null = null
  private sharpK = 0
  private captionKey = ""
  private captionHoldT = 0
  // Photo
  private shotT = -1
  private print: SceneObject | null = null
  private printT = 0
  private printBlur = -1
  private printH = 0
  private oldPrints: {so: SceneObject; t: number; mats: Material[]}[] = []
  private printMats: Material[] = []
  private printImage: BlurImage | null = null
  private flashT = -1
  // Turning / subject drag
  private turnStart: {p: vec3; yaw: number; right: vec3} | null = null
  private turnAccum = vec3.zero()
  private subjectDrag: {p: vec3; d: number; axis: vec3} | null = null
  private subjectAccum = vec3.zero()
  private landTime = -1
  private lastLandPos: vec3 | null = null
  // Leaving the light path (the take-apart slider dragged back below 1)
  private exitT = -1
  private exitMirror = 0
  // Test hooks: when the launch started and the replica came to rest (getTime()).
  private launchedAt = -1
  private landedAt = -1

  constructor(private ctx: HeroContext) {}

  // =====================================================================================
  // Public API
  // =====================================================================================

  get isOut(): boolean {
    return this.state !== "none"
  }

  /** Pinch "Bring it closer": build the copy at the real camera and start the launch. */
  launch(): void {
    if (this.state !== "none") return
    this.build()
    this.state = "launch"
    this.t = 0
    this.landed = false
    this.flags = {click: false, flight: false}
    this.retFlags = {click: false, flight: false}
    this.shotFlags = {flash: false, print: false}
    this.globalFade = 1
    this.trailPts = []
    this.landTime = -1
    this.lastLandPos = null
    this.exitT = -1
    this.launchedAt = getTime()
    this.landedAt = -1
    this.s = 0
    this.barrelFill = 1
    this.bodyFill = 1
    this.captionHoldT = 0
    this.sharpK = 0
    this.head0 = this.ctx.camPos()
    const rb = this.ctx.realBounds()
    this.realCenter = rb.center
    const facing = flatDir(this.ctx.realFacing)
    this.rStart = quat.lookAt(facing, vec3.up())
    this.pStart = this.realCenter.sub(this.rStart.multiplyVec3(BODY_CENTER))
    const bag = this.ctx.bag()
    this.pMeet = this.clearOfHead(vec3.lerp(this.realCenter, bag, 0.5).add(new vec3(0, 30, 0)), 40)
    const table = this.ctx.table()
    this.pLand = table.add(new vec3(0, LIFT_CM - BODY_MIN_Y * SCALE, 0))
    // Facing rule: the optical axis runs across the view (lens to the user's left), so the light
    // path later reads sideways, never toward the eye.
    const F = flatDir(table.sub(this.head0))
    const right = F.cross(vec3.up()).normalize()
    this.rLand = quat.lookAt(right.uniformScale(-1), vec3.up())
    this.yaw = 0
    this.ctrl = this.flightControl()
    this.bagRot = quat.lookAt(vec3.up(), facing)
    this.ctx.sound("lift", this.realCenter)
    this.flashBrackets(rb)
    this.ctx.rail.setMode("none", true)
    this.ctx.log("hero:launch")
    this.applyLaunch()
  }

  /** "Put it back": reassemble, fly home, melt into the real camera. */
  putBack(): void {
    if (this.state !== "landed" && this.state !== "light") return
    this.retFrom = {s: this.s, rot: this.replica.getTransform().getWorldRotation(), lightK: this.state === "light" ? 1 : 0}
    this.state = "returning"
    this.t = 0
    this.ctx.rail.setMode("none")
    this.hideAllLabels()
    this.ctx.caption(null)
    this.captionKey = ""
    this.ctx.log("hero:putBack")
  }

  /** Take a photo (live view only). */
  photo(): void {
    if (this.state !== "light" || !this.live || this.shotT >= 0) return
    this.shotT = 0
    this.ctx.sound("shutter", this.partWorld(this.shutterPart))
    this.ctx.log("hero:photo")
  }

  /** Reset: remove everything instantly, from any state. */
  clear(): void {
    if (this.root) this.root.destroy()
    this.root = null
    this.state = "none"
    this.trail = null
    this.thread = null
    this.pulse = null
    this.tableRing = null
    this.brackets = null
    this.subject = null
    this.raysSo = null
    this.beams = []
    this.bubble = null
    this.bubbleLeader = null
    this.print = null
    this.printImage = null
    this.oldPrints = []
    this.parts = []
    this.elementSos = []
    this.curtains = []
    this.shotT = -1
    this.flashT = -1
    this.printBlur = -1
    this.live = false
    this.exitT = -1
    this.ctx.rail.setMode("none", true)
    this.ctx.caption(null)
    this.captionKey = ""
  }

  update(dt: number): void {
    if (this.state === "none") return
    if (this.hold) dt = 0
    this.t += dt
    switch (this.state) {
      case "launch":
        this.applyLaunch()
        if (this.t >= T_FLY1) this.land()
        break
      case "landed":
        this.updateLanded(dt)
        break
      case "light":
        this.updateLight(dt)
        break
      case "returning":
        this.updateReturn(dt)
        break
    }
    // updateReturn may have cleared the stage.
    if ((this.state as HeroState) === "none") return
    this.updateThread(dt)
    this.updateTrail()
    this.updateBrackets()
    this.updateShell()
    this.updatePrints(dt)
    this.placeRail()
  }

  // ---------------- Test hooks / read-only state ----------------

  setApart(v: number): void {
    this.ctx.rail.setApartValue(v)
  }

  setFocusL(L: number): void {
    this.ctx.rail.setFocusValue((L - HERO_L_MIN) / (HERO_L_MAX - HERO_L_MIN))
    this.L = Math.max(HERO_L_MIN, Math.min(HERO_L_MAX, L))
  }

  setSubjectDistance(d: number): void {
    this.d_o = Math.max(HERO_D_MIN, Math.min(HERO_D_MAX, d))
  }

  getLightPhase(): "none" | "viewfinder" | "mirrorUp" | "live" {
    if (this.state !== "light") return "none"
    if (this.lightT < VF_BEAT) return "viewfinder"
    return this.live ? "live" : "mirrorUp"
  }

  /** True when the rays end on the sensor (mirror up), false while the mirror sends them up. */
  raysReachSensor(): boolean {
    return this.state === "light" && this.mirrorUp > 0.5
  }

  isSubjectShown(): boolean {
    return !!this.subject && this.subject.enabled
  }

  getOptics(): HeroOptics {
    const di = imageDistance(this.d_o)
    const c = blurCircle(this.d_o, this.L)
    return {d_o: this.d_o, d_i: di, L: this.L, h_i: (HERO_H_O * this.L) / this.d_o, c, sharp: c <= SHARP_C}
  }

  getPrint(): {shown: boolean; blur: number; height: number} {
    return {shown: !!this.print && this.print.enabled, blur: this.printBlur, height: this.printH}
  }

  getShotPhase(): number {
    return this.shotT
  }

  isSensorFlashing(): boolean {
    return this.flashT >= 0 && this.flashT < 0.6
  }

  getReplica(): SceneObject | null {
    return this.state === "none" ? null : this.replica
  }

  getInfo(): {state: HeroState; scale: number; position: vec3; up: vec3; lowestY: number; tableY: number; threadOk: boolean; landSound: vec3 | null} {
    const tr = this.replica && this.state !== "none" ? this.replica.getTransform() : null
    const table = this.ctx.table()
    return {
      state: this.state,
      scale: tr ? tr.getWorldScale().x : 0,
      position: tr ? tr.getWorldPosition() : vec3.zero(),
      up: tr ? tr.up : vec3.up(),
      lowestY: tr ? this.lowestWorldY() : 0,
      tableY: table.y,
      threadOk: this.threadConnected(),
      landSound: this.lastLandPos
    }
  }

  /** Every named part: how far it moved from its assembled place, and whether its label shows. */
  getParts(): HeroPartInfo[] {
    if (this.state === "none") return []
    const axis = this.replica.getTransform().forward
    const named = [this.elementsPart, this.aperturePart, this.parts.find((p) => p.key === "mount"), this.mirrorPart, this.prismPart, this.viewfinderPart, this.shutterPart, this.sensorPart]
    const out: HeroPartInfo[] = []
    for (const p of named) {
      if (!p) continue
      const now = this.partWorld(p)
      const rest = this.restWorld(p)
      const d = now.sub(rest)
      out.push({key: p.key, label: p.label, offset: d.length, alongAxis: d.dot(axis), labelShown: this.ctx.labels.isShown("hero_" + p.key)})
    }
    // The barrel and body (not labelled) are reported too, for the "back to rest" check.
    for (const p of [this.lensPart, this.bodyPart]) {
      const d = this.partWorld(p).sub(this.restWorld(p))
      out.push({key: p.key, label: p.label, offset: d.length, alongAxis: d.dot(axis), labelShown: false})
    }
    return out
  }

  getApart(): number {
    return this.s
  }

  /** When the last launch started and when the replica came to rest (getTime(), -1 if not yet). */
  getTimes(): {launchedAt: number; landedAt: number} {
    return {launchedAt: this.launchedAt, landedAt: this.landedAt}
  }

  getYawDeg(): number {
    return this.yaw / DEG
  }

  // =====================================================================================
  // Build
  // =====================================================================================

  private build(): void {
    this.clear()
    this.root = global.scene.createSceneObject("HeroStage")
    this.root.setParent(this.ctx.parent)
    const rtr = this.root.getTransform()
    rtr.setWorldPosition(vec3.zero())
    rtr.setWorldRotation(quat.quatIdentity())
    rtr.setWorldScale(vec3.one())

    this.layer = LayerSet.makeUnique()
    if (this.ctx.camera) this.ctx.camera.renderLayer = this.ctx.camera.renderLayer.union(this.layer)

    this.replica = this.node(this.root, "HeroReplica", vec3.zero())
    this.buildLightRig()
    // The real camera's own shell (body) and lens, from the imported model.
    this.bodySo = this.node(this.replica, "ReplicaBody", vec3.zero())
    this.bodyMat = this.shellInstance()
    this.meshVisual(this.bodySo, this.ctx.bodyMesh, this.bodyMat)
    this.barrelSo = this.node(this.replica, "ReplicaLens", vec3.zero())
    this.barrelMat = this.shellInstance()
    this.meshVisual(this.barrelSo, this.ctx.lensMesh, this.barrelMat)

    this.buildParts()
    this.buildTurn()
  }

  private node(parent: SceneObject, name: string, localPos: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(localPos)
    return so
  }

  /** The imported meshes are in metres (the glTF importer puts x100 on the prefab root), so the
   *  visual sits on a x100 child and the part node itself stays in centimetres. */
  private meshVisual(so: SceneObject, mesh: RenderMesh, mat: Material): void {
    const child = this.node(so, so.name + "Mesh", vec3.zero())
    child.getTransform().setLocalScale(vec3.one().uniformScale(100))
    const rmv = child.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = mat
    so.layer = this.layer
    child.layer = this.layer
  }

  private shellInstance(): Material {
    const m = this.ctx.shellMat.clone()
    return m
  }

  /** One key light and a soft fill, parented to the replica, lighting only the replica's layer. */
  private buildLightRig(): void {
    const rig = this.node(this.replica, "HeroLightRig", vec3.zero())
    const key = this.node(rig, "KeyLight", vec3.zero())
    key.getTransform().setLocalRotation(quat.lookAt(new vec3(0.45, -0.75, -0.5).normalize(), vec3.up()))
    const kl = key.createComponent("Component.LightSource") as LightSource
    kl.lightType = LightType.Directional
    kl.color = new vec3(1, 0.96, 0.9)
    kl.intensity = 1.2
    kl.renderLayer = this.layer
    const fill = this.node(rig, "FillLight", vec3.zero())
    const fl = fill.createComponent("Component.LightSource") as LightSource
    fl.lightType = LightType.Ambient
    fl.color = new vec3(0.85, 0.9, 1)
    fl.intensity = 0.5
    fl.renderLayer = this.layer
    key.layer = this.layer
    fill.layer = this.layer
  }

  private glowMat(): Material {
    const m = this.ctx.glowMat.clone()
    m.mainPass.twoSided = true
    return m
  }

  private part(key: string, label: string, so: SceneObject, rest: vec3, apart: vec3, a: number, w: number, mat: Material | null, anchor: vec3, labelOff: vec3): Part {
    const p: Part = {key, label, so, rest, apart, a, w, e: 0, freed: false, mat, anchor, labelOff}
    so.getTransform().setLocalPosition(rest)
    this.parts.push(p)
    return p
  }

  /** Code-made parts: clean forms drawn as light (bright rims and edges, faint faces). */
  private buildParts(): void {
    const R = this.replica
    const tube = 0.035
    // ---- Lens (the model's barrel): unlock twist, then forward. ----
    this.lensPart = this.part("lens", "Lens", this.barrelSo, vec3.zero(), new vec3(0, 0, BARREL_APART), 0.0, 0.3, null, vec3.zero(), vec3.zero())

    // ---- Lens elements: three glass elements spread inside the barrel. ----
    this.elementsSo = this.node(R, "HeroLensElements", new vec3(0, 0, PLANE_IN_BARREL))
    this.elementsMat = this.glowMat()
    const els = [
      {r: 2.5, t: 0.5, z: -0.8},
      {r: 2.85, t: 0.65, z: 0.05},
      {r: 2.6, t: 0.45, z: 0.85}
    ]
    for (const e of els) {
      const so = this.node(this.elementsSo, "Element", new vec3(0, 0, e.z))
      const k = new MeshKit()
      const prof = [
        [0.001, -e.t / 2],
        [e.r * 0.55, -e.t * 0.4],
        [e.r * 0.88, -e.t * 0.22],
        [e.r, -0.05],
        [e.r, 0.05],
        [e.r * 0.88, e.t * 0.22],
        [e.r * 0.55, e.t * 0.4],
        [0.001, e.t / 2]
      ]
      // Fresnel-like: the faces stay faint, the rim of the glass is bright.
      const cols = [0.05, 0.06, 0.12, 0.4, 0.4, 0.12, 0.06, 0.05].map((a) => ink(LIGHT, a))
      k.addLathe(vec3.zero(), vec3.forward(), prof, cols, 48)
      k.addTube(circle(vec3.zero(), vec3.right(), vec3.up(), e.r, 48), tube, ink(LIGHT, 0.85), 4, 50)
      spawnMesh(so, "ElementMesh", k.build(), this.ctx.glowMat, undefined, this.elementsMat)
      so.enabled = false
      this.elementSos.push(so)
    }
    this.elementsPart = this.part("elements", "Lens elements", this.elementsSo, new vec3(0, 0, PLANE_IN_BARREL), new vec3(0, 0, PLANE_IN_BARREL), 0.18, 0.24, this.elementsMat, new vec3(0, 2.85, 0.05), new vec3(0, 3.6, 0.6))

    // ---- Aperture: an iris at the lens plane (opening A = f / N). ----
    this.apertureSo = this.node(R, "HeroAperture", new vec3(0, 0, PLANE_IN_BARREL))
    this.apertureMat = this.glowMat()
    {
      const k = new MeshKit()
      const rIn = HERO_A / 2 / SCALE
      const rOut = 2.75
      k.addTube(circle(vec3.zero(), vec3.right(), vec3.up(), rOut, 48), tube, ink(LIGHT, 0.7), 4, 50)
      const blades = 7
      for (let i = 0; i < blades; i++) {
        const a0 = (i / blades) * Math.PI * 2
        const a1 = a0 + 0.9
        const p0 = new vec3(Math.cos(a0) * rIn, Math.sin(a0) * rIn, 0)
        const p1 = new vec3(Math.cos(a1) * rOut, Math.sin(a1) * rOut, 0)
        k.addTube([p0, p1], tube * 0.8, ink(LIGHT, 0.55), 4, 50)
      }
      k.addTube(circle(vec3.zero(), vec3.right(), vec3.up(), rIn, 36), tube, ink(LIGHT, 0.9), 4, 50)
      k.addRing(vec3.zero(), vec3.forward(), (rIn + rOut) / 2, rOut - rIn, ink(LIGHT, 0.06), 48)
      spawnMesh(this.apertureSo, "Iris", k.build(), this.ctx.glowMat, undefined, this.apertureMat)
    }
    this.aperturePart = this.part("aperture", "Aperture", this.apertureSo, new vec3(0, 0, PLANE_IN_BARREL), new vec3(0, 0, PLANE_IN_BARREL), 0.28, 0.22, this.apertureMat, new vec3(0, -2.75, 0), new vec3(0, -3.4, 0.2))

    // ---- Body shell: lifts up and back, fades to an outline. ----
    this.bodyPart = this.part("body", "Body", this.bodySo, vec3.zero(), new vec3(0, 5.5, -3.0), 0.38, 0.24, null, vec3.zero(), vec3.zero())

    // ---- Lens mount ring. ----
    {
      const so = this.node(R, "HeroMount", vec3.zero())
      const mat = this.glowMat()
      const k = new MeshKit()
      k.addTube(circle(vec3.zero(), vec3.right(), vec3.up(), 2.75, 56), tube * 1.4, ink(UI_WHITE, 0.6), 4, 50)
      k.addTube(circle(new vec3(0, 0, -0.25), vec3.right(), vec3.up(), 2.75, 56), tube, ink(UI_WHITE, 0.35), 4, 50)
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.3
        const arc: vec3[] = []
        for (let j = 0; j <= 8; j++) {
          const b = a + (j / 8) * 0.7
          arc.push(new vec3(Math.cos(b) * 3.0, Math.sin(b) * 3.0, 0))
        }
        k.addTube(arc, tube * 1.2, ink(UI_WHITE, 0.55), 4, 50)
      }
      spawnMesh(so, "MountMesh", k.build(), this.ctx.glowMat, undefined, mat)
      this.part("mount", "Lens mount", so, vec3.zero(), new vec3(0, 0, 0.5), 0.5, 0.2, mat, new vec3(0, 3.0, 0), new vec3(0, 3.0, -0.4))
    }

    // ---- Reflex mirror: hinged at its top-back edge, 45° down to the front. ----
    {
      const hinge = new vec3(0, MIRROR_HALF * ROOT2, MIRROR_Z - MIRROR_HALF * ROOT2)
      const so = this.node(R, "HeroMirror", hinge)
      this.mirrorPlate = this.node(so, "MirrorPlate", vec3.zero())
      const mat = this.glowMat()
      const d = new vec3(0, -ROOT2, ROOT2)
      const len = MIRROR_HALF * 2
      const hw = 1.9
      const c = d.uniformScale(len / 2)
      const k = new MeshKit()
      k.addQuad(c, new vec3(hw, 0, 0), d.uniformScale(len / 2), ink(LIGHT, 0.1))
      const corners = [new vec3(-hw, 0, 0), new vec3(hw, 0, 0), d.uniformScale(len).add(new vec3(hw, 0, 0)), d.uniformScale(len).add(new vec3(-hw, 0, 0))]
      k.addTube([corners[0], corners[1], corners[2], corners[3], corners[0]], tube, ink(LIGHT, 0.85), 4, 50)
      k.addTube([corners[0].add(d.uniformScale(0.6)), corners[1].add(d.uniformScale(1.6))], tube * 0.7, ink(LIGHT, 0.35), 4, 50)
      spawnMesh(this.mirrorPlate, "MirrorMesh", k.build(), this.ctx.glowMat, undefined, mat)
      this.mirrorPart = this.part("mirror", "Reflex mirror", so, hinge, hinge.add(new vec3(0, 0, 0.3)), 0.55, 0.2, mat, d.uniformScale(len), new vec3(0, -2.6, 0.8))
    }

    // ---- Pentaprism and focusing screen (above the mirror). ----
    {
      const center = new vec3(0, 3.0, MIRROR_Z)
      const so = this.node(R, "HeroPentaprism", center)
      const mat = this.glowMat()
      const k = new MeshKit()
      const hx = 1.6
      // Cross-section in (y, z), prism-local.
      const poly = [new vec2(-1.25, 1.3), new vec2(-1.25, -1.3), new vec2(0.1, -1.75), new vec2(1.4, -0.45), new vec2(1.0, 1.0)]
      const P = (q: vec2, x: number) => new vec3(x, q.x, q.y)
      for (const x of [-hx, hx]) k.addTube(poly.concat([poly[0]]).map((q) => P(q, x)), tube, ink(LIGHT, 0.75), 4, 50)
      for (const q of poly) k.addTube([P(q, -hx), P(q, hx)], tube * 0.8, ink(LIGHT, 0.5), 4, 50)
      // Faint glass faces.
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % poly.length]
        const mid = P(new vec2((a.x + b.x) / 2, (a.y + b.y) / 2), 0)
        const along = P(b, 0).sub(P(a, 0)).uniformScale(0.5)
        k.addQuad(mid, new vec3(hx, 0, 0), along, ink(LIGHT, 0.04))
      }
      // Focusing screen: a thin plate under the prism.
      k.addTube([new vec3(-hx, -1.45, -1.3), new vec3(hx, -1.45, -1.3), new vec3(hx, -1.45, 1.3), new vec3(-hx, -1.45, 1.3), new vec3(-hx, -1.45, -1.3)], tube * 0.8, ink(LIGHT, 0.45), 4, 50)
      spawnMesh(so, "PrismMesh", k.build(), this.ctx.glowMat, undefined, mat)
      this.prismPart = this.part("prism", "Pentaprism", so, center, center.add(new vec3(0, 2.2, 0)), 0.6, 0.2, mat, new vec3(0, 1.4, -0.45), new vec3(0, 2.2, 0.6))
    }

    // ---- Viewfinder eyepiece (behind the prism). ----
    {
      const pos = new vec3(0, 3.4, -6.6)
      const so = this.node(R, "HeroViewfinder", pos)
      const mat = this.glowMat()
      const k = new MeshKit()
      k.addTube(circle(vec3.zero(), vec3.right(), vec3.up(), 0.9, 36), tube, ink(LIGHT, 0.8), 4, 50)
      k.addTube(circle(new vec3(0, 0, -0.6), vec3.right(), vec3.up(), 0.9, 36), tube, ink(LIGHT, 0.5), 4, 50)
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4
        k.addTube([new vec3(Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0), new vec3(Math.cos(a) * 0.9, Math.sin(a) * 0.9, -0.6)], tube * 0.7, ink(LIGHT, 0.4), 4, 50)
      }
      k.addLathe(new vec3(0, 0, -0.3), vec3.forward(), [[0.001, -0.15], [0.75, -0.04], [0.75, 0.04], [0.001, 0.15]], [ink(LIGHT, 0.05), ink(LIGHT, 0.35), ink(LIGHT, 0.35), ink(LIGHT, 0.05)], 32)
      spawnMesh(so, "EyepieceMesh", k.build(), this.ctx.glowMat, undefined, mat)
      this.viewfinderPart = this.part("viewfinder", "Viewfinder", so, pos, pos.add(new vec3(0, 2.2, -1.6)), 0.64, 0.2, mat, new vec3(0, 0.9, -0.3), new vec3(0, 2.0, -0.8))
    }

    // ---- Focal-plane shutter: frame and two curtains. ----
    {
      const pos = new vec3(0, 0, -3.95)
      const so = this.node(R, "HeroShutter", pos)
      const mat = this.glowMat()
      const k = new MeshKit()
      const hw = 2.0
      const hh = 1.4
      k.addTube([new vec3(-hw, -hh, 0), new vec3(hw, -hh, 0), new vec3(hw, hh, 0), new vec3(-hw, hh, 0), new vec3(-hw, -hh, 0)], tube, ink(UI_WHITE, 0.55), 4, 50)
      spawnMesh(so, "ShutterFrame", k.build(), this.ctx.glowMat, undefined, mat)
      for (let i = 0; i < 2; i++) {
        const cso = this.node(so, i === 0 ? "FirstCurtain" : "SecondCurtain", vec3.zero())
        const ck = new MeshKit()
        ck.addQuad(new vec3(0, 0, 0.02 * (i + 1)), new vec3(hw - 0.05, 0, 0), new vec3(0, hh - 0.05, 0), ink(LIGHT, 0.14))
        for (let j = 0; j < 5; j++) {
          const y = -hh + 0.1 + (j / 4) * (2 * hh - 0.2)
          ck.addTube([new vec3(-hw + 0.05, y, 0.02 * (i + 1)), new vec3(hw - 0.05, y, 0.02 * (i + 1))], tube * 0.7, ink(LIGHT, 0.45), 4, 50)
        }
        spawnMesh(cso, "CurtainMesh", ck.build(), this.ctx.glowMat, undefined, mat)
        this.curtains.push(cso)
      }
      this.shutterPart = this.part("shutter", "Shutter", so, pos, new vec3(0, 0, -4.7), 0.7, 0.2, mat, new vec3(0, -1.4, 0), new vec3(0, -2.2, 1.3))
      this.setCurtains(1, 0)
    }

    // ---- Image sensor (cyan: it turns light into signal). ----
    {
      const pos = new vec3(0, 0, SENSOR_Z)
      const so = this.node(R, "HeroSensor", pos)
      const mat = this.glowMat()
      const k = new MeshKit()
      const hw = SENSOR_W / 2
      const hh = SENSOR_H / 2
      k.addQuad(vec3.zero(), new vec3(hw, 0, 0), new vec3(0, hh, 0), ink(SIGNAL, 0.1))
      k.addTube([new vec3(-hw, -hh, 0), new vec3(hw, -hh, 0), new vec3(hw, hh, 0), new vec3(-hw, hh, 0), new vec3(-hw, -hh, 0)], tube, ink(SIGNAL, 0.9), 4, 50)
      for (let i = 1; i < 12; i++) {
        const x = -hw + (i / 12) * SENSOR_W
        k.addTube([new vec3(x, -hh, 0.01), new vec3(x, hh, 0.01)], tube * 0.35, ink(SIGNAL, 0.2), 3, 50)
      }
      for (let j = 1; j < 8; j++) {
        const y = -hh + (j / 8) * SENSOR_H
        k.addTube([new vec3(-hw, y, 0.01), new vec3(hw, y, 0.01)], tube * 0.35, ink(SIGNAL, 0.2), 3, 50)
      }
      spawnMesh(so, "SensorMesh", k.build(), this.ctx.glowMat, undefined, mat)
      const img = this.node(so, "SensorImage", new vec3(0, 0, 0.05))
      this.sensorImage = new BlurImage(img, "SensorImageBlur", this.ctx.glowMat, LIGHT, 1)
      this.sensorFlash = new BlurImage(img, "SensorFlash", this.ctx.glowMat, SIGNAL, 1)
      this.sensorImage.update(0.5, 0, 0)
      this.sensorFlash.update(0.5, 0, 0)
      this.sensorPart = this.part("sensor", "Image sensor", so, pos, new vec3(0, 0, SENSOR_APART_Z), 0.78, 0.22, mat, new vec3(0, -SENSOR_H / 2, 0), new vec3(0, -3.0, -1.8))
    }

    for (const p of this.parts) {
      if (p.mat) {
        setFade(p.mat, 0)
        p.so.enabled = false
      }
    }
  }

  /** Grab the replica: it turns around the vertical axis only, never moves and never scales. */
  private buildTurn(): void {
    // Grab box centred on the assembled camera (body + lens), in replica-local cm.
    const grab = this.node(this.replica, "HeroGrab", new vec3(-1.36, 1.1, 1.2))
    const col = grab.createComponent("Physics.ColliderComponent") as ColliderComponent
    const box = Shape.createBoxShape()
    box.size = new vec3(14.5, 11.5, 18)
    col.shape = box
    col.debugDrawEnabled = false
    const inter = grab.createComponent(Interactable.getTypeName()) as Interactable
    inter.enableInstantDrag = true
    inter.onDragStart.add((e) => {
      if (this.state !== "landed" && this.state !== "light") return
      const head = this.ctx.camPos()
      const F = flatDir(this.replica.getTransform().getWorldPosition().sub(head))
      this.turnAccum = vec3.zero()
      this.turnStart = {p: e.interactor.planecastPoint ?? vec3.zero(), yaw: this.yaw, right: F.cross(vec3.up()).normalize()}
    })
    inter.onDragUpdate.add((e) => {
      if (!this.turnStart) return
      let p = e.interactor.planecastPoint
      if (!p) {
        this.turnAccum = this.turnAccum.add(e.dragVector ?? vec3.zero())
        p = this.turnStart.p.add(this.turnAccum)
      }
      const dx = p.sub(this.turnStart.p).dot(this.turnStart.right)
      // Like turning a lazy Susan by its near edge: moving the hand right turns the near side right.
      this.yaw = this.turnStart.yaw + dx / 22
    })
    inter.onDragEnd.add(() => (this.turnStart = null))
    this.ctx.log("hero:turnReady")
  }

  // =====================================================================================
  // Launch and land
  // =====================================================================================

  /** Control point of the flight arc: above the midpoint, pushed away from the user's head. */
  /** Keep a point at least `r` cm from the head at launch, pushed sideways away from it. */
  private clearOfHead(p: vec3, r: number): vec3 {
    const head = this.head0
    let away = new vec3(p.x - head.x, 0, p.z - head.z)
    if (away.length < 1e-3) away = flatDir(this.ctx.table().sub(head))
    away = away.normalize()
    let q = p
    for (let i = 0; i < 8 && q.distance(head) < r; i++) q = q.add(away.uniformScale(r - q.distance(head) + 2))
    return q
  }

  private flightControl(): vec3 {
    let c = vec3.lerp(this.pMeet, this.pLand, 0.5).add(new vec3(0, 35, 0))
    const head = this.head0
    for (let it = 0; it < 12; it++) {
      let worst = 1e9
      let worstP = c
      for (let i = 0; i <= 24; i++) {
        const p = bezier(this.pMeet, c, this.pLand, i / 24)
        const d = p.distance(head)
        if (d < worst) {
          worst = d
          worstP = p
        }
      }
      if (worst >= 55) break
      // Never through the head: bend the arc away from it.
      let away = worstP.sub(head)
      away = away.length > 1e-3 ? away.normalize() : new vec3(1, 0, 0)
      c = c.add(away.uniformScale(55 - worst + 10))
    }
    return c
  }

  private flashBrackets(rb: {center: vec3; size: vec3}): void {
    const so = this.node(this.root, "HeroBrackets", rb.center)
    this.bracketMat = this.glowMat()
    const k = new MeshKit()
    const h = rb.size.uniformScale(0.5).add(new vec3(1.2, 1.2, 1.2))
    const arm = (v: number) => Math.max(1.5, v * 0.35)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const p = new vec3(sx * h.x, sy * h.y, sz * h.z)
          k.addTube([p, p.add(new vec3(-sx * arm(h.x), 0, 0))], 0.12, ink(UI_WHITE, 0.9), 4, 50)
          k.addTube([p, p.add(new vec3(0, -sy * arm(h.y), 0))], 0.12, ink(UI_WHITE, 0.9), 4, 50)
          k.addTube([p, p.add(new vec3(0, 0, -sz * arm(h.z)))], 0.12, ink(UI_WHITE, 0.9), 4, 50)
        }
    spawnMesh(so, "Brackets", k.build(), this.ctx.glowMat, undefined, this.bracketMat)
    this.brackets = so
  }

  private updateBrackets(): void {
    if (!this.brackets) return
    // Flash once: in over 150 ms, out over 220 ms.
    const t = this.state === "launch" ? this.t : 1
    const a = t < 0.15 ? easeOutCubic(t / 0.15) : 1 - easeIn((t - 0.15) / 0.22)
    setFade(this.bracketMat, Math.max(0, a))
    this.brackets.getTransform().setLocalScale(vec3.one().uniformScale(1.06 - 0.06 * easeOutCubic(t / 0.15)))
    if (t > 0.4) {
      this.brackets.destroy()
      this.brackets = null
    }
  }

  private applyLaunch(): void {
    const t = this.t
    const tr = this.replica.getTransform()
    if (t < T_FLY0) {
      // Body copy peels off the real camera and rises to the meeting point.
      const k = easeOutCubic(t / T_RISE)
      const lift = new vec3(0, 6 * Math.sin(Math.PI * clamp01(t / T_RISE)), 0)
      tr.setWorldPosition(vec3.lerp(this.pStart, this.pMeet, k).add(lift.uniformScale(0.3)))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
      this.applyLensLaunch(t)
    } else {
      const u = easeInOutCubic((t - T_FLY0) / (T_FLY1 - T_FLY0))
      tr.setWorldPosition(bezier(this.pMeet, this.ctrl, this.pLand, u))
      tr.setWorldRotation(quat.slerp(this.rStart, this.rLand, u))
      tr.setWorldScale(vec3.one().uniformScale(1 + (SCALE - 1) * u))
      this.setBarrel(0, 0)
      this.ctx.moveSound("flight", tr.getWorldPosition())
      if (!this.trail) this.trail = new TrailRibbon(this.root, "HeroTrail", this.ctx.glowMat, 28, 5, ink(LIGHT, 0.9))
    }
    // The rim-only copy: edges of light until it lands.
    this.shellFill = 0
    this.shellRim = 0.9 * easeOutCubic(t / 0.25)
    if (t >= T_TWIST && !this.flags.click) {
      this.flags.click = true
      this.ctx.sound("bayonet", tr.getWorldPosition())
      this.ctx.log("hero:click")
    }
    if (t >= T_FLY0 && !this.flags.flight) {
      this.flags.flight = true
      this.ctx.sound("flight", tr.getWorldPosition())
      this.ctx.log("hero:flight")
    }
  }

  private flags = {click: false, flight: false}

  /** Lens: rises out of its bag, lines up in front of the mount, slides in and twists 45° to lock. */
  private applyLensLaunch(t: number): void {
    const btr = this.barrelSo.getTransform()
    const rtr = this.replica.getTransform()
    if (t < T_RISE) {
      const k = easeOutCubic(t / T_RISE)
      const bag = this.ctx.bag()
      // In the bag the lens stands upright (front up); its rear sits below the bag marker.
      const startRot = this.bagRot
      const startPos = bag.sub(startRot.multiplyVec3(new vec3(0, 0, LENS_CENTER_Z)))
      const endRot = rtr.getWorldRotation().multiply(quat.angleAxis(45 * DEG, vec3.forward()))
      const endPos = rtr.getWorldTransform().multiplyPoint(new vec3(0, 0, 3))
      const arc = new vec3(0, 8 * Math.sin(Math.PI * k), 0)
      btr.setWorldPosition(vec3.lerp(startPos, endPos, k).add(arc))
      btr.setWorldRotation(quat.slerp(startRot, endRot, k))
      btr.setWorldScale(vec3.one())
    } else if (t < T_SEAT) {
      const k = easeInOutCubic((t - T_RISE) / (T_SEAT - T_RISE))
      this.setBarrel(3 * (1 - k), 45)
    } else {
      const k = easeInOutCubic((t - T_SEAT) / (T_TWIST - T_SEAT))
      this.setBarrel(0, 45 * (1 - k))
    }
  }

  private setBarrel(z: number, twistDeg: number): void {
    const tr = this.barrelSo.getTransform()
    tr.setLocalPosition(new vec3(0, 0, z))
    tr.setLocalRotation(quat.angleAxis(twistDeg * DEG, vec3.forward()))
    tr.setLocalScale(vec3.one())
  }

  private land(): void {
    this.landedAt = getTime()
    this.state = "landed"
    this.landed = true
    this.landTime = 0
    this.t = 0
    const tr = this.replica.getTransform()
    tr.setWorldPosition(this.pLand)
    tr.setWorldRotation(this.rLand)
    tr.setWorldScale(vec3.one().uniformScale(SCALE))
    const table = this.ctx.table()
    this.lastLandPos = table
    this.ctx.sound("land", table)
    this.buildTableRing(table)
    this.buildThread()
    this.ctx.rail.setMode("apart")
    this.ctx.rail.setApartValue(0)
    this.ctx.log("hero:landed")
  }

  private buildTableRing(table: vec3): void {
    const so = this.node(this.root, "HeroTableRing", table.add(new vec3(0, 0.4, 0)))
    this.tableRingMat = this.glowMat()
    const k = new MeshKit()
    k.addRing(vec3.zero(), vec3.up(), 30, 0.5, ink(LIGHT, 0.55), 96)
    k.addRing(vec3.zero(), vec3.up(), 27, 6, ink(LIGHT, 0.05), 96)
    k.addRing(vec3.zero(), vec3.up(), 33, 6, ink(LIGHT, 0.03), 96)
    spawnMesh(so, "Ring", k.build(), this.ctx.glowMat, undefined, this.tableRingMat)
    this.tableRing = so
  }

  private buildThread(): void {
    const pts: vec3[] = []
    for (let i = 0; i <= 6; i++) pts.push(vec3.lerp(this.realCenter, this.pMeet, i / 6))
    const center = this.replicaCenter()
    const at = (u: number) => bezier(this.pMeet, this.ctrl, this.pLand, u)
    let prevU = 0
    for (let i = 1; i <= 40; i++) {
      const u = i / 40
      const p = at(u)
      if (p.distance(center) < 24) {
        // End exactly where the arc meets the replica (24 cm around its centre).
        let lo = prevU
        let hi = u
        for (let it = 0; it < 14; it++) {
          const m = (lo + hi) / 2
          if (at(m).distance(center) < 24) hi = m
          else lo = m
        }
        pts.push(at(lo))
        break
      }
      pts.push(p)
      prevU = u
    }
    this.thread = new GlowPath(this.root, "HeroThread", this.ctx.glowMat, pts, {radius: 0.12, color: ink(LIGHT, 0.9), halo: 0.45, sides: 6, step: 3})
    this.thread.setRange(0, 0)
    this.threadT = 0
    const ps = this.node(this.root, "HeroThreadPulse", pts[0])
    this.pulseMat = this.glowMat()
    const k = new MeshKit()
    k.addSphere(vec3.zero(), 0.35, ink(LIGHT, 0.9), 6, 10)
    k.addSphere(vec3.zero(), 1.1, ink(LIGHT, 0.12), 6, 10)
    spawnMesh(ps, "Pulse", k.build(), this.ctx.glowMat, undefined, this.pulseMat)
    this.pulse = ps
  }

  private updateThread(dt: number): void {
    if (!this.thread) return
    this.threadT += dt
    let k = 1
    if (this.state === "returning") k = 1 - clamp01((this.t - (RET_END - 0.45)) / 0.4)
    // The trail settles into the thread: it draws along the arc as the trail fades.
    const draw = easeOutCubic(this.threadT / 0.35)
    this.thread.setRange(0, draw)
    this.thread.setOpacity(0.3 * k)
    if (this.tableRing) {
      const g = easeOutCubic(this.landTime / 0.6)
      this.tableRing.getTransform().setLocalScale(vec3.one().uniformScale(0.15 + 0.85 * g))
      setFade(this.tableRingMat, (1 - 0.45 * g) * k)
    }
    this.landTime += dt
    if (this.pulse) {
      // A slow pulse travels toward the replica every 3.2 s.
      const cyc = (this.threadT % 3.2) / 2.4
      const on = cyc <= 1 && draw >= 1
      this.pulse.enabled = on
      if (on) {
        this.pulse.getTransform().setWorldPosition(this.thread.pointAt(easeInOutCubic(cyc)))
        setFade(this.pulseMat, 0.8 * Math.sin(Math.PI * cyc) * k)
      }
    }
  }

  private updateTrail(): void {
    if (!this.trail) return
    const flying = (this.state === "launch" && this.t >= T_FLY0) || (this.state === "returning" && this.t >= RET_FLY0 && this.t < RET_FLY1)
    const head = this.replicaCenter()
    if (flying) {
      if (this.trailPts.length === 0 || this.trailPts[this.trailPts.length - 1].distance(head) > 2) this.trailPts.push(head)
      if (this.trailPts.length > 28) this.trailPts.shift()
    } else if (this.trailPts.length > 0) {
      // Settling: the tail catches up with the head and fades.
      this.trailPts.shift()
      if (this.trailPts.length > 0) this.trailPts.shift()
    }
    if (this.trailPts.length < 2) {
      this.trail.setVisible(false)
      return
    }
    this.trail.setVisible(true)
    const n = this.trailPts.length
    // Soft taper (the light lands squared, so a gentle curve still fades the tail out).
    const alphas = this.trailPts.map((_, i) => Math.pow(i / (n - 1), 0.8))
    this.trail.update(this.trailPts, this.ctx.camPos().sub(head).normalize(), alphas)
  }

  // =====================================================================================
  // Landed: turn and take apart
  // =====================================================================================

  private updateLanded(dt: number): void {
    // Fill in from rim-only to the lifted textures over 400 ms.
    this.shellFill = easeOutCubic(this.t / T_FILL)
    this.shellRim = 0.9 + (0.3 - 0.9) * this.shellFill
    this.applyYaw()
    this.s = this.ctx.rail.getApartValue()
    let lightK = 0
    if (this.exitT >= 0) {
      // Leaving the light path: the lens group slides back, the mirror drops, the light fades.
      this.exitT += dt
      const k = easeInOutCubic(clamp01(this.exitT / 0.25))
      lightK = 1 - k
      this.mirrorUp = this.exitMirror * (1 - k)
      if (this.mirrorPlate) this.mirrorPlate.getTransform().setLocalRotation(quat.angleAxis(-45 * DEG * this.mirrorUp, vec3.right()))
      this.fadeLightPath(dt)
      if (this.exitT >= 0.3) {
        this.destroyLightPath(true)
        this.exitT = -1
        this.mirrorUp = 0
      }
    }
    this.applyApart(this.s, lightK)
    if (this.s >= 0.999 && !this.hold) this.enterLight()
  }

  /** "Take apart" dragged back below 1 during the light path: leave it; the parts follow the slider. */
  private exitLight(): void {
    this.state = "landed"
    this.t = Math.max(this.t, T_FILL)
    this.exitT = 0
    this.exitMirror = this.mirrorUp
    this.live = false
    this.shotT = -1
    this.flashT = -1
    this.shotFlags = {flash: false, print: false}
    this.setCurtains(0, 0)
    this.sensorFlash.update(0.5, 0, 0)
    if (this.bubbleFlash) this.bubbleFlash.update(0.5, 0, 0)
    this.ctx.rail.setMode("apart")
    this.ctx.caption(null)
    this.captionKey = ""
    this.ctx.log("hero:lightOff")
  }

  private applyYaw(): void {
    const tr = this.replica.getTransform()
    tr.setWorldPosition(this.pLand)
    tr.setWorldRotation(quat.angleAxis(this.yaw, vec3.up()).multiply(this.rLand))
    tr.setWorldScale(vec3.one().uniformScale(SCALE))
  }

  /** Separate the parts for slider value `s`; `lightK` blends the barrel toward its focus position. */
  private applyApart(s: number, lightK: number): void {
    for (const p of this.parts) {
      const raw = clamp01((s - p.a) / p.w)
      const e = easeInOutCubic(raw)
      p.e = e
      if (p !== this.lensPart && p !== this.elementsPart && p !== this.aperturePart) p.so.getTransform().setLocalPosition(vec3.lerp(p.rest, p.apart, e))
      if (raw > 0.02 && !p.freed) {
        p.freed = true
        this.ctx.sound("part", this.partWorld(p))
        this.ctx.log("hero:free:" + p.key)
      } else if (raw <= 0.0 && p.freed) {
        p.freed = false
      }
      if (p.mat) {
        const vis = p === this.aperturePart ? e : clamp01(raw / 0.35)
        p.so.enabled = vis > 0.001 || (this.state === "light" && p !== this.aperturePart)
        setFade(p.mat, p.so.enabled ? Math.max(vis, this.state === "light" ? 1 : 0) * this.globalFade : 0)
      }
    }
    // Lens: unlock (reverse twist), then forward.
    const pl = clamp01((s - this.lensPart.a) / this.lensPart.w)
    const twist = 45 * easeInOutCubic(clamp01(pl / 0.4))
    const fwd = BARREL_APART * easeInOutCubic(clamp01((pl - 0.3) / 0.7))
    let barrelZ = fwd
    let plane = barrelZ + PLANE_IN_BARREL
    if (lightK > 0) {
      const lp = SENSOR_APART_Z + this.L / SCALE
      const bz = Math.max(BARREL_MIN, lp - PLANE_IN_BARREL)
      barrelZ = barrelZ + (bz - barrelZ) * lightK
      plane = plane + (lp - plane) * lightK
    }
    this.setBarrel(barrelZ, twist)
    // Elements spread inside the barrel; the aperture opens between them.
    const ee = this.elementsPart.e
    const spread = 1 + 0.85 * ee
    const zs = [-0.8, 0.05, 0.85]
    this.elementSos.forEach((so, i) => {
      so.getTransform().setLocalPosition(new vec3(0, 0, zs[i] * spread))
      so.enabled = ee > 0.001 || lightK > 0
    })
    this.elementsSo.getTransform().setLocalPosition(new vec3(0, 0, plane))
    this.elementsSo.getTransform().setLocalRotation(quat.angleAxis(twist * DEG, vec3.forward()))
    this.apertureSo.getTransform().setLocalPosition(new vec3(0, 0, plane))
    this.apertureSo.getTransform().setLocalScale(vec3.one().uniformScale(Math.max(1e-4, this.aperturePart.e)))
    // The lens barrel turns see-through as its elements spread, so they show inside it.
    this.barrelFill = 1 - 0.6 * ee
    this.bodyFill = 1 - 0.85 * this.bodyPart.e
    this.updatePartLabels()
  }

  private barrelFill = 1
  private bodyFill = 1

  private updatePartLabels(): void {
    const labels = this.ctx.labels
    const rtr = this.replica.getTransform()
    const rot = rtr.getWorldRotation()
    const sc = rtr.getWorldScale().x
    for (const p of this.parts) {
      if (!p.mat) continue
      const id = "hero_" + p.key
      // In live view only the parts the light path is about keep their labels.
      const keep = !this.live || p.key === "elements" || p.key === "sensor"
      const want = p.e > 0.8 && this.state !== "returning" && keep
      const anchor = p.so.getTransform().getWorldTransform().multiplyPoint(p.anchor)
      const textPos = anchor.add(rot.multiplyVec3(p.labelOff.uniformScale(sc)))
      if (want && !labels.isShown(id)) labels.show(id, p.label, textPos, anchor)
      else if (want) labels.move(id, textPos, anchor)
      else if (!want && labels.isShown(id)) labels.hide(id)
    }
  }

  private hideAllLabels(): void {
    for (const p of this.parts) if (p.mat) this.ctx.labels.hide("hero_" + p.key)
  }

  // =====================================================================================
  // Light path
  // =====================================================================================

  private enterLight(): void {
    if (this.exitT >= 0) {
      this.destroyLightPath(true)
      this.exitT = -1
    }
    this.state = "light"
    this.lightT = 0
    this.live = false
    this.mirrorUp = 0
    this.d_o = 50
    this.L = L_APART
    this.ctx.rail.setFocusValue((this.L - HERO_L_MIN) / (HERO_L_MAX - HERO_L_MIN))
    this.ctx.rail.setMode("viewfinder")
    this.buildSubject()
    this.buildRays()
    this.buildBubble()
    this.setCaption("vf")
    this.ctx.log("hero:light")
  }

  private updateLight(dt: number): void {
    if (this.ctx.rail.getApartValue() < 0.98 && !this.hold) {
      this.exitLight()
      this.updateLanded(dt)
      return
    }
    this.lightT += dt
    this.shellFill = 1
    this.shellRim = 0.3
    this.applyYaw()
    this.s = 1
    if (this.live) {
      const v = this.ctx.rail.getFocusValue()
      this.L = HERO_L_MIN + (HERO_L_MAX - HERO_L_MIN) * v
    }
    this.applyApart(1, 1)
    // Viewfinder beat (mirror down), then the mirror lifts with a soft click: live view.
    if (this.lightT >= VF_BEAT && this.mirrorUp === 0) {
      this.ctx.sound("mirror", this.partWorld(this.mirrorPart))
      this.setCaption("up")
      this.captionHoldT = 2.2
      this.ctx.log("hero:mirrorUp")
    }
    this.mirrorUp = this.lightT < VF_BEAT ? 0 : Math.max(1e-4, easeInOutCubic((this.lightT - VF_BEAT) / MIRROR_UP_DUR))
    this.mirrorPlate.getTransform().setLocalRotation(quat.angleAxis(-45 * DEG * this.mirrorUp, vec3.right()))
    if (!this.live && this.lightT >= LIVE_AT) {
      this.live = true
      this.ctx.rail.setMode("light")
      this.ctx.log("hero:live")
    }
    this.updateSubject(dt)
    this.updateRays()
    this.updateBubble(dt)
    this.updateShot(dt)
    // Captions: sharp / blurry once live (after the mirror-up line has been read).
    if (this.captionHoldT > 0) this.captionHoldT -= dt
    if (this.live && this.captionHoldT <= 0 && this.shotT < 0) {
      const sharp = this.getOptics().sharp
      this.setCaption(sharp ? "sharp" : "blurry")
    }
  }

  private setCaption(key: string): void {
    if (key === this.captionKey) return
    this.captionKey = key
    const texts: {[k: string]: string} = {
      vf: keyWord("Until you shoot, a mirror sends *light* to your eye.", LIGHT),
      up: keyWord("Mirror up: now the *light* reaches the sensor.", LIGHT),
      sharp: keyWord("*Sharp.* The rays meet exactly on the sensor.", SIGNAL),
      blurry: keyWord("*Blurry.* Turn the focus until the rays meet.", LIGHT),
      pixel: keyWord("Each pixel turns light into *signal*.", SIGNAL)
    }
    // Every caption after the first comes once the rail has its light-path layout.
    this.ctx.caption(texts[key] ?? null, this.captionAnchor(key !== "vf"))
  }

  private buildSubject(): void {
    const so = this.node(this.replica, "HeroSubject", vec3.zero())
    this.subjectMat = this.glowMat()
    const k = new MeshKit()
    const h = HERO_H_O / SCALE
    // A glowing 3D arrow standing on the optical axis (centred on it), h_o tall.
    k.addTube([new vec3(0, -h / 2, 0), new vec3(0, h * 0.18, 0)], 0.06, ink(LIGHT, 0.95), 6, 50)
    k.addLathe(new vec3(0, h * 0.12, 0), vec3.up(), [[0.33, 0], [0.001, h * 0.38]], [ink(LIGHT, 0.5), ink(LIGHT, 1)], 24)
    k.addSphere(new vec3(0, h / 2, 0), 0.09, ink(LIGHT, 1), 6, 8)
    k.addSphere(new vec3(0, -h / 2, 0), 0.08, ink(LIGHT, 0.9), 6, 8)
    // Grab handle: a ring around the shaft on the axis, clearly a thing to hold.
    k.addTube(circle(new vec3(0, -h * 0.2, 0), vec3.right(), vec3.forward(), 0.55, 40), 0.045, ink(UI_WHITE, 0.85), 4, 50)
    k.addTube(circle(new vec3(0, -h * 0.32, 0), vec3.right(), vec3.forward(), 0.55, 40), 0.03, ink(UI_WHITE, 0.4), 4, 50)
    k.addSphere(new vec3(0, -h * 0.26, 0), 0.5, ink(UI_WHITE, 0.05), 6, 10)
    spawnMesh(so, "SubjectMesh", k.build(), this.ctx.glowMat, undefined, this.subjectMat)
    // Grab it to slide it along the axis (constrained, 25–90 cm from the lens).
    const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const sh = Shape.createBoxShape()
    sh.size = new vec3(1.6, h + 1.2, 1.6)
    col.shape = sh
    const inter = so.createComponent(Interactable.getTypeName()) as Interactable
    inter.enableInstantDrag = true
    inter.onDragStart.add((e) => {
      if (this.state !== "light") return
      this.subjectAccum = vec3.zero()
      this.subjectDrag = {p: e.interactor.planecastPoint ?? vec3.zero(), d: this.d_o, axis: this.replica.getTransform().forward}
    })
    inter.onDragUpdate.add((e) => {
      if (!this.subjectDrag) return
      let p = e.interactor.planecastPoint
      if (!p) {
        this.subjectAccum = this.subjectAccum.add(e.dragVector ?? vec3.zero())
        p = this.subjectDrag.p.add(this.subjectAccum)
      }
      this.d_o = Math.max(HERO_D_MIN, Math.min(HERO_D_MAX, this.subjectDrag.d + p.sub(this.subjectDrag.p).dot(this.subjectDrag.axis)))
    })
    inter.onDragEnd.add(() => (this.subjectDrag = null))
    this.subject = so
  }

  private lensPlaneZ(): number {
    return SENSOR_APART_Z + this.L / SCALE
  }

  private updateSubject(dt: number): void {
    if (!this.subject) return
    const z = this.lensPlaneZ() + this.d_o / SCALE
    const tr = this.subject.getTransform()
    tr.setLocalPosition(new vec3(0, 0, z))
    const k = easeOutCubic(this.lightT / 0.3)
    tr.setLocalScale(vec3.one().uniformScale(Math.max(1e-4, 0.6 + 0.4 * k)))
    setFade(this.subjectMat, k * this.lightFade())
    void dt
  }

  /** 1 while the light path shows; fades out as the replica reassembles. */
  private lightFade(): number {
    if (this.state === "returning") return 1 - clamp01(this.t / 0.22)
    if (this.exitT >= 0) return 1 - clamp01(this.exitT / 0.22)
    return 1
  }

  private buildRays(): void {
    this.raysSo = this.node(this.replica, "HeroRays", vec3.zero())
    const k = new MeshKit()
    k.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 1, ink(LIGHT, 0.95), 6, 50)
    k.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 2.6, ink(LIGHT, 0.14), 6, 50)
    this.beamMesh = k.build()
    this.rayMat = this.glowMat()
    this.rayFaintMat = this.glowMat()
    for (let i = 0; i < 34; i++) this.beams.push(this.makeBeam(this.raysSo, "Ray" + i))
  }

  private makeBeam(parent: SceneObject, name: string): Beam {
    const so = this.node(parent, name, vec3.zero())
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.beamMesh
    rmv.mainMaterial = this.rayMat
    so.enabled = false
    return {so, rmv}
  }

  /** Place a beam between a and b (parent-local), `r` thick. */
  private setBeam(b: Beam, a: vec3, c: vec3, r: number, faint: boolean): void {
    const d = c.sub(a)
    const len = d.length
    if (len < 1e-4) {
      b.so.enabled = false
      return
    }
    b.so.enabled = true
    const tr = b.so.getTransform()
    tr.setLocalPosition(a)
    tr.setLocalRotation(quat.rotationFromTo(vec3.forward(), d.uniformScale(1 / len)))
    tr.setLocalScale(new vec3(r, r, len))
    b.rmv.mainMaterial = faint ? this.rayFaintMat : this.rayMat
  }

  /**
   * The light path, computed every frame from the thin-lens equation (never keyframed): rays from
   * the subject's tip and base through the top, centre and bottom of the aperture, to their real
   * crossing point. With the mirror down they reflect up into the prism and out of the viewfinder.
   */
  private updateRays(): void {
    if (!this.raysSo) return
    const o = this.getOptics()
    const zl = this.lensPlaneZ()
    const zs = SENSOR_APART_Z
    const ho = HERO_H_O / SCALE
    const a2 = HERO_A / 2 / SCALE
    const zo = zl + o.d_o / SCALE
    const zi = zl - o.d_i / SCALE
    // The subject stands centred on the axis: tip at +h_o/2, base at -h_o/2. Images are inverted.
    const yTipImg = -((HERO_H_O / 2) * o.d_i) / o.d_o / SCALE
    const P = (y: number, z: number) => new vec3(0, y, z)
    const rays: {from: vec3; lens: vec3; img: vec3}[] = []
    const tip = P(ho / 2, zo)
    const base = P(-ho / 2, zo)
    for (const y of [a2, 0, -a2]) rays.push({from: tip, lens: P(y, zl), img: P(yTipImg, zi)})
    for (const y of [a2, 0, -a2]) rays.push({from: base, lens: P(y, zl), img: P(-yTipImg, zi)})

    let bi = 0
    const r = 0.035
    const next = () => (bi < this.beams.length ? this.beams[bi++] : null)
    const put = (a: vec3, c: vec3, faint: boolean = false) => {
      const b = next()
      if (b) this.setBeam(b, a, c, r, faint)
    }
    const mirrorDown = this.mirrorUp < 0.5
    const prism = this.prismPart.so.getTransform().getLocalPosition()
    const eye = this.viewfinderPart.so.getTransform().getLocalPosition()
    const mirrorC = this.mirrorPart.so.getTransform().getLocalPosition().add(new vec3(0, -MIRROR_HALF * ROOT2, MIRROR_HALF * ROOT2))
    const yScreen = prism.y - 1.45
    const roof = P(prism.y + 1.2, prism.z + 0.3)
    const back = P(prism.y + 0.2, prism.z - 1.6)
    for (const ray of rays) {
      put(ray.from, ray.lens)
      const dir = ray.img.sub(ray.lens).normalize()
      if (mirrorDown) {
        // Line y + (z - z_m) = 0 through the mirror's centre; reflect off it (normal (0,1,1)/√2).
        const t = (mirrorC.z - ray.lens.y - ray.lens.z) / (dir.y + dir.z)
        const hit = ray.lens.add(dir.uniformScale(t))
        put(ray.lens, hit)
        const n = new vec3(0, ROOT2, ROOT2)
        const refl = dir.sub(n.uniformScale(2 * dir.dot(n)))
        const t2 = (yScreen - hit.y) / Math.max(1e-3, refl.y)
        const scr = hit.add(refl.uniformScale(t2))
        put(hit, scr)
        put(scr, roof)
      } else {
        // Straight to the sensor; if the rays would meet behind it, the rest of the way is faint.
        const ts = (zs - ray.lens.z) / dir.z
        const onSensor = ray.lens.add(dir.uniformScale(ts))
        put(ray.lens, onSensor)
        if (zi < zs) put(onSensor, ray.img, true)
      }
    }
    if (mirrorDown) {
      put(roof, back)
      put(back, eye)
      put(eye, eye.add(new vec3(0, 0, -4)))
    }
    for (; bi < this.beams.length; bi++) this.beams[bi].so.enabled = false
    const a = easeOutCubic((this.lightT - 0.25) / 0.35) * this.lightFade()
    setFade(this.rayMat, a)
    setFade(this.rayFaintMat, 0.3 * a)
    // The image on the sensor: inverted, h_i tall, blurred by c (local units).
    const show = !mirrorDown
    this.sensorImage.update(-o.h_i / SCALE, o.c / SCALE, show ? a : 0)
  }

  private buildBubble(): void {
    const b = this.node(this.root, "HeroSensorBubble", vec3.zero())
    const face = this.node(b, "BubbleFace", vec3.zero())
    this.bubbleMat = this.glowMat()
    const R = 13
    const k = new MeshKit()
    k.addArcXY(0, 0, R, 0.22, 0, Math.PI * 2, ink(UI_WHITE, 0.85), 96)
    k.addArcXY(0, 0, R - 0.6, 0.11, 0, Math.PI * 2, ink(UI_WHITE, 0.4), 96)
    k.addFanXY(0, 0, R - 0.7, 0, Math.PI * 2, ink(UI_WHITE, 0.02), ink(UI_WHITE, 0.035), 64)
    // The sensor face-on at 1.9x: cyan outline, faint fill, pixel grid.
    const M = 1.9
    const hw = (SENSOR_W * SCALE * M) / 2
    const hh = (SENSOR_H * SCALE * M) / 2
    k.addRectXY(-hw, -hh, hw, hh, ink(SIGNAL, 0.06))
    k.addLineXY(-hw, -hh, hw, -hh, 0.14, ink(SIGNAL, 0.85))
    k.addLineXY(hw, -hh, hw, hh, 0.14, ink(SIGNAL, 0.85))
    k.addLineXY(hw, hh, -hw, hh, 0.14, ink(SIGNAL, 0.85))
    k.addLineXY(-hw, hh, -hw, -hh, 0.14, ink(SIGNAL, 0.85))
    for (let i = 1; i < 12; i++) k.addLineXY(-hw + (i / 12) * 2 * hw, -hh, -hw + (i / 12) * 2 * hw, hh, 0.04, ink(SIGNAL, 0.14))
    for (let j = 1; j < 8; j++) k.addLineXY(-hw, -hh + (j / 8) * 2 * hh, hw, -hh + (j / 8) * 2 * hh, 0.04, ink(SIGNAL, 0.14))
    spawnMesh(face, "BubbleFrame", k.build(), this.ctx.glowMat, undefined, this.bubbleMat)
    const img = this.node(face, "BubbleImage", new vec3(0, 0, 0.05))
    img.getTransform().setLocalScale(vec3.one().uniformScale(M))
    this.bubbleImage = new BlurImage(img, "BubbleImageBlur", this.ctx.glowMat, LIGHT, 3)
    this.bubbleFlash = new BlurImage(img, "BubbleFlash", this.ctx.glowMat, SIGNAL, 3)
    // Thin cyan outline around the image when it is sharp.
    this.bubbleSharp = this.node(img, "SharpOutline", new vec3(0, 0, 0.03))
    this.bubbleSharpMat = this.glowMat()
    const ok = new MeshKit()
    const ow = 0.035
    const pts = [new vec2(-0.12, -0.54), new vec2(0.12, -0.54), new vec2(0.12, 0.1), new vec2(0.33, 0.06), new vec2(0, 0.57), new vec2(-0.33, 0.06), new vec2(-0.12, 0.1), new vec2(-0.12, -0.54)]
    for (let i = 0; i < pts.length - 1; i++) ok.addLineXY(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, ow, ink(SIGNAL, 0.95))
    spawnMesh(this.bubbleSharp, "Outline", ok.build(), this.ctx.glowMat, undefined, this.bubbleSharpMat)
    // Leader from the sensor to the bubble's rim.
    const lk = new MeshKit()
    lk.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 1, ink(UI_WHITE, 0.5), 4, 50)
    const lso = this.node(this.root, "BubbleLeader", vec3.zero())
    const lrmv = lso.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    lrmv.mesh = lk.build()
    lrmv.mainMaterial = this.bubbleMat
    this.bubbleLeader = {so: lso, rmv: lrmv}
    b.getTransform().setLocalScale(vec3.one().uniformScale(1e-4))
    this.bubble = b
    this.bubbleFace = face
  }

  private updateBubble(dt: number): void {
    if (!this.bubble) return
    const o = this.getOptics()
    const sensor = this.partWorld(this.sensorPart)
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(sensor))
    // Above the body (clear of its ghost, even taken apart), a little toward the user.
    const target = sensor.add(new vec3(0, 50, 0)).add(toUser.uniformScale(6))
    // Opens after the mirror lifts (the image is on the sensor from then on).
    const open = easeOutCubic((this.lightT - VF_BEAT - 0.1) / 0.3) * this.lightFade()
    const tr = this.bubble.getTransform()
    tr.setWorldPosition(vec3.lerp(sensor, target, open))
    tr.setWorldScale(vec3.one().uniformScale(Math.max(1e-4, open)))
    this.bubbleFace.getTransform().setWorldRotation(faceToward(head.sub(tr.getWorldPosition())))
    setFade(this.bubbleMat, open)
    // Seen from behind the camera, the sensor image is the subject turned 180°.
    this.bubbleImage.update(-o.h_i, o.c, open)
    const sharp = o.sharp ? 1 : 0
    this.sharpK += (sharp - this.sharpK) * (1 - Math.exp(-dt / 0.06))
    const s = o.h_i
    this.bubbleSharp.getTransform().setLocalScale(new vec3(s, -s, 1))
    setFade(this.bubbleSharpMat, this.sharpK * open)
    // Leader: sensor top → rim.
    const rimPt = tr.getWorldPosition().add(sensor.sub(tr.getWorldPosition()).normalize().uniformScale(13 * open))
    const from = sensor.add(new vec3(0, SENSOR_H * 1.5, 0))
    const d = rimPt.sub(from)
    const lt = this.bubbleLeader.so.getTransform()
    if (d.length > 0.5 && open > 0.05) {
      this.bubbleLeader.so.enabled = true
      lt.setWorldPosition(from)
      lt.setWorldRotation(quat.rotationFromTo(vec3.forward(), d.normalize()))
      lt.setWorldScale(new vec3(0.08, 0.08, d.length))
    } else {
      this.bubbleLeader.so.enabled = false
    }
  }

  // =====================================================================================
  // Photo
  // =====================================================================================

  private setCurtains(first: number, second: number): void {
    // Curtain cover 0..1: 1 = covers the gate. First opens downward, second closes from the top.
    const hh = 1.4
    const f = this.curtains[0].getTransform()
    f.setLocalScale(new vec3(1, Math.max(0.04, first), 1))
    f.setLocalPosition(new vec3(0, -hh + hh * Math.max(0.04, first), 0))
    const s = this.curtains[1].getTransform()
    s.setLocalScale(new vec3(1, Math.max(0.04, second), 1))
    s.setLocalPosition(new vec3(0, hh - hh * Math.max(0.04, second), 0))
  }

  private updateShot(dt: number): void {
    if (this.flashT >= 0) {
      this.flashT += dt
      const o = this.getOptics()
      const a = this.flashT < 0.6 ? 1 - easeOutCubic(this.flashT / 0.6) : 0
      this.sensorFlash.update(-o.h_i / SCALE, o.c / SCALE, a)
      if (this.bubbleFlash) this.bubbleFlash.update(-o.h_i, o.c, a)
      if (this.flashT > 0.65) this.flashT = -1
    }
    if (this.shotT < 0) {
      this.setCurtains(0, 0)
      return
    }
    this.shotT += dt
    const t = this.shotT
    // First curtain opens (0–0.1 s), second closes (0.105–0.205 s), then both reset for live view.
    const first = t < 0.1 ? 1 - easeInOutCubic(t / 0.1) : 0
    const second = t < 0.105 ? 0 : t < 0.205 ? easeInOutCubic((t - 0.105) / 0.1) : t < 0.45 ? 1 : 1 - easeInOutCubic((t - 0.45) / 0.15)
    this.setCurtains(t < 0.02 ? 1 : first, second)
    if (t >= 0.205 && this.flashT < 0 && !this.shotFlags.flash) {
      this.shotFlags.flash = true
      this.flashT = 0
      this.setCaption("pixel")
      this.captionHoldT = 2.5
      this.ctx.log("hero:pixels")
    }
    if (t >= 0.3 && !this.shotFlags.print) {
      this.shotFlags.print = true
      this.makePrint()
    }
    if (t >= 0.62) {
      this.shotT = -1
      this.shotFlags = {flash: false, print: false}
    }
  }

  private shotFlags = {flash: false, print: false}

  /** A 15 × 10 cm print slides out of the replica: the subject upright, with the sensor's blur. */
  private makePrint(): void {
    if (this.print) this.oldPrints.push({so: this.print, t: 0, mats: this.printMats})
    const o = this.getOptics()
    const so = this.node(this.root, "HeroPhotoPrint", vec3.zero())
    const mats: Material[] = []
    const mat = this.glowMat()
    mats.push(mat)
    const k = new MeshKit()
    const W = 15
    const H = 10
    k.addRectXY(-W / 2, -H / 2, W / 2, H / 2, ink(LIGHT, 0.05))
    k.addLineXY(-W / 2, -H / 2, W / 2, -H / 2, 0.1, ink(UI_WHITE, 0.6))
    k.addLineXY(W / 2, -H / 2, W / 2, H / 2, 0.1, ink(UI_WHITE, 0.6))
    k.addLineXY(W / 2, H / 2, -W / 2, H / 2, 0.1, ink(UI_WHITE, 0.6))
    k.addLineXY(-W / 2, H / 2, -W / 2, -H / 2, 0.1, ink(UI_WHITE, 0.6))
    spawnMesh(so, "PrintFrame", k.build(), this.ctx.glowMat, undefined, mat)
    // The photo is the sensor frame enlarged to the print: same framing, same relative blur.
    const enlarge = W / (SENSOR_W * SCALE)
    const img = this.node(so, "PrintImage", new vec3(0, 0, 0.04))
    const bi = new BlurImage(img, "PrintBlur", this.ctx.glowMat, LIGHT, 3)
    bi.update(o.h_i * enlarge, o.c * enlarge, 1)
    mats.push(bi.mat)
    this.printImage = bi
    this.printBlur = o.c
    this.printH = o.h_i
    this.printMats = mats
    this.print = so
    this.printT = 0
    this.ctx.sound("print", this.partWorld(this.sensorPart))
    this.ctx.log("hero:print")
  }

  private printSpot(): vec3 {
    const c = this.replicaCenter()
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(c))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    // Upper left of the replica, above the lens labels and level with the sensor bubble.
    return c.add(toUser.uniformScale(30)).add(right.uniformScale(-36)).add(new vec3(0, 42, 0))
  }

  private updatePrints(dt: number): void {
    const head = this.ctx.camPos()
    if (this.print) {
      this.printT += dt
      const k = easeOutCubic(this.printT / 0.5)
      const from = this.partWorld(this.sensorPart)
      const to = this.printSpot()
      const tr = this.print.getTransform()
      tr.setWorldPosition(vec3.lerp(from, to, k))
      tr.setWorldRotation(faceToward(head.sub(tr.getWorldPosition())))
      tr.setWorldScale(vec3.one().uniformScale(0.3 + 0.7 * k))
      const a = this.lightFade()
      for (const m of this.printMats) setFade(m, a)
    }
    this.oldPrints = this.oldPrints.filter((p) => {
      p.t += dt
      const a = 1 - easeIn(p.t / 0.22)
      for (const m of p.mats) setFade(m, Math.max(0, a))
      const tr = p.so.getTransform()
      tr.setWorldPosition(tr.getWorldPosition().add(new vec3(0, -12 * dt, 0)))
      if (p.t >= 0.22) {
        p.so.destroy()
        return false
      }
      return true
    })
  }

  // =====================================================================================
  // Put it back
  // =====================================================================================

  private updateReturn(dt: number): void {
    const t = this.t
    const tr = this.replica.getTransform()
    const from = this.retFrom
    if (t < RET_FLY0) {
      // Reassemble: the slider runs back to 0 and the lens twists into the mount.
      const k = easeInOutCubic(t / RET_ASSEMBLE)
      const s = from.s * (1 - k)
      this.ctx.rail.setApartValue(s)
      this.s = s
      const lightK = from.lightK * (1 - clamp01(t / 0.25))
      if (this.mirrorPlate) this.mirrorPlate.getTransform().setLocalRotation(quat.angleAxis(-45 * DEG * this.mirrorUp * (1 - clamp01(t / 0.25)), vec3.right()))
      this.applyApart(s, lightK)
      tr.setWorldRotation(from.rot)
      this.fadeLightPath(dt)
      if (t >= RET_ASSEMBLE && !this.retFlags.click) {
        this.retFlags.click = true
        this.ctx.sound("bayonet", tr.getWorldPosition())
      }
      this.shellFill = 1
      this.shellRim = 0.3
    } else if (t < RET_FLY1) {
      this.destroyLightPath()
      this.applyApart(0, 0)
      const u = easeInOutCubic((t - RET_FLY0) / (RET_FLY1 - RET_FLY0))
      tr.setWorldPosition(bezier(this.pLand, this.ctrl, this.pMeet, u))
      tr.setWorldRotation(quat.slerp(from.rot, this.rStart, u))
      tr.setWorldScale(vec3.one().uniformScale(SCALE + (1 - SCALE) * u))
      // Back to edges of light so it can melt into the real camera.
      this.shellFill = 1 - easeOutCubic((t - RET_FLY0) / 0.4)
      this.shellRim = 0.3 + 0.6 * (1 - this.shellFill)
      if (!this.retFlags.flight) {
        this.retFlags.flight = true
        this.ctx.sound("flight", tr.getWorldPosition())
      }
      this.ctx.moveSound("flight", tr.getWorldPosition())
    } else {
      // The lens drops back into its bag; the body sinks into the real camera and melts.
      const k = easeInOutCubic((t - RET_FLY1) / (RET_END - RET_FLY1 - 0.1))
      tr.setWorldPosition(vec3.lerp(this.pMeet, this.pStart, k))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
      const lt = t - RET_FLY1
      if (lt < 0.15) {
        this.setBarrel(0, 45 * easeInOutCubic(lt / 0.15))
      } else if (lt < 0.25) {
        this.setBarrel(3 * easeInOutCubic((lt - 0.15) / 0.1), 45)
      } else {
        const kk = easeInOutCubic((lt - 0.25) / 0.35)
        const btr = this.barrelSo.getTransform()
        const start = tr.getWorldTransform().multiplyPoint(new vec3(0, 0, 3))
        const bag = this.ctx.bag()
        const endPos = bag.sub(this.bagRot.multiplyVec3(new vec3(0, 0, LENS_CENTER_Z)))
        btr.setWorldPosition(vec3.lerp(start, endPos, kk))
        btr.setWorldRotation(quat.slerp(tr.getWorldRotation().multiply(quat.angleAxis(45 * DEG, vec3.forward())), this.bagRot, kk))
      }
      this.shellFill = 0
      this.shellRim = 0.9
      this.globalFade = 1 - clamp01((t - (RET_END - 0.4)) / 0.35)
    }
    if (t >= RET_END) {
      this.ctx.log("hero:home")
      this.clear()
    }
  }

  private retFlags = {click: false, flight: false}

  private fadeLightPath(dt: number): void {
    void dt
    if (this.subject) setFade(this.subjectMat, this.lightFade())
    if (this.rayMat) setFade(this.rayMat, this.lightFade())
    if (this.rayFaintMat) setFade(this.rayFaintMat, 0.3 * this.lightFade())
    if (this.bubble) {
      const k = this.lightFade()
      this.bubble.getTransform().setWorldScale(vec3.one().uniformScale(Math.max(1e-4, k)))
      if (this.bubbleLeader) this.bubbleLeader.so.enabled = k > 0.05
    }
    this.sensorImage.update(0.5, 0, 0)
  }

  /** Remove the subject, rays and bubble (and the prints, unless `keepPrints`). */
  private destroyLightPath(keepPrints: boolean = false): void {
    if (this.subject) this.subject.destroy()
    if (this.raysSo) this.raysSo.destroy()
    if (this.bubble) this.bubble.destroy()
    if (this.bubbleLeader) this.bubbleLeader.so.destroy()
    this.subject = null
    this.raysSo = null
    this.beams = []
    this.bubble = null
    this.bubbleLeader = null
    this.bubbleImage = null
    this.bubbleFlash = null
    this.bubbleSharp = null
    if (keepPrints) return
    if (this.print) this.print.destroy()
    for (const p of this.oldPrints) p.so.destroy()
    this.print = null
    this.oldPrints = []
    this.printMats = []
  }

  // =====================================================================================
  // Shared per-frame
  // =====================================================================================

  /** Shell look: fill (lifted textures) 0..1 and fresnel rim, faded to an outline where parts lift away. */
  private updateShell(): void {
    const g = this.globalFade
    const set = (m: Material, fill: number) => {
      const f = this.shellFill * fill * g
      m.mainPass.baseColor = new vec4(f, f, f, 1)
      m.mainPass.emissiveIntensity = 0.62 * f
      // A fading shell keeps a thin outline, front faces only (additive two-sided rims stack up
      // into a white block), and turns see-through so the parts inside show.
      const ghost = fill < 0.99
      m.mainPass.rimIntensity = this.shellRim * g * (ghost ? 0.3 + 0.7 * fill : 1)
      m.mainPass.twoSided = !ghost
      m.mainPass.depthWrite = this.shellFill * fill > 0.95
    }
    set(this.bodyMat, this.bodyFill)
    set(this.barrelMat, this.barrelFill)
    if (g < 1) for (const p of this.parts) if (p.mat && p.so.enabled) setFade(p.mat, 0)
  }

  private placeRail(): void {
    if (this.state !== "landed" && this.state !== "light" && !(this.state === "returning" && this.ctx.rail.isVisible())) return
    const c = this.replicaCenter()
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(c))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    // Beside the replica on the user's side: in front of it and to the right of the body.
    this.ctx.rail.place(c.add(toUser.uniformScale(34)).add(right.uniformScale(42)).add(new vec3(0, -8, 0)))
  }

  /**
   * The caption sits right above the rail (beside the replica, on the user's side). The rail keeps
   * its apparent size, so its height grows with distance; `raised` = the light-path layout, where
   * "Take apart" sits a row above "Focus".
   */
  private captionAnchor(raised: boolean): vec3 {
    const c = this.replicaCenter()
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(c))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    const rail = c.add(toUser.uniformScale(34)).add(right.uniformScale(42)).add(new vec3(0, -8, 0))
    const k = Math.min(6, Math.max(0.3, rail.distance(head) / 110))
    // Rail top above its anchor at design scale (slider label tops), plus the caption's two lines and a gap.
    return rail.add(new vec3(0, k * ((raised ? 10.3 : 4.1) + 5), 0))
  }

  /** World centre of the assembled body (where the thread and trail attach). */
  private replicaCenter(): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(BODY_CENTER)
  }

  private partWorld(p: Part): vec3 {
    return p.so.getTransform().getWorldPosition()
  }

  private restWorld(p: Part): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(p.rest)
  }

  /** Lowest point of the assembled replica (the body's underside), world Y. */
  private lowestWorldY(): number {
    const tr = this.replica.getTransform()
    return tr.getWorldPosition().y + BODY_MIN_Y * tr.getWorldScale().y
  }

  private threadConnected(): boolean {
    if (!this.thread || this.state === "none") return false
    const a = this.thread.pointAt(0)
    const b = this.thread.pointAt(1)
    return a.distance(this.realCenter) < 2 && b.distance(this.replicaCenter()) < 26
  }
}
