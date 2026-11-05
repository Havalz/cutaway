import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {UiPill} from "./CutawayUiKit"

/**
 * The "Reset" pill: floats low and to the left of the user (body-locked on yaw), in the lower-left
 * of the view: about 15° below and 10° left of a level gaze, so it is fully in view from the
 * default pose (§9) and clear of the middle, where the objects and their explanations are.
 * A secondary pill: outline only, in the one UI language (CutawayUiKit). Built at the chips' 110 cm
 * design scale and scaled with distance, so its type and stroke match the chips exactly.
 */
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
  downCm: number = 16

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

  private onUpdate(): void {
    const dt = getDeltaTime()
    this.pill.update(dt)
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
  }
}
