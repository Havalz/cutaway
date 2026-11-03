import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CapsuleGlow} from "./CutawayStationUI"
import {applyType, setTextAlpha} from "./CutawayStyle"
import {Pop} from "./CutawayTween"

/**
 * The "Reset" pill: floats low and to the left of the user (body-locked on yaw), in the lower-left
 * of the view: about 15° below and 10° left of a level gaze, so it is fully in view from the
 * default pose (§9) and clear of the middle, where the objects and their explanations are.
 * Styled like the chips: a hairline capsule of light with a faint fill and 85% white text,
 * brightening when aimed at and pressing to 97%. Built at the chips' 110 cm design scale and
 * scaled with distance, so its type and stroke match the chips exactly.
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

  private holder: SceneObject
  private pop: Pop
  private glow: CapsuleGlow | null = null
  private btn: Button
  private visualMasked = false
  private camTransform: Transform | null = null
  private placed = false
  private anchorDir: vec3 = new vec3(0, 0, -1)
  private recentering = false

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.holder = global.scene.createSceneObject("ResetPop")
    this.holder.setParent(this.sceneObject)
    const so = global.scene.createSceneObject("ResetPill")
    so.setParent(this.holder)
    const btn = so.createComponent(Button.getTypeName()) as Button
    // Ghost: no fill of its own; its visual is masked and the outline is drawn with light instead.
    btn.setVariant({theme: "SnapOS2", shape: "Capsule", style: "Ghost"})
    btn.size = new vec3(this.pillWidth, this.pillHeight, 1)
    this.btn = btn

    if (this.glowMaterial) {
      this.glow = new CapsuleGlow(so, "ResetGlow", this.glowMaterial, this.pillHeight)
      this.glow.setShape(this.pillWidth, this.pillHeight)
      this.glow.setOpacity(1)
    }

    const labelSo = global.scene.createSceneObject("ButtonLabel")
    labelSo.setParent(so)
    labelSo.getTransform().setLocalPosition(new vec3(0, 0, 0.08))
    const t = labelSo.createComponent("Component.Text") as Text
    t.text = this.label
    t.depthTest = true
    applyType(t, "ui")
    setTextAlpha(t, 1)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const hw = this.pillWidth / 2 - 0.3
    t.layoutRect = Rect.create(-hw, hw, -1.2, 1.2)

    this.pop = new Pop(this.holder, vec3.one(), true, {
      onAmount: (a) => {
        if (this.glow) this.glow.setOpacity(a)
        setTextAlpha(t, a)
      }
    })
    btn.onTriggerDown.add(() => {
      this.pop.setPressed(true)
      this.onPinch.invoke(so.getTransform().getWorldPosition())
    })
    btn.onTriggerUp.add(() => {
      this.pop.setPressed(false)
      this.onResetPressed.invoke()
    })
    btn.onHoverEnter.add(() => this.glow && this.glow.setHover(true))
    btn.onHoverExit.add(() => {
      this.pop.setPressed(false)
      if (this.glow) this.glow.setHover(false)
    })

    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** The pill's four world corners (layout tests). */
  getCorners(): vec3[] {
    const m = this.btn.getSceneObject().getTransform().getWorldTransform()
    const w = this.pillWidth / 2
    const h = this.pillHeight / 2
    return [new vec3(-w, -h, 0), new vec3(w, -h, 0), new vec3(w, h, 0), new vec3(-w, h, 0)].map((q) => m.multiplyPoint(q))
  }

  /** Masks the UIKit button's own visual once UIKit has created it. */
  private maskVisual(): void {
    const v = this.btn.visual
    if (!v || !v.renderMeshVisual) return
    v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
    this.visualMasked = true
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    if (!this.visualMasked) this.maskVisual()
    this.pop.update(dt)
    if (this.glow) this.glow.update(dt)
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
    this.pop.setBaseScale(vec3.one().uniformScale(s))
  }
}
