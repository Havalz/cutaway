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
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {boxCorners, hull2, polyGap, rect2, toView, viewFrame} from "./CutawayLayout"
import {PathRibbon} from "./CutawayLampLight"
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

interface Part {
  spec: PartSpec
  so: SceneObject
  anchorSo: SceneObject
  rest: {pos: vec3; rot: quat; scale: vec3}
  e: number
  raw: number
  freed: boolean
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

  /** One entry per part that frees itself: where on the slider, and whether it has (the rail's ticks). */
  freeTicks(): {at: number; freed: boolean}[] {
    return this.parts.filter((p) => p.spec.special || p.spec.d.length > 0).map((p) => ({at: p.spec.a + 0.02 * p.spec.w, freed: p.freed}))
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
  private detail = 0
  private wavePhase = 0
  private flatPhase = 0
  private waveDev = 0
  private flatDev = 0
  private labelPlans = new Map<string, {o: vec2; side: number; soft: boolean}>()
  private labelShownOff = new Map<string, vec2>()

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
      const p: Part = {spec, so, anchorSo, rest: {pos: tr.getLocalPosition(), rot: tr.getLocalRotation(), scale: tr.getLocalScale()}, e: 0, raw: 0, freed: false}
      this.parts.push(p)
      this.byKey[spec.key] = p
    }
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
      if (this.labelPlans.size > 0) this.hideLabels()
      return
    }
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
      const moves = sp.special || sp.d.length > 0
      if (raw > 0.02 && !p.freed && moves) {
        p.freed = true
        this.ctx.partSound(p.so.getTransform().getWorldPosition())
        this.ctx.log("lamp:free:" + sp.key)
      } else if (raw <= 0 && p.freed) p.freed = false
    }
    this.updateDetail(dt, s, lit)
    if (apart && labels) this.updateLabels()
    else this.hideLabels()
  }

  /** Every label off (Reset, put back, reassembled). */
  hideLabels(): void {
    for (const p of this.parts) if (p.spec.label && this.ctx.labels.isShown("lamp_" + p.spec.key)) this.ctx.labels.hide("lamp_" + p.spec.key)
    this.labelPlans.clear()
    this.labelShownOff.clear()
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
    this.viewRight = right
    this.viewToCam = toCam
    const yawOf = (v: vec3) => Math.atan2(v.x, v.z)
    // A turn about +Y by θ adds θ to atan2(x, z): half A turns onto the user's right.
    this.paperYaw = yawOf(right) - yawOf(this.halves[0].dir)
    this.driverDir = right.uniformScale(this.ctx.driverSide() >= 0 ? 1 : -1)
    // The driver's parts are on its +Z face: turn that face to the user.
    this.driverYaw = yawOf(toCam)
  }

  // =====================================================================================
  // Live detail: wall power (a sine) into the driver, a steady current out to the chips
  // =====================================================================================

  private setDetail(k: number): void {
    this.detail = k
    for (const r of [this.wave, this.flat]) {
      if (!r) continue
      r.so.enabled = k > 1e-4
      r.mat.mainPass.baseColor = new vec4(k, k, k, k)
    }
  }

  private updateDetail(dt: number, s: number, lit: number): void {
    const k = clamp01((s - LIVE_AT) / (1 - LIVE_AT)) * clamp01(lit)
    this.setDetail(k)
    this.waveDev = 0
    this.flatDev = 0
    if (k <= 1e-4 || !this.wave || !this.flat) return
    this.wavePhase += WAVE_HZ * dt
    this.flatPhase += dt
    const cam = this.ctx.camPos()
    const m = this.model.parts
    // From the socket's top (wall power comes up the stem) into the foot of the driver board.
    const a = m["LampSocket"].getTransform().getWorldTransform().multiplyPoint(new vec3(0, 4.6, 0))
    const drv = m["LampDriver"].getTransform().getWorldTransform()
    const b = drv.multiplyPoint(new vec3(0, -0.1, 0))
    const ab = b.sub(a)
    const side = ab.cross(cam.sub(vec3.lerp(a, b, 0.5)))
    const sideN = side.length > 1e-6 ? side.normalize() : vec3.right()
    const pts: vec3[] = []
    const al: number[] = []
    const wd: number[] = []
    for (let i = 0; i < WAVE_PTS; i++) {
      const t = i / (WAVE_PTS - 1)
      // Pinned at both ends, flowing toward the driver.
      const env = Math.sqrt(Math.sin(Math.PI * t))
      const off = WAVE_AMP * env * Math.sin(2 * Math.PI * (WAVE_N * t - this.wavePhase))
      this.waveDev = Math.max(this.waveDev, Math.abs(off))
      pts.push(a.add(ab.uniformScale(t)).add(sideN.uniformScale(off)))
      al.push(0.85)
      wd.push(Math.max(0.14, 0.0016 * pts[i].distance(cam)))
    }
    this.wave.update(pts, cam, wd, al)
    // Out of the top of the driver board to the LED chips: a flat line, even pulses moving steadily.
    const c0 = drv.multiplyPoint(new vec3(0, 4.75, 0))
    const c1 = this.model.ledCenter()
    const fp: vec3[] = []
    const fa: number[] = []
    const fw: number[] = []
    const L = c1.distance(c0)
    for (let i = 0; i < FLAT_PTS; i++) {
      const t = i / (FLAT_PTS - 1)
      const p = vec3.lerp(c0, c1, t)
      fp.push(p)
      const u = (((t * L) / 1.2 - this.flatPhase * 3) % 1 + 1) % 1
      fa.push(0.55 + 0.45 * Math.pow(1 - u, 2))
      fw.push(Math.max(0.12, 0.0014 * p.distance(cam)))
    }
    this.flat.update(fp, cam, fw, fa)
  }

  // =====================================================================================
  // Labels (no label overlaps another label or a part, as the user sees them)
  // =====================================================================================

  private labelled(p: Part): boolean {
    const sp = p.spec
    if (!sp.label) return false
    const by = sp.revealWith ? this.byKey[sp.revealWith] : p
    if (!by || by.e < 0.8) return false
    return p.so.isEnabledInHierarchy && sp.groups.every((g) => this.ctx.groupSolid(g))
  }

  private updateLabels(): void {
    const labels = this.ctx.labels
    const want: Part[] = []
    for (const p of this.parts) {
      if (!p.spec.label) continue
      const id = "lamp_" + p.spec.key
      if (this.labelled(p)) want.push(p)
      else {
        if (labels.isShown(id)) labels.hide(id)
        this.labelPlans.delete(p.spec.key)
      }
    }
    if (!want.length) return
    const center = this.ctx.stageCenter()
    const F = viewFrame(this.ctx.camPos(), center)
    const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
    const hard: vec2[][] = []
    const soft: vec2[][] = []
    // The parts' own extents (their vertices); the long cord's box would be mostly empty table, so it is left out.
    for (const m of this.model.meshList()) {
      if (m.part === "LampCord" || m.part === "LampWires") continue
      const so = m.rmv.getSceneObject()
      const solid = this.ctx.meshSolid(m.rmv)
      if (solid === null || !so.isEnabledInHierarchy) continue
      ;(solid ? hard : soft).push(view(boxCorners(so.getTransform().getWorldTransform(), m.lo, m.hi)))
    }
    const cap = labels.getCaptionQuad()
    if (cap) hard.push(view(cap))
    for (const b of this.ctx.railBoxes()) hard.push(view(b))
    const axis = toView(F, this.model.root.getTransform().getWorldPosition())

    const dd = labels.getDesignDistance()
    const M = 0.8
    const placed: vec2[][] = []
    const dt = getDeltaTime()
    for (const p of want) {
      const id = "lamp_" + p.spec.key
      const anchorW = p.anchorSo.getTransform().getWorldTransform().multiplyPoint(this.anchorOf(p))
      const A = toView(F, anchorW)
      const dA = Math.max(1, anchorW.sub(F.eye).dot(F.f))
      const size = labels.measure(p.spec.label).uniformScale(F.D / dd)
      const g = (0.6 * F.D) / dd
      // The part's own side, else outward from the lamp's axis, as the user sees it.
      const sh = this.sideOf(p.spec) || (A.x - axis.x >= 0 ? 1 : -1)

      const sv = p.spec.below ? -1 : 1
      const box = (o: vec2, side: number) => {
        const e = A.add(o)
        return side > 0 ? rect2(e.x + g, e.x + g + size.x, e.y - size.y / 2, e.y + size.y / 2) : rect2(e.x - g - size.x, e.x - g, e.y - size.y / 2, e.y + size.y / 2)
      }
      const clear = (o: vec2, side: number, useSoft: boolean) => {
        const b = box(o, side)
        for (const h of hard) if (polyGap(b, h) < M) return false
        for (const h of placed) if (polyGap(b, h) < M) return false
        const seg = [A, A.add(o)]
        for (const h of placed) if (polyGap(seg, h) < 0.3) return false
        if (useSoft) for (const h of soft) if (polyGap(b, h) < M) return false
        return true
      }
      let plan = this.labelPlans.get(p.spec.key) ?? null
      if (plan && !clear(plan.o, plan.side, plan.soft)) plan = null
      if (!plan) plan = this.search(clear, sv, sh)
      if (!plan) plan = {o: new vec2(sh * 3, sv * 6), side: sh, soft: false}
      this.labelPlans.set(p.spec.key, plan)
      placed.push(box(plan.o, plan.side))
      placed.push([A, A.add(plan.o)])
      let o = this.labelShownOff.get(p.spec.key)
      const fresh = !labels.isShown(id) || !o
      o = fresh ? plan.o : o.add(plan.o.sub(o).uniformScale(1 - Math.exp(-dt / 0.07)))
      this.labelShownOff.set(p.spec.key, o)
      const k = dA / F.D
      const textPos = anchorW.add(F.r.uniformScale(o.x * k)).add(F.u.uniformScale(o.y * k))
      if (fresh) labels.show(id, p.spec.label, textPos, anchorW, plan.side)
      else labels.move(id, textPos, anchorW, plan.side)
    }
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

  private search(clear: (o: vec2, side: number, soft: boolean) => boolean, sv: number, sh: number): {o: vec2; side: number; soft: boolean} | null {
    for (const useSoft of [true, false]) {
      for (const v of [sv, -sv]) {
        for (const rise of [0, 3, 4.5, 6, 8, 10, 12.5, 15, 18, 22]) {
          for (const lat of [0, 2.5, 5, 8, 11, 14]) {
            for (const side of [sh, -sh]) {
              const o = new vec2(side * lat, v * rise)
              if (clear(o, side, useSoft)) return {o, side, soft: useSoft}
            }
          }
        }
      }
    }
    return null
  }
}
