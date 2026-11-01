import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Pop, yawToward} from "./CutawayTween"

const FONT_SIZE_SCALE = 1.0
type TextRole = "Callout" | "Caption"
const TYPE_SCALE: Record<TextRole, {size: number; weight: number}> = {
  Callout: {size: 39, weight: 700},
  Caption: {size: 38, weight: 500}
}
function applyTextRole(t: Text, role: TextRole): void {
  t.size = TYPE_SCALE[role].size * FONT_SIZE_SCALE
  ;(t as Text & {weight?: number}).weight = TYPE_SCALE[role].weight
}

interface Label {
  so: SceneObject
  text: Text
  pop: Pop
}

/**
 * Floating text labels used by the explanations ("Lens", "Sensor", ...). Labels face the
 * user, pop in/out with a spring, and are scaled with distance so they stay readable.
 */
@component
export class CutawayLabelsUI extends BaseScriptComponent {
  @ui.label("Cutaway labels — short captions placed on real objects during an explanation")
  @ui.separator
  @input
  @hint("Label text color (light colors only: dark is transparent on Specs)")
  @widget(new ColorWidget())
  textColor: vec4 = new vec4(0.88, 0.96, 1.0, 1.0)

  @input
  @hint("Distance (cm) at which labels are shown 1:1")
  @widget(new SliderWidget(60, 200, 5))
  designDistance: number = 110

  @input
  @hint("Maximum label width at design scale (cm)")
  @widget(new SliderWidget(8, 40, 1))
  maxWidth: number = 24

  private labels = new Map<string, Label>()
  private camTransform: Transform | null = null

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** Show (or move/update) a label at a world position. */
  show(id: string, text: string, worldPos: vec3): void {
    let label = this.labels.get(id)
    if (!label) {
      const so = global.scene.createSceneObject("Label_" + id)
      so.setParent(this.sceneObject)
      const t = so.createComponent("Component.Text") as Text
      t.depthTest = true
      applyTextRole(t, "Callout")
      t.horizontalAlignment = HorizontalAlignment.Center
      t.verticalAlignment = VerticalAlignment.Center
      t.horizontalOverflow = HorizontalOverflow.Wrap
      t.verticalOverflow = VerticalOverflow.Overflow
      t.layoutRect = Rect.create(-this.maxWidth / 2, this.maxWidth / 2, -3, 3)
      t.textFill.color = this.textColor
      label = {so, text: t, pop: new Pop(so, vec3.one(), false)}
      this.labels.set(id, label)
    }
    label.text.text = text
    const tr = label.so.getTransform()
    tr.setWorldPosition(worldPos)
    const s = Math.min(6, Math.max(1, this.distanceTo(worldPos) / this.designDistance))
    label.pop.setBaseScale(vec3.one().uniformScale(s))
    label.pop.show(true)
    this.face(label)
  }

  hide(id: string): void {
    const label = this.labels.get(id)
    if (label) label.pop.show(false)
  }

  hideAll(instant: boolean = false): void {
    this.labels.forEach((l) => l.pop.show(false, instant))
  }

  isShown(id: string): boolean {
    const label = this.labels.get(id)
    return !!label && label.pop.isShown
  }

  shownIds(): string[] {
    const out: string[] = []
    this.labels.forEach((l, id) => {
      if (l.pop.isShown) out.push(id)
    })
    return out
  }

  private distanceTo(p: vec3): number {
    return this.camTransform ? p.distance(this.camTransform.getWorldPosition()) : p.length
  }

  private face(label: Label): void {
    if (!this.camTransform) return
    const tr = label.so.getTransform()
    tr.setWorldRotation(yawToward(this.camTransform.getWorldPosition().sub(tr.getWorldPosition())))
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    this.labels.forEach((l) => {
      l.pop.update(dt)
      if (l.so.enabled) this.face(l)
    })
  }
}
