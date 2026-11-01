import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Pop} from "./CutawayTween"

const FONT_SIZE_SCALE = 1.0
type TextRole = "Button" | "Body" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Button: {size: 39, weight: 500},
  Body: {size: 39, weight: 500},
  Caption: {size: 38, weight: 500}
}
function applyTextRole(t: Text, role: TextRole): void {
  t.size = TYPE_SCALE[role].size * FONT_SIZE_SCALE
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

/**
 * The "Reset" pill: floats low and slightly to the left of the user (body-locked on yaw),
 * so it is in view when looking down and out of the way when looking at the room.
 */
@component
export class CutawayResetUI extends BaseScriptComponent {
  @ui.label("Cutaway Reset pill — floats low and slightly left of the user")
  @ui.separator
  @ui.group_start("Placement")
  @input
  @hint("Distance in front of the user (cm, horizontal)")
  @widget(new SliderWidget(30, 120, 1))
  forwardCm: number = 55

  @input
  @hint("How far below eye level (cm)")
  @widget(new SliderWidget(10, 80, 1))
  downCm: number = 42

  @input
  @hint("How far to the left of the user's center line (cm)")
  @widget(new SliderWidget(0, 60, 1))
  leftCm: number = 18

  @input
  @hint("How quickly the pill catches up when the user turns (1/s)")
  @widget(new SliderWidget(1, 15, 0.5))
  followSpeed: number = 5

  @input
  @hint("The pill stays put until the head turns this far (deg) away from it, so glancing toward it never pushes it away")
  @widget(new SliderWidget(10, 90, 1))
  deadzoneDeg: number = 40
  @ui.group_end

  @ui.group_start("Style")
  @input
  @hint("Pill label")
  label: string = "Reset"

  @input
  @hint("UIKit style for the pill")
  @widget(
    new ComboBoxWidget([
      new ComboBoxItem("PrimaryNeutral", "PrimaryNeutral"),
      new ComboBoxItem("Primary", "Primary"),
      new ComboBoxItem("Secondary", "Secondary"),
      new ComboBoxItem("Special", "Special")
    ])
  )
  style: string = "PrimaryNeutral"
  @ui.group_end

  readonly onResetPressed = new Event<void>()

  private holder: SceneObject
  private pop: Pop
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
    btn.setVariant({theme: "SnapOS2", shape: "Capsule", style: this.style})
    btn.size = new vec3(8, 2.8, 1)

    const labelSo = global.scene.createSceneObject("ButtonLabel")
    labelSo.setParent(so)
    labelSo.getTransform().setLocalPosition(new vec3(0, 0, 0.08))
    const t = labelSo.createComponent("Component.Text") as Text
    t.text = this.label
    t.depthTest = true
    applyTextRole(t, "Button")
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-3.7, 3.7, -1.2, 1.2)

    this.pop = new Pop(this.holder, vec3.one(), true)
    btn.onTriggerDown.add(() => this.pop.setPressed(true))
    btn.onTriggerUp.add(() => {
      this.pop.setPressed(false)
      this.onResetPressed.invoke()
    })
    btn.onHoverExit.add(() => this.pop.setPressed(false))

    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    this.pop.update(dt)
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
  }
}
