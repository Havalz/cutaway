/**
 * Lamp hero: take it apart (lamp-hero.md §5, Phase B). Works with the lamp on or off.
 *
 * Driven by the "Take apart" slider once the copy hovers. The parts separate vertically in
 * sequence with a short stagger: the top ring; the shade, which rises and opens (its paper parts
 * in two halves, left and right as the user sees it) to reveal its wire frame; the bulb rises off
 * the socket and its frosted envelope lifts off the LED board; the driver board slides out of the
 * bulb's base (growing so it reads, turned to the user); then the socket, the stem and the base.
 * The cord and the switch stay on the table (the stage keeps them there). Every separated or
 * revealed solid part is labelled (four words or fewer), each label clear of the parts, the other
 * labels, the caption and the rail as the user sees them.
 *
 * Live detail while apart with the lamp lit: a cyan sine wave (wall power) runs from the socket
 * into the driver, and a steady flat current runs out of it to the LED chips.
 *
 * Back at 0 every part returns exactly to its rest transform.
 */
import {LabelItem, LabelPlanner} from "./CutawayLabelPlan"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {boxHull, pushBox, toView, viewFrame, ViewFrame} from "./CutawayLayout"
import {PathPoints, pathPoints, PathRibbon} from "./CutawayLampLight"
import {LAMP_GEOM, lampShadeR, LampModel} from "./CutawayLampModel"
import {DEG} from "./CutawayStageKit"
import {ENERGY, ink} from "./CutawayStyle"
import {clamp01, easeInOutCubic} from "./CutawayTween"

const G = LAMP_GEOM
const TAU = Math.PI * 2
const SIGNAL = ENERGY.signal

/** The live detail runs once everything is apart. */
const LIVE_AT = 0.97
/** The paper's halves open this far each (model cm): clear of the frame inside. */
const OPEN_CM = G.shadeMaxR + 5
/** The driver board slides this far out of the bulb's base (model cm) and grows this much so it reads. */
const DRIVER_OUT = 12
const DRIVER_ZOOM = 3
/** The wall power's sine (world cm): its height, waves along the line, how fast it flows (Hz). */
const WAVE_AMP = 0.35
const WAVE_N = 3.5
const WAVE_HZ = 1.4
const WAVE_PTS = 48
const FLAT_PTS = 24
/** The live detail is redrawn at most this often. */
const DETAIL_HZ = 30
const LABEL_RISES = [0, 3, 4.5, 6, 8, 10, 12.5, 15, 18, 22]
/** The exploded view's outline is worked out again once the user has walked this far round (cos 3°). */
const SAME_VIEW = 0.9986
/** What never leaves the table, or is not shown apart. */
const STAYS_DOWN: {[part: string]: boolean} = {LampCord: true, LampWires: true, LampSwitch: true, LampSwitchButton: true, LampPlug: true}

type Special = "halves" | "driver"
/** Which side of the copy a label prefers, as the user sees it: fixed, or the rail's side or the other. */
type Side = "right" | "left" | "rail" | "away"

interface PartSpec {
  key: string
  label: string | null
  part: string
  /** Offset from rest in the part's parent space (model cm at 1x). */
  d: vec3
  special?: Special
  /** Its window on the slider: separates from `a` over `w`. */
  a: number
  w: number
  /** Label anchor in the anchor object's local space (that object defaults to the part). */
  anchor?: vec3
  /** Look groups that must be solid for its label. */
  groups: string[]
  /** For parts revealed rather than moved: labelled with this part's progress. */
  revealWith?: string
  /** The label prefers to sit below its anchor. */
  below?: boolean
  /** The side its label prefers; round parts are anchored on their edge toward it. */
  side?: Side
  /** A round part's radius and the anchor's height (part space): anchored on its edge toward `side`, turned a little to the user. */
  round?: {r: number; y: number}
}

const PAPER_MID = (G.paperY0 + G.paperY1) / 2
const FRAME_Y = G.paperY0 + 0.62 * (G.paperY1 - G.paperY0)
const SOCKET_R = 1.8
/** The LED chips' outer ring (model cm), as built. */
const CHIP_RING = 1.35

const SPECS: PartSpec[] = [
  {key: "topRing", label: null, part: "LampTopRing", d: new vec3(0, 16, 0), a: 0, w: 0.24, groups: []},
  {key: "shade", label: "Shade", part: "LampShade", d: new vec3(0, 62, 0), a: 0.06, w: 0.3, groups: ["LampPaper"]},
  {key: "open", label: null, part: "LampPaper", d: vec3.zero(), special: "halves", a: 0.22, w: 0.22, groups: []},
  {key: "frame", label: "Wire frame", part: "LampFrame", d: vec3.zero(), a: 0.22, w: 0.22, groups: ["LampFrame"], revealWith: "open", side: "left"},
  {key: "bulb", label: null, part: "LampBulb", d: new vec3(0, 22, 0), a: 0.16, w: 0.3, groups: []},
  {key: "glass", label: "Bulb", part: "LampBulbGlass", d: new vec3(0, 7, 0), a: 0.36, w: 0.22, groups: ["LampBulbGlass"], side: "rail"},
  {key: "chips", label: "LED chips", part: "LampLedChips", d: vec3.zero(), a: 0.36, w: 0.22, groups: ["LampLedChips"], revealWith: "glass", side: "away"},
  {key: "driver", label: "Driver", part: "LampDriver", d: vec3.zero(), special: "driver", a: 0.46, w: 0.24, anchor: new vec3(0, 2.35, 0.1), groups: ["LampDriver"], side: "away"},
  {key: "socket", label: "Socket", part: "LampSocket", d: new vec3(0, 15, 0), a: 0.56, w: 0.22, groups: ["LampSocket"], side: "rail", round: {r: SOCKET_R, y: 2.2}},
  {key: "stem", label: "Stem", part: "LampStem", d: new vec3(0, 6, 0), a: 0.66, w: 0.22, groups: ["LampStem"], side: "away", round: {r: G.stemR, y: (G.socketY - G.collarTop) / 2}},
  {key: "base", label: "Base", part: "LampBase", d: new vec3(0, -6, 0), a: 0.76, w: 0.2, groups: ["LampBase"], below: true, side: "rail", round: {r: G.baseR, y: G.rimTop * 0.7}},
  {key: "switch", label: "Switch", part: "LampSwitch", d: vec3.zero(), a: 0.56, w: 0.22, anchor: new vec3(0, G.switchHalf.y, 0), groups: ["LampSwitch"], revealWith: "socket"}
]

/** How the copy comes apart from a view: the paper's turn, the driver's way out and its turn. */
interface ViewPlan {
  right: vec3
  toCam: vec3
  paperYaw: number
  driverDir: vec3
  driverYaw: number
}

interface Part {
  spec: PartSpec
  so: SceneObject
  anchorSo: SceneObject
  rest: {pos: vec3; rot: quat; scale: vec3}
  e: number
  raw: number
  freed: boolean
  /** Its label (null when it has none), and the label's anchor in the anchor object's space. */
  item: LabelItem | null
  anchorLocal: vec3 | null
  moves: boolean
  /** Its entry in freeTicks. */
  tick: {at: number; freed: boolean} | null
}

export interface LampApartCtx {
  labels: CutawayLabelsUI
  parent: SceneObject
  glowMat: Material
  camPos: () => vec3
  stageCenter: () => vec3
  /** Rail boxes: kept clear of labels. */
  railBoxes: () => vec3[][]
  groupSolid: (g: string) => boolean
  /** Whether a mesh is drawn solid (true), as an outline (false) or not at all (null). */
  meshSolid: (rmv: RenderMeshVisual) => boolean | null
  /** Which side of the copy the driver slides out to, as the user sees it (+1 right, −1 left). */
  driverSide: () => number
  partSound: (p: vec3) => void
  log: (p: string) => void
}

export interface LampApartInfo {
  s: number
  live: boolean
  parts: {key: string; label: string; moved: number; labelShown: boolean; solid: boolean}[]
  /** How far the paper's halves have opened (model cm each). */
  open: number
  interiorShown: boolean
  /** The driver detail: its level (0..1), the wave's largest offset from its line and the flat current's (world cm), the wave's phase. */
  detail: number
  waveDev: number
  flatDev: number
  wavePhase: number
  /** The largest distance (world cm) of any part (two points of each) from its rest, relative to the copy. */
  maxRestError: number
}

export class LampApart {
  private parts: Part[] = []

  private ticks: {at: number; freed: boolean}[] = []

  /** One entry per part that frees itself: where on the slider, and whether it has (the rail's ticks). */
  freeTicks(): {at: number; freed: boolean}[] {
    return this.ticks
  }
  private byKey: {[k: string]: Part} = {}
  /** Every part and the paper's halves: two points of each (origin, a point off it) at rest, in the copy's space. */
  private allRest: {so: SceneObject; p0: vec3; p1: vec3}[] = []
  private halves: {so: SceneObject; dir: vec3}[] = []
  private s = 0
  private interiorShown = false
  /** Set when the parts start to separate (the user's view then): the paper's turn and the driver's way out and turn. */
  private paperYaw = 0
  private driverDir = new vec3(1, 0, 0)
  private driverYaw = 0
  /** The user's right and the way to the user, in the copy's space (level), when it came apart. */
  private viewRight = new vec3(1, 0, 0)
  private viewToCam = new vec3(0, 0, 1)
  private wave: PathRibbon | null = null
  private flat: PathRibbon | null = null
  private wavePts: PathPoints = pathPoints(WAVE_PTS)
  private flatPts: PathPoints = pathPoints(FLAT_PTS)
  private waveW = new Float64Array(WAVE_PTS)
  private flatW = new Float64Array(FLAT_PTS)
  private nextDetail = 0
  private detail = 0
  private detailSet = false
  private wavePhase = 0
  private flatPhase = 0
  private waveDev = 0
  private flatDev = 0
  private planner: LabelPlanner
  private want: LabelItem[] = []
  private meshes: {rmv: RenderMeshVisual; part: string; lo: vec3; hi: vec3}[]
  /** The exploded view's corners in the copy's space, for each side the driver can go. */
  private exploded: {right: vec3; side: number; pts: number[]}[] = []

  /** Built while the model is still at the origin, unrotated, at scale 1. */
  constructor(
    private model: LampModel,
    private ctx: LampApartCtx
  ) {
    const inv = model.root.getTransform().getInvertedWorldTransform()
    const snap = (so: SceneObject) => {
      const m = so.getTransform().getWorldTransform()
      this.allRest.push({so, p0: inv.multiplyPoint(m.multiplyPoint(vec3.zero())), p1: inv.multiplyPoint(m.multiplyPoint(new vec3(5, 3, 5)))})
    }
    // The switch's button is the switch's (on/off), not the take-apart's.
    for (const name of Object.keys(model.parts)) if (name !== "LampSwitchButton") snap(model.parts[name])
    this.halves = model.paperHalves()
    for (const h of this.halves) snap(h.so)
    for (const spec of SPECS) {
      const so = model.parts[spec.part]
      if (!so) continue
      const anchorSo = spec.key === "shade" ? this.halves[0].so : so
      const tr = so.getTransform()
      const moves = !!spec.special || spec.d.length > 0
      const tick = moves ? {at: spec.a + 0.02 * spec.w, freed: false} : null
      if (tick) this.ticks.push(tick)
      const item: LabelItem | null = spec.label ? {key: spec.key, id: "lamp_" + spec.key, text: spec.label, anchor: vec3.zero(), sh: 1, sv: 1} : null
      const p: Part = {spec, so, anchorSo, rest: {pos: tr.getLocalPosition(), rot: tr.getLocalRotation(), scale: tr.getLocalScale()}, e: 0, raw: 0, freed: false, item, anchorLocal: null, moves, tick}
      this.parts.push(p)
      this.byKey[spec.key] = p
    }
    this.meshes = model.meshList()
    this.planner = new LabelPlanner(
      {
        labels: ctx.labels,
        camPos: ctx.camPos,
        stageCenter: ctx.stageCenter,
        pivot: () => this.model.root.getTransform().getWorldPosition(),
        addObstacles: (F, hard, soft) => {
          // The parts' own extents (their vertices); the long cord's box would be mostly empty table, so it is left out.
          for (const m of this.meshes) {
            if (m.part === "LampCord" || m.part === "LampWires") continue
            const so = m.rmv.getSceneObject()
            const solid = this.ctx.meshSolid(m.rmv)
            if (solid === null || !so.isEnabledInHierarchy) continue
            ;(solid ? hard : soft).push(boxHull(F, so.getTransform().getWorldTransform(), m.lo, m.hi))
          }
        },
        railBoxes: ctx.railBoxes,
        prefer: (item, F, ax) => {
          const sp = this.byKey[item.key].spec
          // The part's own side, else outward from the lamp's axis, as the user sees it.
          const axis = toViewX(F, this.model.root.getTransform().getWorldPosition())
          item.sh = this.sideOf(sp) || (ax - axis >= 0 ? 1 : -1)
          item.sv = sp.below ? -1 : 1
        }
      },
      LABEL_RISES
    )
    this.wave = new PathRibbon(ctx.parent, "LampDriverWave", ctx.glowMat, WAVE_PTS, ink(SIGNAL, 1))
    this.flat = new PathRibbon(ctx.parent, "LampDriverFlat", ctx.glowMat, FLAT_PTS, ink(SIGNAL, 1))
    this.setDetail(0)
  }

  get value(): number {
    return this.s
  }

  get live(): boolean {
    return this.s >= LIVE_AT
  }

  /**
   * Separate the parts for slider value `s` (0..1, already rate-limited by the stage); `lit` = the
   * LED's level (the driver detail runs with it); `labels` false keeps every label off (put back).
   */
  update(dt: number, s: number, lit: number, labels: boolean = true): void {
    const was = this.s
    this.s = s
    const apart = s > 1e-4
    if (apart && was <= 1e-4) this.planView()
    if (apart !== this.interiorShown) {
      this.interiorShown = apart
      this.model.setInteriorVisible(apart)
      // The wires inside the stem stay out of the exploded view (they would dangle between the parts).
      if (this.model.parts["LampWires"]) this.model.parts["LampWires"].enabled = false
      this.ctx.log(apart ? "lamp:apart" : "lamp:together")
    }
    // Together and staying so: the parts are the stage's (the shade's lift, the cord), nothing to write.
    if (!apart && was <= 1e-4) {
      if (this.detail > 0) this.setDetail(0)
      if (this.planner.size > 0) this.hideLabels()
      return
    }
    // The slider hasn't moved: the parts are where they were.
    if (s !== was) this.layParts(s, apart)
    this.updateDetail(dt, s, lit)
    if (apart && labels) this.updateLabels()
    else this.hideLabels()
  }

  private layParts(s: number, apart: boolean): void {
    const up = vec3.up()
    for (const p of this.parts) {
      const sp = p.spec
      const raw = clamp01((s - sp.a) / sp.w)
      p.raw = raw
      p.e = easeInOutCubic(raw)
      const tr = p.so.getTransform()
      if (sp.special === "halves") {
        // Turned (invisibly, it is round) while it is apart, so its halves part left and right as
        // the user sees it; exactly at rest once it is back.
        tr.setLocalRotation(apart ? p.rest.rot.multiply(quat.angleAxis(this.paperYaw, up)) : p.rest.rot)
        for (const h of this.halves) h.so.getTransform().setLocalPosition(raw > 0 ? h.dir.uniformScale(OPEN_CM * p.e) : vec3.zero())
      } else if (raw <= 0) {
        // Exactly at rest.
        tr.setLocalPosition(p.rest.pos)
        tr.setLocalRotation(p.rest.rot)
        tr.setLocalScale(p.rest.scale)
      } else if (sp.special === "driver") {
        tr.setLocalPosition(p.rest.pos.add(this.driverDir.uniformScale(DRIVER_OUT * p.e)))
        tr.setLocalRotation(p.rest.rot.multiply(quat.angleAxis(this.driverYaw * p.e, up)))
        tr.setLocalScale(p.rest.scale.uniformScale(1 + (DRIVER_ZOOM - 1) * p.e))
      } else {
        tr.setLocalPosition(p.rest.pos.add(sp.d.uniformScale(p.e)))
      }
      if (raw > 0.02 && !p.freed && p.moves) {
        p.freed = true
        this.ctx.partSound(p.so.getTransform().getWorldPosition())
        this.ctx.log("lamp:free:" + sp.key)
      } else if (raw <= 0 && p.freed) p.freed = false
      if (p.tick) p.tick.freed = p.freed
    }
  }

  /** Every label off (Reset, put back, reassembled). */
  hideLabels(): void {
    for (const p of this.parts) if (p.item && this.ctx.labels.isShown(p.item.id)) this.ctx.labels.hide(p.item.id)
    this.planner.clear()
  }

  destroy(): void {
    this.hideLabels()
    if (this.wave) this.wave.so.destroy()
    if (this.flat) this.flat.so.destroy()
    this.wave = null
    this.flat = null
  }

  getInfo(): LampApartInfo {
    const root = this.model.root.getTransform()
    const inv = root.getInvertedWorldTransform()
    const sc = root.getWorldScale().x
    let maxErr = 0
    const restOf = new Map<SceneObject, vec3>()
    for (const r of this.allRest) {
      const m = r.so.getTransform().getWorldTransform()
      const a = inv.multiplyPoint(m.multiplyPoint(vec3.zero()))
      const b = inv.multiplyPoint(m.multiplyPoint(new vec3(5, 3, 5)))
      maxErr = Math.max(maxErr, a.distance(r.p0) * sc, b.distance(r.p1) * sc)
      restOf.set(r.so, r.p0)
    }
    const moved = (so: SceneObject) => (restOf.has(so) ? inv.multiplyPoint(so.getTransform().getWorldPosition()).distance(restOf.get(so)) * sc : 0)
    const open = this.byKey["open"]
    return {
      s: this.s,
      live: this.live,
      parts: this.parts
        .filter((p) => p.spec.label)
        .map((p) => ({
          key: p.spec.key,
          label: p.spec.label,
          // A part that moves with another (the frame with the shade, the chips with the bulb) counts that move; the shade counts its halves.
          moved: p.spec.key === "shade" ? Math.max(moved(p.so), moved(this.halves[0].so)) : moved(p.so),
          labelShown: this.ctx.labels.isShown("lamp_" + p.spec.key),
          solid: p.spec.groups.every((g) => this.ctx.groupSolid(g)) && p.so.isEnabledInHierarchy
        })),
      open: open ? OPEN_CM * open.e : 0,
      interiorShown: this.interiorShown,
      detail: this.detail,
      waveDev: this.waveDev,
      flatDev: this.flatDev,
      wavePhase: this.wavePhase,
      maxRestError: maxErr
    }
  }

  // =====================================================================================
  // The view when it comes apart: the paper opens left and right, the driver comes out to the side
  // =====================================================================================

  private planView(): void {
    const v = this.viewPlan(this.ctx.driverSide())
    this.viewRight = v.right
    this.viewToCam = v.toCam
    this.paperYaw = v.paperYaw
    this.driverDir = v.driverDir
    this.driverYaw = v.driverYaw
    for (const p of this.parts) p.anchorLocal = null
  }

  /** How it would come apart from where the user is now. */
  private viewPlan(driverSide: number): ViewPlan {
    const cam = this.ctx.camPos()
    const c = this.ctx.stageCenter()
    const F = viewFrame(cam, c)
    const inv = this.model.root.getTransform().getWorldRotation().invert()
    const flat = (v: vec3) => {
      const f = new vec3(v.x, 0, v.z)
      return f.length > 1e-5 ? f.normalize() : new vec3(1, 0, 0)
    }
    const right = flat(inv.multiplyVec3(F.r))
    const toCam = flat(inv.multiplyVec3(cam.sub(c)))
    const yawOf = (v: vec3) => Math.atan2(v.x, v.z)
    return {
      right,
      toCam,
      // A turn about +Y by θ adds θ to atan2(x, z): half A turns onto the user's right.
      paperYaw: yawOf(right) - yawOf(this.halves[0].dir),
      driverDir: right.uniformScale(driverSide >= 0 ? 1 : -1),
      // The driver's parts are on its +Z face: turn that face to the user.
      driverYaw: yawOf(toCam)
    }
  }

  /**
   * The copy all the way apart with the driver on `driverSide`: the corners (x, y, z, in the copy's
   * space) of every part that leaves the table. The rail stands clear of them before the first part
   * moves, so it never has to move under the user's finger. Lays the parts out and back within the
   * call, so nothing ever draws that way; kept until the user has walked round.
   */
  explodedPoints(driverSide: number): number[] {
    const side = driverSide >= 0 ? 1 : -1
    const apart = this.s > 1e-4
    const plan: ViewPlan = apart ? {right: this.viewRight, toCam: this.viewToCam, paperYaw: this.paperYaw, driverDir: this.driverDir, driverYaw: this.driverYaw} : this.viewPlan(side)
    for (const e of this.exploded) if (e.side === side && e.right.dot(plan.right) > SAME_VIEW) return e.pts
    const up = vec3.up()
    const saved = this.parts.map((p) => {
      const tr = p.so.getTransform()
      return {tr, pos: tr.getLocalPosition(), rot: tr.getLocalRotation(), scale: tr.getLocalScale()}
    })
    const halves = this.halves.map((h) => h.so.getTransform().getLocalPosition())
    for (const p of this.parts) {
      const sp = p.spec
      const tr = p.so.getTransform()
      if (sp.special === "halves") {
        tr.setLocalRotation(p.rest.rot.multiply(quat.angleAxis(plan.paperYaw, up)))
        for (const h of this.halves) h.so.getTransform().setLocalPosition(h.dir.uniformScale(OPEN_CM))
      } else if (sp.special === "driver") {
        tr.setLocalPosition(p.rest.pos.add(plan.driverDir.uniformScale(DRIVER_OUT)))
        tr.setLocalRotation(p.rest.rot.multiply(quat.angleAxis(plan.driverYaw, up)))
        tr.setLocalScale(p.rest.scale.uniformScale(DRIVER_ZOOM))
      } else tr.setLocalPosition(p.rest.pos.add(sp.d))
    }
    const inv = this.model.root.getTransform().getInvertedWorldTransform()
    const pts: number[] = []
    for (const m of this.meshes) if (!STAYS_DOWN[m.part]) pushBox(pts, inv.mult(m.rmv.getSceneObject().getTransform().getWorldTransform()), m.lo, m.hi)
    saved.forEach((b) => {
      b.tr.setLocalPosition(b.pos)
      b.tr.setLocalRotation(b.rot)
      b.tr.setLocalScale(b.scale)
    })
    this.halves.forEach((h, i) => h.so.getTransform().setLocalPosition(halves[i]))
    this.exploded = this.exploded.filter((e) => e.side !== side)
    this.exploded.push({right: plan.right, side, pts})
    return pts
  }

  // =====================================================================================
  // Live detail: wall power (a sine) into the driver, a steady current out to the chips
  // =====================================================================================

  private setDetail(k: number): void {
    if (k === this.detail && this.detailSet) return
    this.detailSet = true
    this.detail = k
    if (this.wave) this.wave.setLevel(k)
    if (this.flat) this.flat.setLevel(k)
  }

  private updateDetail(dt: number, s: number, lit: number): void {
    const k = clamp01((s - LIVE_AT) / (1 - LIVE_AT)) * clamp01(lit)
    this.setDetail(k)
    if (k <= 1e-4 || !this.wave || !this.flat) {
      this.waveDev = 0
      this.flatDev = 0
      return
    }
    this.wavePhase += WAVE_HZ * dt
    this.flatPhase += dt
    const now = getTime()
    if (now < this.nextDetail) return
    this.nextDetail = now - this.nextDetail < 1 / DETAIL_HZ ? this.nextDetail + 1 / DETAIL_HZ : now + 1 / DETAIL_HZ
    this.drawDetail()
  }

  private drawDetail(): void {
    const cam = this.ctx.camPos()
    const m = this.model.parts
    // From the socket's top (wall power comes up the stem) into the foot of the driver board.
    const a = m["LampSocket"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, 4.6, 0))
    const drv = m["LampDriver"].getTransform().getWorldTransform()
    const b = drv.multiplyPoint(new vec3(0, -0.1, 0))
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    // side = ab × (cam − the middle of ab)
    const vx = cam.x - (a.x + b.x) / 2
    const vy = cam.y - (a.y + b.y) / 2
    const vz = cam.z - (a.z + b.z) / 2
    let sx = aby * vz - abz * vy
    let sy = abz * vx - abx * vz
    let sz = abx * vy - aby * vx
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz)
    if (sl > 1e-6) {
      sx /= sl
      sy /= sl
      sz /= sl
    } else {
      sx = 1
      sy = 0
      sz = 0
    }
    const w = this.wavePts
    let dev = 0
    for (let i = 0; i < WAVE_PTS; i++) {
      const t = i / (WAVE_PTS - 1)
      // Pinned at both ends, flowing toward the driver.
      const env = Math.sqrt(Math.sin(Math.PI * t))
      const off = WAVE_AMP * env * Math.sin(2 * Math.PI * (WAVE_N * t - this.wavePhase))
      const abs = off < 0 ? -off : off
      if (abs > dev) dev = abs
      const x = a.x + abx * t + sx * off
      const y = a.y + aby * t + sy * off
      const z = a.z + abz * t + sz * off
      w.x[i] = x
      w.y[i] = y
      w.z[i] = z
      w.a[i] = 0.85
      const dx = x - cam.x
      const dy = y - cam.y
      const dz = z - cam.z
      const d = 0.0016 * Math.sqrt(dx * dx + dy * dy + dz * dz)
      this.waveW[i] = d > 0.14 ? d : 0.14
    }
    this.waveDev = dev
    this.wave.commit(w, cam, this.waveW, true)
    // Out of the top of the driver board to the LED chips: a flat line, even pulses moving steadily.
    const c0 = drv.multiplyPoint(new vec3(0, 4.75, 0))
    const c1 = this.model.ledCenter()
    const f = this.flatPts
    const L = c1.distance(c0)
    for (let i = 0; i < FLAT_PTS; i++) {
      const t = i / (FLAT_PTS - 1)
      const x = c0.x + (c1.x - c0.x) * t
      const y = c0.y + (c1.y - c0.y) * t
      const z = c0.z + (c1.z - c0.z) * t
      f.x[i] = x
      f.y[i] = y
      f.z[i] = z
      const u = (((t * L) / 1.2 - this.flatPhase * 3) % 1 + 1) % 1
      f.a[i] = 0.55 + 0.45 * (1 - u) * (1 - u)
      const dx = x - cam.x
      const dy = y - cam.y
      const dz = z - cam.z
      const d = 0.0014 * Math.sqrt(dx * dx + dy * dy + dz * dz)
      this.flatW[i] = d > 0.12 ? d : 0.12
    }
    this.flat.commit(f, cam, this.flatW, true)
  }

  // =====================================================================================
  // Labels (no label overlaps another label or a part, as the user sees them)
  // =====================================================================================

  private labelled(p: Part): boolean {
    const sp = p.spec
    if (!sp.label) return false
    const by = sp.revealWith ? this.byKey[sp.revealWith] : p
    if (!by || by.e < 0.8 || !p.so.isEnabledInHierarchy) return false
    for (let i = 0; i < sp.groups.length; i++) if (!this.ctx.groupSolid(sp.groups[i])) return false
    return true
  }

  private updateLabels(): void {
    const labels = this.ctx.labels
    let n = 0
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]
      const it = p.item
      if (!it) continue
      if (this.labelled(p)) {
        if (!p.anchorLocal) p.anchorLocal = this.anchorOf(p)
        it.anchor = p.anchorSo.getTransform().getWorldTransform().multiplyPoint(p.anchorLocal)
        this.want[n++] = it
      } else {
        if (labels.isShown(it.id)) labels.hide(it.id)
        this.planner.drop(it.key)
      }
    }
    if (n > 0) this.planner.update(this.want, n, this.s)
  }

  /** The side a part's label prefers (+1 the user's right, −1 left; 0 outward from the axis). */
  private sideOf(sp: PartSpec): number {
    const away = this.ctx.driverSide() >= 0 ? 1 : -1
    switch (sp.side) {
      case "right":
        return 1
      case "left":
        return -1
      case "away":
        return away
      case "rail":
        return -away
      default:
        return 0
    }
  }

  /**
   * The label's anchor in its anchor object's space (the part's own space: model space less its
   * pivot), on the side of the part its label prefers and facing the user.
   */
  private anchorOf(p: Part): vec3 {
    const sp = p.spec
    const s = this.sideOf(sp)
    const R = this.viewRight
    const C = this.viewToCam
    // Level directions in the copy's space, turned `deg` from the user toward the label's side.
    const toward = (deg: number) => C.uniformScale(Math.cos(deg * DEG)).add(R.uniformScale((s || 1) * Math.sin(deg * DEG))).normalize()
    if (sp.key === "shade") return this.halves[0].dir.uniformScale(lampShadeR(PAPER_MID) + 0.2)
    if (sp.key === "glass") return new vec3(0, G.bulbTopY - this.model.pivot("LampBulbGlass").y, 0)
    if (sp.key === "frame") {
      // The frame's vertical wire that best faces the user on the label's side (the four are at 45°, 135°, …).
      const want = toward(40)
      let best = vec3.zero()
      let bd = -2
      for (let q = 0; q < 4; q++) {
        const a = (q / 4) * TAU + TAU / 8
        const d = new vec3(Math.cos(a), 0, Math.sin(a))
        if (d.dot(want) > bd) {
          bd = d.dot(want)
          best = d
        }
      }
      return best.uniformScale(lampShadeR(FRAME_Y) - 0.22).add(new vec3(0, FRAME_Y - G.shadeSeatY, 0))
    }
    if (sp.key === "chips") {
      // The chip of the outer ring nearest the user's view on the label's side.
      const want = toward(55)
      const n = Math.round(Math.atan2(want.z, want.x) / (TAU / 8))
      const a = n * (TAU / 8)
      return new vec3(Math.cos(a) * CHIP_RING, 0.1, Math.sin(a) * CHIP_RING)
    }
    if (sp.round) return toward(65).uniformScale(sp.round.r).add(new vec3(0, sp.round.y, 0))
    return sp.anchor ?? vec3.zero()
  }
}

function toViewX(F: ViewFrame, p: vec3): number {
  return toView(F, p).x
}
