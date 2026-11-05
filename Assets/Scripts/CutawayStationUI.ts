import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setFade, spawnMesh} from "./CutawayGeometry"
import {ink, INK, NO_LIGHT} from "./CutawayStyle"
import {PillKind, UiPill} from "./CutawayUiKit"
import {clamp01, easeInOutCubic, easeOutCubic, Fader, faceToward, Pop, Spring} from "./CutawayTween"

export interface StationVisual {
  idleDot: boolean
  explainedDot: boolean
  chip: boolean
  questions: boolean[]
  stop: boolean
  closer: boolean
  /** How far the opening has revealed the idle dot (1 once it's up). */
  idleDotReveal: number
}

interface Piece {
  pop: Pop
  so: SceneObject
  btn: Button
  pill?: UiPill
}

/**
 * The UI for one explained object: idle dot, name chip, questions, Stop pill, the scan and the
 * "explained" dot. Pure view: CutawayMain decides what is shown and listens to the events.
 * The panel is built at the 110 cm design scale and scaled with distance so it reads the same
 * from ~3–5 m. Everything is drawn with light (additive): glass, never dark panels.
 */
@component
export class CutawayStationUI extends BaseScriptComponent {
  @ui.label("Cutaway station — chip, questions, Stop pill, scan and dots for one object")
  @ui.separator
  @input
  @hint("Object name shown on the chip (sentence case)")
  objectName: string = "Record player"

  @input
  @hint("Prefix for button SceneObject names, e.g. RecordPlayer → RecordPlayerChip (used by LEAF tests)")
  namePrefix: string = "RecordPlayer"

  @input
  @hint("Questions for this object. The first one is the guaranteed question; up to 3. Only built questions show")
  questions: string[] = ["How does it make sound?"]

  @input
  @hint("Additive glow material (dots, outlines, scan)")
  dotMaterial: Material

  @ui.group_start("Object bounds (for the scan and the ghost shell)")
  @input
  @hint("Center of the real object's bounds, as a world offset from this station (cm)")
  boundsCenter: vec3 = new vec3(0, 0, 0)

  @input
  @hint("Size of the real object's bounds along world X, Y, Z (cm)")
  boundsSize: vec3 = new vec3(30, 20, 30)
  @ui.group_end

  @ui.group_start("Layout")
  @input
  @hint("Where the Stop pill sits relative to this object, in world cm (put it just under the real object)")
  stopOffset: vec3 = new vec3(0, -40, 15)

  @input
  @hint("Distance (cm) at which the UI is shown 1:1. Farther stations are scaled up so text stays readable")
  @widget(new SliderWidget(60, 200, 5))
  designDistance: number = 110

  @input
  @hint("Smallest UI scale, for objects closer than the design distance (keeps the angular size, e.g. 0.4 at 44 cm)")
  @widget(new SliderWidget(0.2, 1, 0.05))
  minScale: number = 0.3

  @input
  @hint("Raise the chip and questions above the dot, in screen-up design cm (for objects seen close up, so the chip does not cover them)")
  @widget(new SliderWidget(0, 30, 0.5))
  chipLift: number = 0

  @input
  @hint("Chip width at design scale (cm)")
  @widget(new SliderWidget(6, 20, 0.5))
  chipWidth: number = 11

  @input
  @hint("Question button width at design scale (cm)")
  @widget(new SliderWidget(12, 32, 0.5))
  questionWidth: number = 21

  @input
  @hint("Button height at design scale (cm)")
  @widget(new SliderWidget(2.4, 5, 0.1))
  rowHeight: number = 3.2

  @input
  @hint("Gap between stacked buttons at design scale (cm)")
  @widget(new SliderWidget(0.2, 2, 0.1))
  rowGap: number = 0.6

  @input
  @hint("Idle dot radius at design scale (cm) — small and quiet")
  @widget(new SliderWidget(0.2, 1.5, 0.05))
  idleDotRadius: number = 0.45

  @input
  @hint("Label on the Stop pill")
  stopLabel: string = "Stop"

  @input
  @hint("Optional follow-up pill shown under the object once it is explained (e.g. \"Bring it closer\"). Empty = none")
  closerLabel: string = ""

  @input
  @hint("Width of the follow-up pill at design scale (cm)")
  @widget(new SliderWidget(6, 20, 0.5))
  closerWidth: number = 12
  @ui.group_end

  readonly onChipPressed = new Event<void>()
  readonly onQuestionPressed = new Event<number>()
  readonly onStopPressed = new Event<void>()
  readonly onDotPressed = new Event<void>()
  /** The follow-up pill ("Bring it closer") was pinched. */
  readonly onCloserPressed = new Event<void>()
  /** Fired when the scan starts sweeping (world position of the object's bounds center). */
  readonly onScan = new Event<vec3>()
  /** Fired on every pinch of one of this station's controls (world position of the control). */
  readonly onPinch = new Event<vec3>()

  private panel: SceneObject
  private stopAnchor: SceneObject
  private idleDot: {pop: Pop; so: SceneObject}
  private idleMat: Material
  private idleMesh: SceneObject
  private explainedDot: Piece
  private dotMat: Material
  private dotHover = 1
  private dotHoverTarget = 1
  private rings: {so: SceneObject; rmv: RenderMeshVisual} | null = null
  private chip: Piece
  private chipSpring = new Spring(553, 0.745, 0)
  private questionPieces: Piece[] = []
  private questionSlots: vec3[] = []
  private stop: Piece
  private closer: Piece | null = null
  private pieces: {pop: Pop; so: SceneObject; pill?: UiPill}[] = []
  private dotVisualMasked = false
  private camTransform: Transform | null = null
  private firstFrame = true
  private uiScale = 1
  private captionTarget: vec3 | null = null
  private keptQuestion = -1
  private breathT = 0
  private dotReveal = new Spring(420, 0.7, 1)
  private flash: SceneObject
  private flashMat: Material
  private flashT = -1

  // Scan
  private scanRoot: SceneObject
  private sweep: RenderMeshVisual
  private sweepMat: Material
  private brackets: {so: SceneObject; rmv: RenderMeshVisual; sx: number; sy: number}[] = []
  private bracketMat: Material
  private scanFader = new Fader(false)
  private scanT = -1
  private scanHW = 10
  private scanHH = 10

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.panel = this.child(this.sceneObject, "Panel")
    this.stopAnchor = this.child(this.sceneObject, "StopAnchor")
    this.breathT = Math.random() * 2.5

    this.idleDot = this.buildIdleDot()
    this.chip = this.buildPill(this.panel, this.namePrefix + "Chip", this.chipWidth, this.rowHeight, this.objectName, "glass", 1)
    this.chip.pop.so.getTransform().setLocalPosition(new vec3(0, this.chipLift, 0))
    const qs = (this.questions ?? []).filter((q) => q && q.trim().length > 0).slice(0, 3)
    for (let i = 0; i < qs.length; i++) {
      const p = this.buildPill(this.panel, this.namePrefix + "Q" + i, this.questionWidth, this.rowHeight, qs[i], "glass", 0.85)
      const y = this.chipLift + this.rowHeight / 2 + this.rowGap + this.rowHeight / 2 + i * (this.rowHeight + this.rowGap)
      const slot = new vec3(0, y, 0)
      p.pop.so.getTransform().setLocalPosition(slot)
      this.questionSlots.push(slot)
      this.questionPieces.push(p)
    }
    this.explainedDot = this.buildExplainedDot()
    this.stop = this.buildPill(this.stopAnchor, this.namePrefix + "Stop", 6.5, this.rowHeight * 0.8, this.stopLabel, "outline", 0.85)
    // In the same spot as Stop, under the object (the two never show together). The primary action.
    if (this.closerLabel && this.closerLabel.trim().length > 0) {
      this.closer = this.buildPill(this.stopAnchor, this.namePrefix + "Closer", this.closerWidth, this.rowHeight * 0.8, this.closerLabel, "primary", 0.85)
      this.closer.btn.onTriggerUp.add(() => {
        if (this.closer.pop.isShown) this.onCloserPressed.invoke()
      })
    }
    this.buildFlash()
    this.buildScan()

    this.chip.btn.onTriggerUp.add(() => {
      if (this.chip.pop.isShown) this.onChipPressed.invoke()
    })
    this.questionPieces.forEach((p, i) =>
      p.btn.onTriggerUp.add(() => {
        if (p.pop.isShown) this.onQuestionPressed.invoke(i)
      })
    )
    this.stop.btn.onTriggerUp.add(() => {
      if (this.stop.pop.isShown) this.onStopPressed.invoke()
    })
    this.explainedDot.btn.onTriggerUp.add(() => {
      if (this.explainedDot.pop.isShown) this.onDotPressed.invoke()
    })

    this.idleDot.pop.show(true, true)
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ---------------- Public API (called by CutawayMain) ----------------

  get questionCount(): number {
    return this.questionPieces.length
  }

  setIdleDot(v: boolean): void {
    this.idleDot.pop.show(v)
  }

  /** The opening masks the idle dot and brings it up in its turn, whatever its logical state. */
  setDotReveal(v: boolean, instant: boolean = false): void {
    this.dotReveal.target = v ? 1 : 0
    if (instant) this.dotReveal.snap(v ? 1 : 0)
  }

  setExplainedDot(v: boolean): void {
    this.explainedDot.pop.show(v)
  }

  /** The dot stretches into the chip (spring, ~3% overshoot) or shrinks back into it. */
  setChip(v: boolean): void {
    if (v && !this.chip.pop.isShown) {
      this.chipSpring.snap(0)
      this.chipSpring.target = 1
    }
    this.chip.pop.show(v)
  }

  /** Questions fan out from the dot, staggered 70 ms (or fade away). */
  setQuestions(v: boolean): void {
    this.questionPieces.forEach((p, i) => p.pop.show(v, false, v ? 0.07 * i : 0))
  }

  /** Keep only the chosen question visible; the chip and other questions fade away. */
  keepOnlyQuestion(index: number): void {
    this.keptQuestion = index
    this.chip.pop.show(false)
    this.questionPieces.forEach((p, i) => {
      if (i !== index) p.pop.show(false)
    })
  }

  /**
   * Hold the kept question at a world position while an explanation plays (null = back to its
   * normal spot above the dot). The dots stay on the object.
   */
  setCaptionWorldPosition(p: vec3 | null): void {
    this.captionTarget = p
    if (!p) this.panel.getTransform().setLocalPosition(vec3.zero())
  }

  /** World point just under the kept question: where an explanation's caption hangs from. */
  getCaptionAnchor(): vec3 {
    const q = this.keptQuestion >= 0 && this.keptQuestion < this.questionSlots.length ? this.questionSlots[this.keptQuestion] : new vec3(0, this.chipLift, 0)
    return this.panel.getTransform().getWorldTransform().multiplyPoint(new vec3(q.x, q.y - this.rowHeight / 2 - 0.9, 0))
  }

  /** Move the Stop pill to a world position (e.g. a spot an explanation keeps clear). */
  setStopWorldPosition(p: vec3): void {
    this.stopAnchor.getTransform().setWorldPosition(p)
  }

  /** Put the Stop pill back at its authored offset from the object. */
  resetStopPosition(): void {
    this.stopAnchor.getTransform().setWorldPosition(this.sceneObject.getTransform().getWorldPosition().add(this.stopOffset))
  }

  setStop(v: boolean): void {
    this.stop.pop.show(v)
  }

  /** Show the follow-up pill (if this station has one) under the object, at the Stop pill's spot. */
  setCloser(v: boolean): void {
    if (!this.closer) return
    if (v && !this.closer.pop.isShown) this.resetStopPosition()
    this.closer.pop.show(v)
  }

  get hasCloser(): boolean {
    return this.closer !== null
  }

  /** Scan: a line of light sweeps down the object's bounds, then corner brackets lock on. */
  setScan(v: boolean): void {
    if (v && !this.scanFader.isShown) this.startScan()
    if (!v && this.scanFader.isShown) this.scanFader.show(false)
  }

  /** Hide everything except the dots (used before an effect collapses into a dot). */
  hideControls(): void {
    this.chip.pop.show(false)
    this.setQuestions(false)
    this.stop.pop.show(false)
    if (this.closer) this.closer.pop.show(false)
    this.setScan(false)
  }

  /** The explained dot gets one thin ring per energy the explanation used. */
  setEnergies(colors: vec4[]): void {
    if (!this.rings) return
    const on = !!colors && colors.length > 0
    if (on) {
      const kit = new MeshKit()
      colors.forEach((c, i) => kit.addArcXY(0, 0, 0.95 + 0.32 * i, 0.09, 0, Math.PI * 2, ink(c, 0.95), 48))
      this.rings.rmv.mesh = kit.build()
    }
    this.rings.so.enabled = on
  }

  /** Small flash at the dot: the explanation has folded back into it. */
  playFlash(): void {
    this.flashT = 0
    this.flash.enabled = true
  }

  getVisual(): StationVisual {
    return {
      idleDot: this.idleDot.pop.isShown,
      explainedDot: this.explainedDot.pop.isShown,
      chip: this.chip.pop.isShown,
      questions: this.questionPieces.map((p) => p.pop.isShown),
      stop: this.stop.pop.isShown,
      closer: this.closer ? this.closer.pop.isShown : false,
      idleDotReveal: clamp01(this.dotReveal.value)
    }
  }

  /** World position of the dot / chip anchor (where effects collapse to). */
  getAnchorWorldPosition(): vec3 {
    return this.sceneObject.getTransform().getWorldPosition()
  }

  /** The real object's bounds: world center and full size (cm, world axes). */
  getBounds(): {center: vec3; size: vec3} {
    return {center: this.getAnchorWorldPosition().add(this.boundsCenter), size: this.boundsSize}
  }

  getUiScale(): number {
    return this.uiScale
  }

  /** The chip's four world corners while it shows, otherwise null. */
  getChipCorners(): vec3[] | null {
    if (!this.chip.pop.isShown) return null
    const m = this.chip.so.getTransform().getWorldTransform()
    const w = this.chipWidth / 2
    const h = this.rowHeight / 2
    return [new vec3(-w, -h, 0), new vec3(w, -h, 0), new vec3(w, h, 0), new vec3(-w, h, 0)].map((q) => m.multiplyPoint(q))
  }

  // ---------------- Build helpers ----------------

  private child(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  /** Soft white dot: bright core fading to its edge, plus a faint halo. */
  private softDot(kit: MeshKit, r: number, k: number): void {
    kit.addFanXY(0, 0, r, 0, Math.PI * 2, ink(INK, k), ink(INK, k * 0.55), 32)
    kit.addSoftRingXY(0, 0, r, r * 2.4, ink(INK, k * 0.55 * 0.35), NO_LIGHT, 32)
  }

  private buildIdleDot(): {pop: Pop; so: SceneObject} {
    const wrap = this.child(this.panel, this.namePrefix + "IdleDot")
    this.idleMesh = this.child(wrap, "IdleDotMesh")
    if (this.dotMaterial) {
      const kit = new MeshKit()
      this.softDot(kit, this.idleDotRadius, 1)
      const s = spawnMesh(this.idleMesh, "Dot", kit.build(), this.dotMaterial)
      this.idleMat = s.mat
    }
    const pop = new Pop(wrap, vec3.one(), false)
    const piece = {pop, so: wrap}
    this.pieces.push(piece)
    return piece
  }

  /** The explained dot: a round UI Kit button whose visual is masked and drawn with light. */
  private buildExplainedDot(): Piece {
    const dotSize = this.rowHeight * 0.85
    const wrap = this.child(this.panel, this.namePrefix + "DotPop")
    const so = this.child(wrap, this.namePrefix + "Dot")
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.setVariant({theme: "SnapOS2", shape: "Round", style: "Ghost"})
    btn.size = new vec3(dotSize, dotSize, 1)
    const pop = new Pop(wrap, vec3.one(), false, {minScale: 0.5})
    btn.onTriggerDown.add(() => {
      pop.setPressed(true)
      this.onPinch.invoke(so.getTransform().getWorldPosition())
    })
    btn.onTriggerUp.add(() => pop.setPressed(false))
    btn.onHoverEnter.add(() => (this.dotHoverTarget = 1.6))
    btn.onHoverExit.add(() => {
      pop.setPressed(false)
      this.dotHoverTarget = 1
    })
    if (this.dotMaterial) {
      this.dotMat = this.dotMaterial.clone()
      const kit = new MeshKit()
      this.softDot(kit, 0.55, 1)
      spawnMesh(so, "DotGlow", kit.build(), this.dotMaterial, new vec3(0, 0, 0.02), this.dotMat)
      // Lives as long as the station: an explanation only gives it its mesh (setEnergies).
      const ringSo = this.child(wrap, "EnergyRings")
      ringSo.getTransform().setLocalPosition(new vec3(0, 0, 0.03))
      const rmv = ringSo.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mainMaterial = this.dotMat
      ringSo.enabled = false
      this.rings = {so: ringSo, rmv}
    }
    const piece: Piece = {pop, so, btn}
    this.pieces.push(piece)
    return piece
  }

  private buildFlash(): void {
    this.flash = this.child(this.panel, this.namePrefix + "Flash")
    this.flash.getTransform().setLocalPosition(new vec3(0, 0, 0.05))
    if (this.dotMaterial) {
      const kit = new MeshKit()
      kit.addFanXY(0, 0, 1.4, 0, Math.PI * 2, ink(INK, 0.9), NO_LIGHT, 40)
      this.flashMat = spawnMesh(this.flash, "FlashMesh", kit.build(), this.dotMaterial).mat
    }
    this.flash.enabled = false
  }

  private buildPill(parent: SceneObject, name: string, width: number, height: number, label: string, kind: PillKind, minScale: number): Piece {
    const pill = new UiPill({parent, name, label, width, height, material: this.dotMaterial, kind, minScale})
    pill.onPinch = (p) => this.onPinch.invoke(p)
    const piece: Piece = {pop: pill.pop, so: pill.so, btn: pill.btn, pill}
    this.pieces.push(piece)
    return piece
  }

  /** Masks the explained dot's UI Kit visual (retried until UI Kit has created it). */
  private maskDotVisual(): void {
    const v = this.explainedDot.btn.visual
    if (!v || !v.renderMeshVisual) return
    v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
    this.dotVisualMasked = true
  }

  // ---------------- Scan ----------------

  private buildScan(): void {
    this.scanRoot = this.child(this.sceneObject, this.namePrefix + "Scan")
    if (!this.dotMaterial) return
    this.sweepMat = this.dotMaterial.clone()
    this.bracketMat = this.dotMaterial.clone()
    const sw = this.child(this.scanRoot, "Sweep")
    this.sweep = sw.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    this.sweep.mainMaterial = this.sweepMat
    for (const [sx, sy] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      const so = this.child(this.scanRoot, "Bracket")
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mainMaterial = this.bracketMat
      this.brackets.push({so, rmv, sx, sy})
    }
    this.scanRoot.enabled = false
  }

  private startScan(): void {
    if (!this.dotMaterial || !this.camTransform) return
    const b = this.getBounds()
    const cam = this.camTransform.getWorldPosition()
    const rot = faceToward(cam.sub(b.center), this.camTransform.up)
    const R = rot.multiplyVec3(vec3.right())
    const U = rot.multiplyVec3(vec3.up())
    const h = b.size.uniformScale(0.5)
    const extent = (v: vec3) => Math.abs(v.x) * h.x + Math.abs(v.y) * h.y + Math.abs(v.z) * h.z
    const dist = cam.distance(b.center)
    const pad = Math.max(1, dist / 300)
    this.scanHW = extent(R) + pad
    this.scanHH = extent(U) + pad
    const lw = 0.11 * Math.max(0.4, dist / 110)
    const hw = this.scanHW
    const hh = this.scanHH
    // Sweep: a thin line with a soft trail above it (it moves down).
    const s = new MeshKit()
    s.addLineXY(-hw, 0, hw, 0, lw, ink(INK, 0.9), lw * 2.5)
    const trail = Math.min(hh * 0.5, 8 * lw)
    const tc = ink(INK, 0.14)
    s.addRectXY(-hw, lw / 2, hw, lw / 2 + trail, tc, tc, NO_LIGHT, NO_LIGHT)
    this.sweep.mesh = s.build()
    // Corner brackets: arms run inward from each corner.
    const arm = Math.min(hw, hh) * 0.3
    for (const br of this.brackets) {
      const k = new MeshKit()
      k.addLineXY(0, 0, -br.sx * arm, 0, lw, ink(INK, 0.85), lw * 1.5)
      k.addLineXY(0, -br.sy * lw * 0.5, 0, -br.sy * arm, lw, ink(INK, 0.85), lw * 1.5)
      br.rmv.mesh = k.build()
    }
    this.scanT = 0
    this.scanFader.show(true, true)
    this.scanRoot.enabled = true
    this.placeScan()
    this.onScan.invoke(b.center)
  }

  private placeScan(): void {
    if (!this.camTransform) return
    const c = this.getBounds().center
    const tr = this.scanRoot.getTransform()
    tr.setWorldPosition(c)
    tr.setWorldRotation(faceToward(this.camTransform.getWorldPosition().sub(c), this.camTransform.up))
  }

  private updateScan(dt: number): void {
    if (!this.scanRoot.enabled) return
    this.scanT += dt
    const m = this.scanFader.update(dt)
    const t = this.scanT
    const SWEEP = 0.6
    const LOCK = 0.15
    // Sweep top → bottom (600 ms).
    const sy = this.scanHH - 2 * this.scanHH * easeInOutCubic(t / SWEEP)
    this.sweep.getSceneObject().getTransform().setLocalPosition(new vec3(0, sy, 0.01))
    const sweepA = t < SWEEP ? Math.min(1, t / 0.08) * (t > SWEEP - 0.12 ? (SWEEP - t) / 0.12 : 1) : 0
    this.sweep.enabled = sweepA > 0.001
    setFade(this.sweepMat, sweepA * m)
    // Brackets lock on (150 ms), flash bright, then settle to a quiet stroke.
    const k = easeOutCubic((t - SWEEP) / LOCK)
    const f = 1.12 - 0.12 * k
    for (const br of this.brackets) br.so.getTransform().setLocalPosition(new vec3(br.sx * this.scanHW * f, br.sy * this.scanHH * f, 0))
    const settle = easeOutCubic((t - SWEEP - LOCK) / 0.35)
    const bracketA = t < SWEEP ? 0 : k * (1 - 0.55 * settle)
    setFade(this.bracketMat, bracketA * m)
    this.placeScan()
    if (!this.scanFader.isShown && !this.scanFader.isAnimating) this.scanRoot.enabled = false
  }

  // ---------------- Runtime ----------------

  private onStart(): void {
    this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    const root = this.sceneObject.getTransform().getWorldPosition()
    this.stopAnchor.getTransform().setWorldPosition(root.add(this.stopOffset))
    this.updateScale()
    this.faceCamera()
  }

  /** Keep the UI at its 110 cm angular size from wherever the user is standing (near or far). */
  private updateScale(): void {
    const cam = this.camTransform ? this.camTransform.getWorldPosition() : vec3.zero()
    const scaleFor = (p: vec3) => Math.min(6, Math.max(this.minScale, p.distance(cam) / this.designDistance))
    this.uiScale = scaleFor(this.panel.getTransform().getWorldPosition())
    this.panel.getTransform().setLocalScale(vec3.one().uniformScale(this.uiScale))
    const stopTr = this.stopAnchor.getTransform()
    stopTr.setLocalScale(vec3.one().uniformScale(scaleFor(stopTr.getWorldPosition())))
  }

  private onUpdate(): void {
    if (this.firstFrame) {
      // Buttons have initialized in OnStart; now hide everything that was not asked to show.
      this.firstFrame = false
      for (const p of this.pieces) if (!p.pop.isShown) p.pop.show(false, true)
    }
    if (!this.dotVisualMasked) this.maskDotVisual()
    const dt = getDeltaTime()
    for (const p of this.pieces) p.pop.update(dt)
    this.updateChip(dt)
    this.updateQuestions()
    for (const p of this.pieces) if (p.pill) p.pill.updateLook(dt)
    this.updateDots(dt)
    this.updateScan(dt)
    this.updateScale()
    this.faceCamera()
    this.placeCaption()
  }

  /** Dot → capsule: height grows first, then the width stretches with a ~3% overshoot. */
  private updateChip(dt: number): void {
    const c = this.chip
    if (!c.so.isEnabledInHierarchy) return
    const a = c.pop.amount
    let p: number
    let textA: number
    if (c.pop.isShown) {
      p = this.chipSpring.update(dt)
      textA = clamp01((p - 0.55) / 0.4)
    } else {
      p = a
      textA = a
    }
    const d = this.idleDotRadius * 2
    const h = d + (this.rowHeight - d) * easeOutCubic(clamp01(p / 0.45))
    const w = Math.max(h, d + (this.chipWidth - d) * p)
    c.pill.glass.setShape(w, h)
    c.pill.setOpacities(Math.min(1, p * 3) * (c.pop.isShown ? 1 : a), textA)
  }

  /** Questions travel out from the dot to their slots as they fade in (fade only on the way out). */
  private updateQuestions(): void {
    const start = new vec3(0, this.chipLift, 0)
    this.questionPieces.forEach((p, i) => {
      if (!p.pop.so.enabled || !p.pop.isShown) return
      p.pop.so.getTransform().setLocalPosition(vec3.lerp(start, this.questionSlots[i], p.pop.amount))
    })
  }

  private updateDots(dt: number): void {
    // Idle dot breathes: 2.5 s cycle, 85–100% scale, 40–60% opacity.
    this.breathT += dt
    const b = 0.5 - 0.5 * Math.cos((2 * Math.PI * this.breathT) / 2.5)
    const reveal = this.dotReveal.update(dt)
    if (this.idleDot.pop.so.enabled) {
      this.idleMesh.getTransform().setLocalScale(vec3.one().uniformScale((0.85 + 0.15 * b) * Math.max(0.001, reveal)))
      if (this.idleMat) setFade(this.idleMat, (0.4 + 0.2 * b) * this.idleDot.pop.amount * clamp01(reveal))
    }
    if (this.dotMat && this.explainedDot.pop.so.enabled) {
      this.dotHover += (this.dotHoverTarget - this.dotHover) * (1 - Math.exp(-dt / 0.06))
      setFade(this.dotMat, 0.8 * this.dotHover * this.explainedDot.pop.amount)
    }
    if (this.flashT >= 0) {
      this.flashT += dt
      const k = clamp01(this.flashT / 0.35)
      this.flash.getTransform().setLocalScale(vec3.one().uniformScale(0.5 + 1.6 * easeOutCubic(k)))
      if (this.flashMat) setFade(this.flashMat, 1 - easeOutCubic(k))
      if (k >= 1) {
        this.flashT = -1
        this.flash.enabled = false
      }
    }
  }

  private placeCaption(): void {
    if (!this.captionTarget || this.keptQuestion < 0 || this.keptQuestion >= this.questionPieces.length) return
    const ptr = this.panel.getTransform()
    const qLocal = this.questionPieces[this.keptQuestion].pop.so.getTransform().getLocalPosition()
    const off = ptr.getWorldRotation().multiplyVec3(qLocal.uniformScale(this.uiScale))
    ptr.setWorldPosition(this.captionTarget.sub(off))
  }

  private faceCamera(): void {
    if (!this.camTransform) return
    const cam = this.camTransform.getWorldPosition()
    const camUp = this.camTransform.up
    for (const so of [this.panel, this.stopAnchor]) {
      const tr = so.getTransform()
      tr.setWorldRotation(faceToward(cam.sub(tr.getWorldPosition()), camUp))
    }
  }
}
