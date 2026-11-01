import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, spawnMesh} from "./CutawayGeometry"
import {faceToward, Pop} from "./CutawayTween"

// ---- Typography (skill type scale; sizes are for the 110 cm design distance) ----
const FONT_SIZE_SCALE = 1.0
type TextRole = "Title1" | "Title2" | "HeadlineXL" | "Headline1" | "Headline2" | "Subheadline" | "Button" | "Callout" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Title1: {size: 105, weight: 700},
  Title2: {size: 93, weight: 700},
  HeadlineXL: {size: 62, weight: 700},
  Headline1: {size: 54, weight: 700},
  Headline2: {size: 48, weight: 700},
  Subheadline: {size: 41, weight: 700},
  Button: {size: 39, weight: 500},
  Callout: {size: 39, weight: 700},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500}
}
function roleSize(role: TextRole, distanceCm: number = 110): number {
  return TYPE_SCALE[role].size * FONT_SIZE_SCALE * (distanceCm / 110)
}
function applyTextRole(t: Text, role: TextRole, distanceCm: number = 110): void {
  t.size = roleSize(role, distanceCm)
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

const BUTTON_LABEL_Z = 0.08

export interface StationVisual {
  idleDot: boolean
  explainedDot: boolean
  chip: boolean
  questions: boolean[]
  stop: boolean
}

interface Piece {
  pop: Pop
  so: SceneObject
  btn?: Button
}

/**
 * The UI for one explained object: idle dot, name chip, question list, Stop pill and the
 * "explained" dot. Pure view: CutawayMain decides what is shown and listens to the events.
 * The whole panel is built at the 110 cm design scale and scaled up with distance so it
 * reads the same from ~3–5 m.
 */
@component
export class CutawayStationUI extends BaseScriptComponent {
  @ui.label("Cutaway station — chip, questions, Stop pill and dots for one object")
  @ui.separator
  @input
  @hint("Object name shown on the chip")
  objectName: string = "Record player"

  @input
  @hint("Prefix for button SceneObject names, e.g. RecordPlayer → RecordPlayerChip (used by LEAF tests)")
  namePrefix: string = "RecordPlayer"

  @input
  @hint("Questions for this object. The first one is the guaranteed question; up to 3")
  questions: string[] = ["How does it make sound?"]

  @input
  @hint("Additive glow material used for the quiet idle dot")
  dotMaterial: Material

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
  @ui.group_end

  @ui.group_start("Style")
  @input
  @hint("UIKit style for the name chip")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Primary", "Primary"),
      new ComboBoxItem("PrimaryNeutral", "PrimaryNeutral"),
      new ComboBoxItem("Secondary", "Secondary"),
      new ComboBoxItem("Special", "Special")
    ])
  )
  chipStyle: string = "Primary"

  @input
  @hint("UIKit style for question buttons")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Primary", "Primary"),
      new ComboBoxItem("PrimaryNeutral", "PrimaryNeutral"),
      new ComboBoxItem("Secondary", "Secondary"),
      new ComboBoxItem("Special", "Special")
    ])
  )
  questionStyle: string = "PrimaryNeutral"

  @input
  @hint("UIKit style for the Stop pill")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("Primary", "Primary"),
      new ComboBoxItem("PrimaryNeutral", "PrimaryNeutral"),
      new ComboBoxItem("Secondary", "Secondary"),
      new ComboBoxItem("Special", "Special")
    ])
  )
  stopStyle: string = "Secondary"

  @input
  @hint("Idle dot color (additive — keep it light; dark reads as transparent on Specs)")
  @widget(new ColorWidget())
  idleDotColor: vec4 = new vec4(0.55, 0.85, 1.0, 0.6)

  @input
  @hint("Label on the Stop pill")
  stopLabel: string = "Stop"
  @ui.group_end

  readonly onChipPressed = new Event<void>()
  readonly onQuestionPressed = new Event<number>()
  readonly onStopPressed = new Event<void>()
  readonly onDotPressed = new Event<void>()

  private panel: SceneObject
  private stopAnchor: SceneObject
  private idleDot: Piece
  private explainedDot: Piece
  private chip: Piece
  private questionPieces: Piece[] = []
  private stop: Piece
  private pieces: Piece[] = []
  private camTransform: Transform | null = null
  private firstFrame = true
  private uiScale = 1
  private captionTarget: vec3 | null = null
  private keptQuestion = -1

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.panel = this.child(this.sceneObject, "Panel")
    this.stopAnchor = this.child(this.sceneObject, "StopAnchor")

    this.idleDot = this.buildIdleDot()
    this.chip = this.buildButton(this.panel, this.namePrefix + "Chip", new vec3(this.chipWidth, this.rowHeight, 1), "Capsule", this.chipStyle, this.objectName, "Button")
    this.chip.pop.so.getTransform().setLocalPosition(new vec3(0, this.chipLift, 0))
    const qs = (this.questions ?? []).slice(0, 3)
    for (let i = 0; i < qs.length; i++) {
      const p = this.buildButton(this.panel, this.namePrefix + "Q" + i, new vec3(this.questionWidth, this.rowHeight, 1), "Capsule", this.questionStyle, qs[i], "Body")
      const y = this.chipLift + this.rowHeight / 2 + this.rowGap + this.rowHeight / 2 + i * (this.rowHeight + this.rowGap)
      p.pop.so.getTransform().setLocalPosition(new vec3(0, y, 0))
      this.questionPieces.push(p)
    }
    const dotSize = this.rowHeight * 0.85
    this.explainedDot = this.buildButton(this.panel, this.namePrefix + "Dot", new vec3(dotSize, dotSize, 1), "Round", this.chipStyle, null, "Button")
    this.stop = this.buildButton(this.stopAnchor, this.namePrefix + "Stop", new vec3(6.5, this.rowHeight * 0.8, 1), "Capsule", this.stopStyle, this.stopLabel, "Button")

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

  setChip(v: boolean): void {
    this.chip.pop.show(v)
  }

  /** Show all questions (staggered) or hide them. */
  setQuestions(v: boolean): void {
    this.questionPieces.forEach((p, i) => p.pop.show(v, false, v ? 0.04 * i : 0))
  }

  /** Keep only the chosen question visible; the chip and other questions shrink away. */
  keepOnlyQuestion(index: number): void {
    this.keptQuestion = index
    this.chip.pop.show(false)
    this.questionPieces.forEach((p, i) => {
      if (i !== index) p.pop.show(false)
    })
  }

  /**
   * Hold the kept question caption at a world position while an explanation plays (null = back
   * to its normal spot above the dot). The dots stay on the object.
   */
  setCaptionWorldPosition(p: vec3 | null): void {
    this.captionTarget = p
    if (!p) this.panel.getTransform().setLocalPosition(vec3.zero())
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

  /** Hide everything except the dots (used before an effect collapses into a dot). */
  hideControls(): void {
    this.chip.pop.show(false)
    this.setQuestions(false)
    this.stop.pop.show(false)
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

  getUiScale(): number {
    return this.uiScale
  }

  // ---------------- Build helpers ----------------

  private child(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private buildIdleDot(): Piece {
    const wrap = this.child(this.panel, this.namePrefix + "IdleDot")
    const kit = new MeshKit()
    const c = this.idleDotColor
    kit.addDisc(vec3.zero(), vec3.forward(), this.idleDotRadius, c, 24, new vec4(c.x * 0.5, c.y * 0.5, c.z * 0.5, c.w * 0.5))
    kit.addRing(vec3.zero(), vec3.forward(), this.idleDotRadius * 1.9, this.idleDotRadius * 0.25, new vec4(c.x * 0.35, c.y * 0.35, c.z * 0.35, 0.35), 32)
    if (this.dotMaterial) spawnMesh(wrap, "IdleDotMesh", kit.build(), this.dotMaterial)
    const pop = new Pop(wrap, vec3.one(), false)
    this.pieces.push({pop, so: wrap})
    return {pop, so: wrap}
  }

  private buildButton(parent: SceneObject, name: string, size: vec3, shape: string, style: string, label: string | null, role: TextRole): Piece {
    const wrap = this.child(parent, name + "Pop")
    const so = this.child(wrap, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.setVariant({theme: "SnapOS2", shape, style})
    btn.size = size
    if (label) this.addButtonLabel(so, label, size.x - 0.6, role)
    const pop = new Pop(wrap, vec3.one(), false)
    btn.onTriggerDown.add(() => pop.setPressed(true))
    btn.onTriggerUp.add(() => pop.setPressed(false))
    btn.onHoverExit.add(() => pop.setPressed(false))
    const piece = {pop, so, btn}
    this.pieces.push(piece)
    return piece
  }

  private addButtonLabel(parent: SceneObject, text: string, widthCM: number, role: TextRole): void {
    const so = this.child(parent, "ButtonLabel")
    so.getTransform().setLocalPosition(new vec3(0, 0, BUTTON_LABEL_Z))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyTextRole(t, role)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -1.2, 1.2)
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
    const dt = getDeltaTime()
    for (const p of this.pieces) p.pop.update(dt)
    this.updateScale()
    this.faceCamera()
    this.placeCaption()
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
