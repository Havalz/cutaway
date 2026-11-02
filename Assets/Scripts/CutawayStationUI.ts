import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setFade, spawnMesh} from "./CutawayGeometry"
import {applyType, FILL_ALPHA, ink, setTextAlpha, STROKE_ALPHA, TextRole, UI_WHITE} from "./CutawayStyle"
import {clamp01, easeInOutCubic, easeOutCubic, Fader, faceToward, Pop, Spring} from "./CutawayTween"

const BUTTON_LABEL_Z = 0.08

export interface StationVisual {
  idleDot: boolean
  explainedDot: boolean
  chip: boolean
  questions: boolean[]
  stop: boolean
}

/**
 * A capsule drawn with light: a hairline outline plus a faint fill. Its width changes by moving
 * the two end caps and scaling the straight middle, so only transforms animate. Shared by the
 * chips, questions, Stop and the Reset pill so every pill reads the same.
 */
export class CapsuleGlow {
  readonly root: SceneObject
  readonly mat: Material
  private left: SceneObject
  private right: SceneObject
  private mid: SceneObject
  private opacity = 1
  private hover = 1
  private hoverTarget = 1

  constructor(
    parent: SceneObject,
    name: string,
    material: Material,
    private height: number
  ) {
    this.root = global.scene.createSceneObject(name)
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(0, 0, 0.02))
    this.mat = material.clone()
    const r = height / 2
    const stroke = 0.09
    const line = ink(UI_WHITE, STROKE_ALPHA)
    const fill = ink(UI_WHITE, FILL_ALPHA)
    const cap = (sign: number) => {
      const k = new MeshKit()
      const a0 = sign < 0 ? Math.PI / 2 : -Math.PI / 2
      k.addArcXY(0, 0, r - stroke / 2, stroke, a0, a0 + Math.PI, line, 20)
      k.addFanXY(0, 0, r - stroke, a0, a0 + Math.PI, fill, fill, 20)
      return k
    }
    this.left = spawnMesh(this.root, "CapL", cap(-1).build(), material, undefined, this.mat).so
    this.right = spawnMesh(this.root, "CapR", cap(1).build(), material, undefined, this.mat).so
    const m = new MeshKit()
    m.addRectXY(-0.5, r - stroke, 0.5, r, line)
    m.addRectXY(-0.5, -r, 0.5, -r + stroke, line)
    m.addRectXY(-0.5, -r + stroke, 0.5, r - stroke, fill)
    this.mid = spawnMesh(this.root, "Mid", m.build(), material, undefined, this.mat).so
  }

  /** Current outer width and height (design cm). */
  setShape(w: number, h: number): void {
    const s = Math.max(1e-4, h / this.height)
    const straight = Math.max(0, w - h) / s
    this.root.getTransform().setLocalScale(new vec3(s, s, 1))
    this.left.getTransform().setLocalPosition(new vec3(-straight / 2, 0, 0))
    this.right.getTransform().setLocalPosition(new vec3(straight / 2, 0, 0))
    this.mid.getTransform().setLocalScale(new vec3(Math.max(1e-4, straight), 1, 1))
  }

  setOpacity(a: number): void {
    this.opacity = a
  }

  /** Aimed at: strokes brighten from 50% to ~80%. */
  setHover(h: boolean): void {
    this.hoverTarget = h ? 1.6 : 1
  }

  update(dt: number): void {
    this.hover += (this.hoverTarget - this.hover) * (1 - Math.exp(-dt / 0.06))
    setFade(this.mat, this.opacity * this.hover)
  }
}

interface Piece {
  pop: Pop
  so: SceneObject
  btn?: Button
  glow?: CapsuleGlow
  label?: Text
}

/**
 * The UI for one explained object: idle dot, name chip, questions, Stop pill, the scan and the
 * "explained" dot. Pure view: CutawayMain decides what is shown and listens to the events.
 * The panel is built at the 110 cm design scale and scaled with distance so it reads the same
 * from ~3–5 m. Everything is drawn with light (additive): outlines, never filled panels.
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
  @ui.group_end

  readonly onChipPressed = new Event<void>()
  readonly onQuestionPressed = new Event<number>()
  readonly onStopPressed = new Event<void>()
  readonly onDotPressed = new Event<void>()
  /** Fired when the scan starts sweeping (world position of the object's bounds center). */
  readonly onScan = new Event<vec3>()
  /** Fired on every pinch of one of this station's controls (world position of the control). */
  readonly onPinch = new Event<vec3>()

  private panel: SceneObject
  private stopAnchor: SceneObject
  private idleDot: Piece
  private idleMat: Material
  private idleMesh: SceneObject
  private explainedDot: Piece
  private dotMat: Material
  private dotHover = 1
  private dotHoverTarget = 1
  private ringsSo: SceneObject | null = null
  private chip: Piece
  private chipSpring = new Spring(553, 0.745, 0)
  private questionPieces: Piece[] = []
  private questionSlots: vec3[] = []
  private stop: Piece
  private pieces: Piece[] = []
  private pendingVisuals: Button[] = []
  private camTransform: Transform | null = null
  private firstFrame = true
  private uiScale = 1
  private captionTarget: vec3 | null = null
  private keptQuestion = -1
  private breathT = 0
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
    this.chip = this.buildButton(this.panel, this.namePrefix + "Chip", new vec3(this.chipWidth, this.rowHeight, 1), "Capsule", this.objectName, "ui", 1)
    this.chip.pop.so.getTransform().setLocalPosition(new vec3(0, this.chipLift, 0))
    const qs = (this.questions ?? []).filter((q) => q && q.trim().length > 0).slice(0, 3)
    for (let i = 0; i < qs.length; i++) {
      const p = this.buildButton(this.panel, this.namePrefix + "Q" + i, new vec3(this.questionWidth, this.rowHeight, 1), "Capsule", qs[i], "ui", 0.85)
      const y = this.chipLift + this.rowHeight / 2 + this.rowGap + this.rowHeight / 2 + i * (this.rowHeight + this.rowGap)
      const slot = new vec3(0, y, 0)
      p.pop.so.getTransform().setLocalPosition(slot)
      this.questionSlots.push(slot)
      this.questionPieces.push(p)
    }
    const dotSize = this.rowHeight * 0.85
    this.explainedDot = this.buildButton(this.panel, this.namePrefix + "Dot", new vec3(dotSize, dotSize, 1), "Round", null, "ui", 0.5)
    this.buildExplainedDotVisual()
    this.stop = this.buildButton(this.stopAnchor, this.namePrefix + "Stop", new vec3(6.5, this.rowHeight * 0.8, 1), "Capsule", this.stopLabel, "ui", 0.85)
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
    this.setScan(false)
  }

  /** The explained dot gets one thin ring per energy the explanation used. */
  setEnergies(colors: vec4[]): void {
    if (this.ringsSo) this.ringsSo.destroy()
    this.ringsSo = null
    if (!colors || colors.length === 0 || !this.dotMaterial) return
    const kit = new MeshKit()
    colors.forEach((c, i) => kit.addArcXY(0, 0, 0.95 + 0.32 * i, 0.09, 0, Math.PI * 2, ink(c, 0.95), 48))
    this.ringsSo = spawnMesh(this.explainedDot.pop.so, "EnergyRings", kit.build(), this.dotMaterial, new vec3(0, 0, 0.03), this.dotMat).so
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
      stop: this.stop.pop.isShown
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

  // ---------------- Build helpers ----------------

  private child(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  /** Soft white dot: bright core fading to its edge, plus a faint halo. */
  private softDot(kit: MeshKit, r: number, k: number): void {
    kit.addFanXY(0, 0, r, 0, Math.PI * 2, ink(UI_WHITE, k), ink(UI_WHITE, k * 0.55), 32)
    kit.addSoftRingXY(0, 0, r, r * 2.4, ink(UI_WHITE, k * 0.55 * 0.35), new vec4(0, 0, 0, 0), 32)
  }

  private buildIdleDot(): Piece {
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

  private buildExplainedDotVisual(): void {
    if (!this.dotMaterial) return
    this.dotMat = this.dotMaterial.clone()
    const kit = new MeshKit()
    this.softDot(kit, 0.55, 1)
    spawnMesh(this.explainedDot.pop.so, "DotGlow", kit.build(), this.dotMaterial, new vec3(0, 0, 0.02), this.dotMat)
    this.explainedDot.btn.onHoverEnter.add(() => (this.dotHoverTarget = 1.6))
    this.explainedDot.btn.onHoverExit.add(() => (this.dotHoverTarget = 1))
  }

  private buildFlash(): void {
    this.flash = this.child(this.panel, this.namePrefix + "Flash")
    this.flash.getTransform().setLocalPosition(new vec3(0, 0, 0.05))
    if (this.dotMaterial) {
      const kit = new MeshKit()
      kit.addFanXY(0, 0, 1.4, 0, Math.PI * 2, ink(UI_WHITE, 0.9), new vec4(0, 0, 0, 0), 40)
      this.flashMat = spawnMesh(this.flash, "FlashMesh", kit.build(), this.dotMaterial).mat
    }
    this.flash.enabled = false
  }

  private buildButton(parent: SceneObject, name: string, size: vec3, shape: string, label: string | null, role: TextRole, minScale: number): Piece {
    const wrap = this.child(parent, name + "Pop")
    const so = this.child(wrap, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    // Ghost: no fill; its own visual is masked below, the outline is drawn with light instead.
    btn.setVariant({theme: "SnapOS2", shape, style: "Ghost"})
    btn.size = size
    this.pendingVisuals.push(btn)
    const text = label ? this.addButtonLabel(so, label, size.x - 0.6, role) : undefined
    const glow = label && this.dotMaterial ? new CapsuleGlow(so, name + "Glow", this.dotMaterial, size.y) : undefined
    if (glow) glow.setShape(size.x, size.y)
    const pop = new Pop(wrap, vec3.one(), false, {
      minScale,
      onAmount: (a) => {
        if (glow) glow.setOpacity(a)
        if (text) setTextAlpha(text, a)
      }
    })
    btn.onTriggerDown.add(() => {
      pop.setPressed(true)
      this.onPinch.invoke(so.getTransform().getWorldPosition())
    })
    btn.onTriggerUp.add(() => pop.setPressed(false))
    btn.onHoverEnter.add(() => glow && glow.setHover(true))
    btn.onHoverExit.add(() => {
      pop.setPressed(false)
      if (glow) glow.setHover(false)
    })
    const piece: Piece = {pop, so, btn, glow, label: text}
    this.pieces.push(piece)
    return piece
  }

  private addButtonLabel(parent: SceneObject, text: string, widthCM: number, role: TextRole): Text {
    const so = this.child(parent, "ButtonLabel")
    so.getTransform().setLocalPosition(new vec3(0, 0, BUTTON_LABEL_Z))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyType(t, role)
    setTextAlpha(t, 0)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
    return t
  }

  /** Masks the UIKit button's own visual (retried until UIKit has created it). */
  private hidePendingVisuals(): void {
    this.pendingVisuals = this.pendingVisuals.filter((btn) => {
      const v = btn.visual
      if (!v || !v.renderMeshVisual) return true
      v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
      return false
    })
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
    s.addLineXY(-hw, 0, hw, 0, lw, ink(UI_WHITE, 0.9), lw * 2.5)
    const trail = Math.min(hh * 0.5, 8 * lw)
    const zero = new vec4(0, 0, 0, 0)
    const tc = ink(UI_WHITE, 0.14)
    s.addRectXY(-hw, lw / 2, hw, lw / 2 + trail, tc, tc, zero, zero)
    this.sweep.mesh = s.build()
    // Corner brackets: arms run inward from each corner.
    const arm = Math.min(hw, hh) * 0.3
    for (const br of this.brackets) {
      const k = new MeshKit()
      k.addLineXY(0, 0, -br.sx * arm, 0, lw, ink(UI_WHITE, 0.85), lw * 1.5)
      k.addLineXY(0, -br.sy * lw * 0.5, 0, -br.sy * arm, lw, ink(UI_WHITE, 0.85), lw * 1.5)
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
    if (this.pendingVisuals.length > 0) this.hidePendingVisuals()
    const dt = getDeltaTime()
    for (const p of this.pieces) p.pop.update(dt)
    this.updateChip(dt)
    this.updateQuestions()
    for (const p of this.pieces) if (p.glow && p.so.isEnabledInHierarchy) p.glow.update(dt)
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
    c.glow.setShape(w, h)
    c.glow.setOpacity(Math.min(1, p * 3) * (c.pop.isShown ? 1 : a))
    setTextAlpha(c.label, textA)
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
    if (this.idleDot.pop.so.enabled) {
      this.idleMesh.getTransform().setLocalScale(vec3.one().uniformScale(0.85 + 0.15 * b))
      if (this.idleMat) setFade(this.idleMat, (0.4 + 0.2 * b) * this.idleDot.pop.amount)
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
