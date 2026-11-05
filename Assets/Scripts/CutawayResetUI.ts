import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setTint, spawnMesh} from "./CutawayGeometry"
import {INK, NO_LIGHT, SPACE, STROKE, TRIO, VERTEX_WHITE} from "./CutawayStyle"
import {Spring} from "./CutawayTween"
import {UiPill} from "./CutawayUiKit"

/** One slot of the discovery trio, as tests read it. */
export interface TrioSlot {
  filled: boolean
  color: vec4 | null
  scale: number
  /** The largest scale since it filled. */
  peak: number
  /** Seconds from filling until the pop came to rest (negative while it's going). */
  settledS: number
  /** Times it has glowed since it was emptied. */
  glows: number
}

interface Slot {
  ringMat: Material
  fillSo: SceneObject
  fillMat: Material
  color: vec4 | null
  /** The colour it last filled with: it fades out in that colour when emptied. */
  tint: vec4
  /** Eased 0..1, so emptying fades instead of cutting. */
  amount: number
  pop: Spring
  peak: number
  /** Seconds into the pop, or negative when none is running. */
  popT: number
  settledS: number
  glowSo: SceneObject
  glowMat: Material
  /** Seconds into the glow, or negative when none is running. */
  glowT: number
  glows: number
}

/**
 * The "Reset" pill: floats low and to the left of the user (body-locked on yaw), in the lower-left
 * of the view: about 11° below and 10° left of a level gaze, so it is fully in view from the
 * default pose (§9), clear of the middle, and above the record player and its chip.
 * A secondary pill: outline only, in the one UI language (CutawayUiKit). Built at the chips' 110 cm
 * design scale and scaled with distance, so its type and stroke match the chips exactly.
 * Just above it sits the discovery trio: three hollow rings that fill as objects are explained.
 */
const STROKE_WIDTH = STROKE.hairline

@component
export class CutawayResetUI extends BaseScriptComponent {
  @ui.label("Cutaway Reset pill — floats low and left, in the lower-left of the view")
  @ui.separator
  @ui.group_start("Placement")
  @input
  @hint("Distance in front of the user (cm, horizontal)")
  @widget(new SliderWidget(30, 120, 1))
  forwardCm: number = 60

  @input
  @hint("How far below eye level (cm)")
  @widget(new SliderWidget(10, 80, 1))
  downCm: number = 11.5

  @input
  @hint("How far to the left of the user's center line (cm)")
  @widget(new SliderWidget(0, 60, 1))
  leftCm: number = 11

  @input
  @hint("How quickly the pill catches up when the user turns (1/s)")
  @widget(new SliderWidget(1, 15, 0.5))
  followSpeed: number = 5

  @input
  @hint("The pill stays put until the head turns this far (deg) away from it, so glancing toward it never pushes it away")
  @widget(new SliderWidget(10, 90, 1))
  deadzoneDeg: number = 40
  @ui.group_end

  @ui.group_start("Style (matches the chips)")
  @input
  @hint("Pill label")
  label: string = "Reset"

  @input
  @hint("Additive glow material for the outline (the same one the chips use)")
  glowMaterial: Material

  @input
  @hint("Pill width at the design scale (cm); its height matches the chips")
  @widget(new SliderWidget(6, 16, 0.5))
  pillWidth: number = 9

  @input
  @hint("Pill height at the design scale (cm) — the chips' row height")
  @widget(new SliderWidget(2.4, 5, 0.1))
  pillHeight: number = 3.2

  @input
  @hint("Distance (cm) at which the pill is shown 1:1, as for the chips")
  @widget(new SliderWidget(60, 200, 5))
  designDistance: number = 110
  @ui.group_end

  readonly onResetPressed = new Event<void>()
  /** Fired on every pinch of the pill (world position of the pill). */
  readonly onPinch = new Event<vec3>()

  private pill: UiPill
  private trioRoot: SceneObject
  private slots: Slot[] = []
  private camTransform: Transform | null = null
  private placed = false
  private anchorDir: vec3 = new vec3(0, 0, -1)
  private recentering = false

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.pill = new UiPill({
      parent: this.sceneObject,
      name: "ResetPill",
      popName: "ResetPop",
      glassName: "ResetGlow",
      label: this.label,
      width: this.pillWidth,
      height: this.pillHeight,
      material: this.glowMaterial,
      kind: "outline",
      startShown: true
    })
    this.pill.onPinch = (p) => this.onPinch.invoke(p)
    this.pill.btn.onTriggerUp.add(() => this.onResetPressed.invoke())
    this.buildTrio()

    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** The pill's four world corners (layout tests). */
  getCorners(): vec3[] {
    const m = this.pill.so.getTransform().getWorldTransform()
    const w = this.pillWidth / 2
    const h = this.pillHeight / 2
    return [new vec3(-w, -h, 0), new vec3(w, -h, 0), new vec3(w, h, 0), new vec3(-w, h, 0)].map((q) => m.multiplyPoint(q))
  }

  /** The pill and the trio together: what a rail must keep clear of. */
  getClearCorners(): vec3[] {
    const m = this.pill.so.getTransform().getWorldTransform()
    const w = this.pillWidth / 2
    const h = this.pillHeight / 2
    const top = this.trioCenter() + TRIO.radius
    return [new vec3(-w, -h, 0), new vec3(w, -h, 0), new vec3(w, top, 0), new vec3(-w, top, 0)].map((q) => m.multiplyPoint(q))
  }

  /** Fill a slot in an object's energy colour, with a small pop. A full slot stays as it is. */
  fillSlot(i: number, color: vec4): void {
    const s = this.slots[i]
    if (!s || s.color) return
    s.color = color
    s.tint = color
    s.fillSo.enabled = true
    s.pop.snap(TRIO.popScale)
    s.pop.target = 1
    s.peak = TRIO.popScale
    s.popT = 0
    s.settledS = -1
    s.amount = Math.max(s.amount, 0.5)
  }

  emptySlots(): void {
    this.slots.forEach((s) => {
      s.color = null
      s.glowT = -1
      s.glows = 0
      s.glowSo.enabled = false
    })
  }

  /** Every full slot glows once. */
  glowSlots(): void {
    this.slots.forEach((s) => {
      if (!s.color) return
      s.glowT = 0
      s.glows++
      s.glowSo.enabled = true
      setTint(s.glowMat, s.tint, 0)
    })
  }

  getSlots(): TrioSlot[] {
    return this.slots.map((s) => ({filled: !!s.color, color: s.color, scale: s.pop.value, peak: s.peak, settledS: s.settledS, glows: s.glows}))
  }

  private trioCenter(): number {
    return this.pillHeight / 2 + SPACE + TRIO.radius
  }

  private buildTrio(): void {
    this.trioRoot = global.scene.createSceneObject("Trio")
    this.trioRoot.setParent(this.sceneObject)
    for (let i = 0; i < 3; i++) {
      const slot = global.scene.createSceneObject("TrioSlot" + i)
      slot.setParent(this.trioRoot)
      slot.getTransform().setLocalPosition(new vec3((i - 1) * TRIO.pitch, 0, 0))
      const ringKit = new MeshKit()
      ringKit.addArcXY(0, 0, TRIO.radius, STROKE_WIDTH, 0, Math.PI * 2, VERTEX_WHITE, 32)
      const ring = spawnMesh(slot, "TrioRing", ringKit.build(), this.glowMaterial)
      setTint(ring.mat, INK, TRIO.ringLevel)
      const fillKit = new MeshKit()
      fillKit.addFanXY(0, 0, TRIO.radius, 0, Math.PI * 2, VERTEX_WHITE, VERTEX_WHITE, 32)
      fillKit.addSoftRingXY(0, 0, TRIO.radius, TRIO.radius * 1.5, VERTEX_WHITE, NO_LIGHT, 32)
      const fill = spawnMesh(slot, "TrioFill", fillKit.build(), this.glowMaterial)
      setTint(fill.mat, INK, 0)
      fill.so.enabled = false
      const glowKit = new MeshKit()
      glowKit.addFanXY(0, 0, TRIO.radius * TRIO.glowRadius, 0, Math.PI * 2, VERTEX_WHITE, NO_LIGHT, 32)
      const glow = spawnMesh(slot, "TrioGlow", glowKit.build(), this.glowMaterial)
      glow.so.enabled = false
      this.slots.push({ringMat: ring.mat, fillSo: fill.so, fillMat: fill.mat, color: null, tint: INK, amount: 0, pop: new Spring(TRIO.popStiffness, 1, 1), peak: 1, popT: -1, settledS: -1, glowSo: glow.so, glowMat: glow.mat, glowT: -1, glows: 0})
    }
  }

  private updateTrio(dt: number): void {
    this.slots.forEach((s) => {
      s.pop.update(dt)
      if (s.popT >= 0) {
        s.popT += dt
        if (s.pop.value < 1.005) {
          s.settledS = s.popT
          s.popT = -1
        }
      }
      const step = dt / TRIO.fadeS
      s.amount = s.color ? Math.min(1, s.amount + step) : Math.max(0, s.amount - step)
      if (s.glowT >= 0) {
        s.glowT += dt
        const k = s.glowT / TRIO.glowS
        if (k >= 1) {
          s.glowT = -1
          s.glowSo.enabled = false
        } else setTint(s.glowMat, s.tint, TRIO.glowLevel * Math.sin(Math.PI * k))
      }
      if (!s.fillSo.enabled) return
      setTint(s.fillMat, s.tint, TRIO.fillLevel * s.amount)
      s.fillSo.getTransform().setLocalScale(vec3.one().uniformScale(s.pop.value))
      if (!s.color && s.amount <= 0) s.fillSo.enabled = false
    })
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    this.pill.update(dt)
    this.updateTrio(dt)
    if (!this.camTransform) return
    const camPos = this.camTransform.getWorldPosition()
    const look = this.camTransform.forward.uniformScale(-1)
    let flat = new vec3(look.x, 0, look.z)
    flat = flat.length > 1e-4 ? flat.normalize() : this.anchorDir

    // Lazy body-lock: the anchor direction only turns once the head has turned past the deadzone,
    // then eases back to the current heading. Looking toward the pill leaves it where it is.
    const k = this.placed ? 1 - Math.exp(-this.followSpeed * dt) : 1
    if (!this.placed) this.anchorDir = flat
    const offDeg = (Math.acos(Math.max(-1, Math.min(1, this.anchorDir.dot(flat)))) * 180) / Math.PI
    if (offDeg > this.deadzoneDeg) this.recentering = true
    if (this.recentering) {
      this.anchorDir = vec3.lerp(this.anchorDir, flat, k).normalize()
      if (offDeg < 4) this.recentering = false
    }
    this.placed = true

    const fwd = this.anchorDir
    const left = vec3.up().cross(fwd).normalize()
    const target = camPos.add(fwd.uniformScale(this.forwardCm)).add(left.uniformScale(this.leftCm)).add(new vec3(0, -this.downCm, 0))
    const tr = this.sceneObject.getTransform()
    const p = vec3.lerp(tr.getWorldPosition(), target, k)
    tr.setWorldPosition(p)
    const toCam = camPos.sub(p)
    if (toCam.length > 1e-3) tr.setWorldRotation(quat.lookAt(toCam.normalize(), vec3.up()))
    // Same angular size as the chips: design scale at 110 cm, scaled with distance.
    const s = Math.min(6, Math.max(0.3, toCam.length / this.designDistance))
    this.pill.pop.setBaseScale(vec3.one().uniformScale(s))
    const trio = this.trioRoot.getTransform()
    trio.setLocalScale(vec3.one().uniformScale(s))
    trio.setLocalPosition(new vec3(0, this.trioCenter() * s, 0))
  }
}
