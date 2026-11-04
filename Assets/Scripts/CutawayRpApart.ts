/**
 * Record player hero: take it apart (recordplayer-hero.md §4, Phase B).
 *
 * Driven by the "Take apart" slider once the copy hovers. The parts separate upward in sequence
 * with a short stagger: the dust cover; the record; the platter and mat (revealing the belt,
 * sub-platter and motor); the tonearm, which rises and moves out (its counterweight slides off the
 * back); the cartridge, which leaves the headshell, grows so its inside reads, and opens (its body
 * lifts off the magnet between the two coils); then the stylus. The plinth fades to an outline at
 * about 15%. Every separated or revealed solid part is labelled (four words or fewer), each label
 * clear of the parts, the other labels, the caption and the rail as the user sees them.
 *
 * Live detail while apart: the motor turns and drives the belt, which turns the sub-platter; inside
 * the open cartridge the magnet wiggles between the coils and the coils pulse cyan in step (the
 * current is largest where the magnet moves fastest).
 *
 * Back at 0 every part returns exactly to its rest transform.
 */
import {MeshKit, setFade, spawnMesh} from "./CutawayGeometry"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {hull2, meshBoxes, polyGap, rect2, toView, viewFrame} from "./CutawayLayout"
import {RecordPlayerModel, RP_GEOM, rpBeltRing} from "./CutawayRecordPlayerModel"
import {RpDeck} from "./CutawayRpDeck"
import {RP_S} from "./CutawayRpSound"
import {ENERGY, ink} from "./CutawayStyle"
import {clamp01, easeInOutCubic, faceToward} from "./CutawayTween"

const G = RP_GEOM
const AMBER = ENERGY.motion
const SIGNAL = ENERGY.signal

/** The cartridge grows this much as it leaves the headshell, so the magnet and coils read. */
const CART_ZOOM = 4
/** The live detail (motor, magnet, coils) runs once everything is apart. */
const LIVE_AT = 0.97
/** The magnet's side-to-side swing inside the coils (cartridge space, cm). */
const MAGNET_SWING = 0.05
/** The magnet's rest position on the cantilever (stylus space) and the coils' centres (coils space). */
const MAG_POS = new vec3(0, 0.02, -0.25)
const COIL_AXES = [new vec3(-0.6, 0.8, -0.1).normalize(), new vec3(0.6, 0.8, -0.1).normalize()]
const BELT_DASHES = 5

interface PartSpec {
  key: string
  label: string | null
  part: string
  /** Offset from rest in the part's parent space (cm at 1x), and the scale it grows to. */
  d: vec3
  /** Or the offset in model space (converted to the parent's space at rest). */
  dModel?: vec3
  zoom?: number
  /** Its window on the slider: separates from `a` over `w`. */
  a: number
  w: number
  /** Label anchor in the anchor object's local space (that object defaults to the part). */
  anchor: vec3
  anchorPart?: string
  /** Preferred label direction (model space): up or down, left or right of the part. */
  labelDir: vec3
  /** Look groups that must be solid for its label. */
  groups: string[]
  /** For parts revealed rather than moved: shown with this part's progress. */
  revealWith?: string
}

const coverAnchor = new vec3(0, 2.85, G.coverDepth * 0.62)
const beltAnchor = (() => {
  // The middle of the belt's straight run from the sub-platter to the motor pulley.
  const ring = rpBeltRing()
  const a = ring[48].p
  const b = ring[49].p
  return new vec3((a.x + b.x) / 2, 0.15, (a.y + b.y) / 2)
})()

const SPECS: PartSpec[] = [
  {key: "cover", label: "Dust cover", part: "RpDustCover", d: new vec3(0, 7, -11), a: 0, w: 0.3, anchor: coverAnchor, labelDir: new vec3(0, 1, 0), groups: ["cover"]},
  {key: "record", label: "Record", part: "RpRecord", d: new vec3(0, 13, 0), a: 0.1, w: 0.3, anchor: new vec3(0, 0.15, 12), labelDir: new vec3(0, 1, 1), groups: ["record"]},
  {key: "platter", label: "Platter", part: "RpPlatter", d: new vec3(0, 7, 0), a: 0.2, w: 0.3, anchor: new vec3(0, 1.0, G.platterR), labelDir: new vec3(0, 0.3, 1), groups: ["platter"]},
  {key: "belt", label: "Belt", part: "RpBelt", d: vec3.zero(), a: 0.2, w: 0.3, anchor: beltAnchor, labelDir: new vec3(0, -1, 1), groups: ["belt"], revealWith: "platter"},
  {key: "motor", label: "Motor", part: "RpMotor", d: vec3.zero(), a: 0.2, w: 0.3, anchor: new vec3(0, 1.32, 1.6), labelDir: new vec3(0, -1, 1), groups: ["motor"], revealWith: "platter"},
  {key: "arm", label: "Tonearm", part: "RpTonearm", d: new vec3(11, 3, 1), a: 0.32, w: 0.3, anchor: new vec3(0.75, 0.45, 8.5), labelDir: new vec3(1, 1, 0), groups: ["arm"]},
  {key: "counterweight", label: "Counterweight", part: "RpCounterweight", d: new vec3(0, 0, -3.5), a: 0.42, w: 0.25, anchor: new vec3(0, 1.3, 0), labelDir: new vec3(0, 1, -1), groups: ["counterweight"]},
  {key: "cartridge", label: "Cartridge", part: "RpCartridge", d: vec3.zero(), dModel: new vec3(7, -3.5, 0.5), zoom: CART_ZOOM, a: 0.5, w: 0.25, anchor: new vec3(0, 0.48, 0), anchorPart: "RpCartridgeBody", labelDir: new vec3(1, 1, 0), groups: ["cartridge"]},
  {key: "body", label: null, part: "RpCartridgeBody", d: new vec3(0, 0.75, 0), a: 0.62, w: 0.2, anchor: vec3.zero(), labelDir: vec3.up(), groups: ["cartridge"]},
  {key: "coils", label: "Magnet and coils", part: "RpCartridgeCoils", d: vec3.zero(), a: 0.62, w: 0.2, anchor: COIL_AXES[1].uniformScale(0.42), labelDir: new vec3(1, 0, 0), groups: ["coils", "magnet"], revealWith: "body"},
  {key: "stylus", label: "Stylus", part: "RpStylus", d: new vec3(0, -0.5, 0.6), a: 0.72, w: 0.25, anchor: new vec3(0, -0.39, 0.44), labelDir: new vec3(1, -1, 0), groups: ["stylus"]}
]

interface Part {
  spec: PartSpec
  /** The offset in the part's parent space. */
  d: vec3
  so: SceneObject
  anchorSo: SceneObject
  rest: {pos: vec3; rot: quat; scale: vec3}
  e: number
  raw: number
  freed: boolean
}

export interface RpApartCtx {
  labels: CutawayLabelsUI
  glowMat: Material
  camPos: () => vec3
  stageCenter: () => vec3
  /** Rail boxes and the caption: kept clear of labels. */
  railBoxes: () => vec3[][]
  /** A look group's fill (1 = solid) and fade. */
  setGroup: (g: string, fill: number, fade: number) => void
  groupSolid: (g: string) => boolean
  /** Whether a mesh is drawn solid (true), as an outline (false) or not at all (null). */
  meshSolid: (rmv: RenderMeshVisual) => boolean | null
  partSound: (p: vec3) => void
  log: (p: string) => void
}

export interface RpApartInfo {
  s: number
  live: boolean
  parts: {key: string; label: string | null; moved: number; labelShown: boolean; solid: boolean}[]
  /** The motor's own turning (rad) and speed (rad/s), the belt's travel (cm at 1x). */
  driveAngle: number
  driveOmega: number
  beltTravel: number
  /** The magnet's side offset (cartridge space, cm) and the coils' glow (0..1). */
  magnetOffset: number
  coilGlow: number
  plinthFill: number
  interiorShown: boolean
  /** The largest distance (world cm) of any part from its rest, relative to the copy. */
  maxRestError: number
}

export class RpApart {
  private parts: Part[] = []
  private byKey: {[k: string]: Part} = {}
  private allRest: {so: SceneObject; pos: vec3}[] = []
  private s = 0
  private interiorShown = false
  private magnet: Transform
  private magnetPhase = 0
  private magnetOffset = 0
  private coilGlow = 0
  private coilGlowMat: Material | null = null
  private coilGlowSo: SceneObject[] = []
  private beltPts: vec3[] = []
  private beltLen = 0
  private beltTravel = 0
  private dashes: SceneObject[] = []
  private dashMat: Material | null = null
  private markers: {so: SceneObject; mat: Material}[] = []
  private wires: SceneObject[] = []
  private plinthFill = 1
  private labelPlans = new Map<string, {o: vec2; side: number; soft: boolean}>()
  private labelShownOff = new Map<string, vec2>()

  /** Built while the model is still at the origin, unrotated, at scale 1. */
  constructor(
    private model: RecordPlayerModel,
    private deck: RpDeck,
    private ctx: RpApartCtx
  ) {
    const root = model.root
    const inv = root.getTransform().getInvertedWorldTransform()
    for (const name of Object.keys(model.parts)) {
      const so = model.parts[name]
      this.allRest.push({so, pos: inv.multiplyPoint(so.getTransform().getWorldPosition())})
    }
    for (const spec of SPECS) {
      const so = spec.part === "RpCartridgeBody" ? findChild(model.parts["RpCartridge"], "RpCartridgeBody") : model.parts[spec.part]
      if (!so) continue
      const anchorSo = spec.anchorPart ? (spec.anchorPart === "RpCartridgeBody" ? findChild(model.parts["RpCartridge"], "RpCartridgeBody") : model.parts[spec.anchorPart]) ?? so : so
      const tr = so.getTransform()
      let d = spec.d
      if (spec.dModel) {
        // Model space → the parent's space (at rest the parents are unscaled within the model).
        const par = so.getParent().getTransform().getWorldRotation()
        const rel = root.getTransform().getWorldRotation().invert().multiply(par)
        d = rel.invert().multiplyVec3(spec.dModel)
      }
      const p: Part = {spec, d, so, anchorSo, rest: {pos: tr.getLocalPosition(), rot: tr.getLocalRotation(), scale: tr.getLocalScale()}, e: 0, raw: 0, freed: false}
      this.parts.push(p)
      this.byKey[spec.key] = p
    }
    this.magnet = model.parts["RpCartridgeMagnet"].getTransform()
    for (const n of ["RpSignalWiresArm", "RpSignalWires"]) if (model.parts[n]) this.wires.push(model.parts[n])
    this.buildLiveDetail()
  }

  get value(): number {
    return this.s
  }

  get live(): boolean {
    return this.s >= LIVE_AT
  }

  /**
   * Separate the parts for slider value `s` (0..1, already rate-limited by the stage) and run the
   * live detail; `freq` is the Pitch slider's f (the magnet wiggles at f / S, like everything else).
   */
  update(dt: number, s: number, freq: number): void {
    this.s = s
    const apart = s > 1e-4
    if (apart !== this.interiorShown) {
      this.interiorShown = apart
      this.model.setInteriorVisible(apart)
      // The signal wires stay out of the exploded view (they would dangle from the parts).
      for (const w of this.wires) w.enabled = false
      this.ctx.log(apart ? "rp:apart" : "rp:together")
    }
    for (const p of this.parts) {
      const sp = p.spec
      const raw = clamp01((s - sp.a) / sp.w)
      p.raw = raw
      p.e = easeInOutCubic(raw)
      const tr = p.so.getTransform()
      if (raw <= 0) {
        // Exactly at rest.
        tr.setLocalPosition(p.rest.pos)
        tr.setLocalScale(p.rest.scale)
      } else {
        tr.setLocalPosition(p.rest.pos.add(p.d.uniformScale(p.e)))
        if (sp.zoom) tr.setLocalScale(p.rest.scale.uniformScale(1 + (sp.zoom - 1) * p.e))
      }
      if (raw > 0.02 && !p.freed && p.d.length > 0) {
        p.freed = true
        this.ctx.partSound(p.so.getTransform().getWorldPosition())
        this.ctx.log("rp:free:" + sp.key)
      } else if (raw <= 0 && p.freed) p.freed = false
    }
    // The plinth (and what is fixed to it) fades to an outline as the first parts leave.
    const ep = easeInOutCubic(clamp01(s / 0.3))
    this.plinthFill = 1 - 0.85 * ep
    this.ctx.setGroup("plinth", this.plinthFill, 1)
    this.updateLive(dt, s, freq)
    if (apart) this.updateLabels()
    else this.hideLabels()
  }

  /** Every label off (Reset, put back, reassembled). */
  hideLabels(): void {
    for (const p of this.parts) if (p.spec.label && this.ctx.labels.isShown("rp_" + p.spec.key)) this.ctx.labels.hide("rp_" + p.spec.key)
    this.labelPlans.clear()
    this.labelShownOff.clear()
  }

  getInfo(): RpApartInfo {
    const root = this.model.root.getTransform()
    const inv = root.getInvertedWorldTransform()
    const sc = root.getWorldScale().x
    const moved = (so: SceneObject, rest: vec3) => inv.multiplyPoint(so.getTransform().getWorldPosition()).distance(rest) * sc
    const restOf = new Map<SceneObject, vec3>()
    for (const r of this.allRest) restOf.set(r.so, r.pos)
    let maxErr = 0
    for (const r of this.allRest) maxErr = Math.max(maxErr, moved(r.so, r.pos))
    return {
      s: this.s,
      live: this.live,
      parts: this.parts
        .filter((p) => p.spec.label)
        .map((p) => ({
          key: p.spec.key,
          label: p.spec.label,
          moved: restOf.has(p.so) ? moved(p.so, restOf.get(p.so)) : 0,
          labelShown: this.ctx.labels.isShown("rp_" + p.spec.key),
          solid: p.spec.groups.every((g) => this.ctx.groupSolid(g)) && p.so.isEnabledInHierarchy
        })),
      driveAngle: this.deck.driveAngle,
      driveOmega: this.deck.driveOmega,
      beltTravel: this.beltTravel,
      magnetOffset: this.magnetOffset,
      coilGlow: this.coilGlow,
      plinthFill: this.plinthFill,
      interiorShown: this.interiorShown,
      maxRestError: maxErr
    }
  }

  // =====================================================================================
  // Live detail: motor, belt, sub-platter; magnet and coils
  // =====================================================================================

  private buildLiveDetail(): void {
    const m = this.model.parts
    // Coils: a cyan glow round each, facing the eye, pulsing with the current.
    const coils = m["RpCartridgeCoils"]
    const gk = new MeshKit()
    gk.addFanXY(0, 0, 0.26, 0, Math.PI * 2, ink(SIGNAL, 0.55), ink(SIGNAL, 0), 28)
    gk.addArcXY(0, 0, 0.22, 0.03, 0, Math.PI * 2, ink(SIGNAL, 0.9), 28)
    const mesh = gk.build()
    for (const ax of COIL_AXES) {
      const g = spawnMesh(coils, "RpCoilGlow", mesh, this.ctx.glowMat, ax.uniformScale(0.42), this.coilGlowMat ?? undefined)
      this.coilGlowMat = g.mat
      this.coilGlowSo.push(g.so)
    }
    setFade(this.coilGlowMat, 0)
    // Belt: a few bright dashes that run round it with the belt.
    const ring = rpBeltRing()
    this.beltPts = ring.map((r) => new vec3(r.p.x, 0.16, r.p.y))
    this.beltPts.push(this.beltPts[0])
    this.beltLen = 0
    for (let i = 1; i < this.beltPts.length; i++) this.beltLen += this.beltPts[i].distance(this.beltPts[i - 1])
    const dk = new MeshKit()
    dk.addTube([new vec3(-0.55, 0, 0), new vec3(0.55, 0, 0)], 0.07, ink(AMBER, 0.95), 5, 4)
    const dmesh = dk.build()
    for (let i = 0; i < BELT_DASHES; i++) {
      const d = spawnMesh(m["RpBelt"], "RpBeltDash", dmesh, this.ctx.glowMat, vec3.zero(), this.dashMat ?? undefined)
      this.dashMat = d.mat
      this.dashes.push(d.so)
    }
    setFade(this.dashMat, 0)
    // Markers on the pulley and the sub-platter, so their turning shows.
    const mark = (part: string, y: number, r0: number, r1: number) => {
      const k = new MeshKit()
      k.addTube([new vec3(r0, y, 0), new vec3(r1, y, 0)], 0.06, ink(AMBER, 0.9), 5, 4)
      const s = spawnMesh(m[part], part + "Mark", k.build(), this.ctx.glowMat)
      setFade(s.mat, 0)
      this.markers.push({so: s.so, mat: s.mat})
    }
    mark("RpMotorPulley", 0.24, 0.05, 0.46)
    mark("RpSubPlatter", 0.66, 1.1, 5.3)
  }

  private updateLive(dt: number, s: number, freq: number): void {
    const liveK = clamp01((s - LIVE_AT) / (1 - LIVE_AT))
    this.deck.setDrive(this.live)
    // The belt runs at the sub-platter's groove speed; the dashes ride it.
    this.beltTravel = (this.beltTravel + this.deck.beltSpeed * dt) % Math.max(1e-3, this.beltLen)
    const shown = this.interiorShown ? clamp01(s / 0.4) : 0
    if (this.dashMat) setFade(this.dashMat, shown * clamp01(this.deck.driveOmega / 1.5))
    for (let i = 0; i < this.dashes.length; i++) {
      const so = this.dashes[i]
      so.enabled = this.interiorShown
      if (!so.enabled) continue
      const at = (this.beltTravel + (i * this.beltLen) / this.dashes.length) % this.beltLen
      const {p, t} = this.beltAt(at)
      const tr = so.getTransform()
      tr.setLocalPosition(p)
      tr.setLocalRotation(quat.angleAxis(Math.atan2(-t.z, t.x), vec3.up()))
    }
    for (const mk of this.markers) {
      mk.so.enabled = this.interiorShown
      setFade(mk.mat, shown)
    }
    // The magnet wiggles at f / S, the same slowed rate as the cone; the coils glow with its speed.
    this.magnetPhase += 2 * Math.PI * (freq / RP_S) * dt
    const stylus = this.byKey["stylus"]
    const back = stylus ? stylus.d.uniformScale(stylus.e) : vec3.zero()
    this.magnetOffset = MAGNET_SWING * liveK * Math.sin(this.magnetPhase)
    // It stays between the coils while the stylus is drawn out (shown apart), and wiggles there.
    this.magnet.setLocalPosition(MAG_POS.sub(back).add(new vec3(this.magnetOffset, 0, 0)))
    if (s <= 0) this.magnet.setLocalPosition(MAG_POS)
    this.coilGlow = liveK * (0.2 + 0.8 * Math.abs(Math.cos(this.magnetPhase)))
    if (this.coilGlowMat) setFade(this.coilGlowMat, this.coilGlow)
    const cam = this.ctx.camPos()
    for (const g of this.coilGlowSo) {
      g.enabled = liveK > 0
      if (g.enabled) g.getTransform().setWorldRotation(faceToward(cam.sub(g.getTransform().getWorldPosition())))
    }
  }

  private beltAt(d: number): {p: vec3; t: vec3} {
    let acc = 0
    for (let i = 1; i < this.beltPts.length; i++) {
      const a = this.beltPts[i - 1]
      const b = this.beltPts[i]
      const l = a.distance(b)
      if (acc + l >= d) {
        const k = l > 1e-6 ? (d - acc) / l : 0
        return {p: vec3.lerp(a, b, k), t: b.sub(a).normalize()}
      }
      acc += l
    }
    return {p: this.beltPts[0], t: vec3.right()}
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
      const id = "rp_" + p.spec.key
      if (this.labelled(p)) want.push(p)
      else {
        if (labels.isShown(id)) labels.hide(id)
        this.labelPlans.delete(p.spec.key)
      }
    }
    if (!want.length) return
    const F = viewFrame(this.ctx.camPos(), this.ctx.stageCenter())
    const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
    const hard: vec2[][] = []
    const soft: vec2[][] = []
    for (const m of this.model.meshList()) {
      const solid = this.ctx.meshSolid(m.rmv)
      if (solid === null || !m.rmv.getSceneObject().isEnabledInHierarchy) continue
      for (const b of meshBoxes(m.rmv.getSceneObject())) (solid ? hard : soft).push(view(b))
    }
    const cap = labels.getCaptionQuad()
    if (cap) hard.push(view(cap))
    for (const b of this.ctx.railBoxes()) hard.push(view(b))

    const rot = this.model.root.getTransform().getWorldRotation()
    const dd = labels.getDesignDistance()
    const M = 0.8
    const placed: vec2[][] = []
    const dt = getDeltaTime()
    for (const p of want) {
      const id = "rp_" + p.spec.key
      const anchorW = p.anchorSo.getTransform().getWorldTransform().multiplyPoint(p.spec.anchor)
      const A = toView(F, anchorW)
      const dA = Math.max(1, anchorW.sub(F.eye).dot(F.f))
      const size = labels.measure(p.spec.label).uniformScale(F.D / dd)
      const g = (0.6 * F.D) / dd
      const dirW = rot.multiplyVec3(p.spec.labelDir)
      const sv = dirW.dot(F.u) >= 0 ? 1 : -1
      const sh = dirW.dot(F.r) >= 0 ? 1 : -1
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

  private search(clear: (o: vec2, side: number, soft: boolean) => boolean, sv: number, sh: number): {o: vec2; side: number; soft: boolean} | null {
    for (const useSoft of [true, false]) {
      for (const v of [sv, -sv]) {
        for (const rise of [3, 4.5, 6, 8, 10, 12.5, 15, 18, 22]) {
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

function findChild(so: SceneObject, name: string): SceneObject | null {
  for (let i = 0; i < so.getChildrenCount(); i++) if (so.getChild(i).name === name) return so.getChild(i)
  return null
}

