import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setFade, spawnMesh} from "./CutawayGeometry"
import {applyType, ink, setTextAlpha, UI_WHITE} from "./CutawayStyle"
import {clamp01, easeOutCubic, Fader, faceToward} from "./CutawayTween"

interface Label {
  so: SceneObject
  text: Text
  fader: Fader
  /** Callout parts (only when the label points at a part). */
  leader: SceneObject | null
  leaderMat: Material | null
  dot: SceneObject | null
  leaderLen: number
  drawT: number
}

/**
 * Words placed in the room during an explanation:
 * - Callout labels: a small anchor dot on the part, a hairline leader line, and four words or
 *   fewer. Without an anchor a label is plain text at its spot.
 * - The caption: one line of narration per beat (nine words or fewer). Only one shows at a time.
 * Text faces the user and is scaled with distance so it reads the same from ~3–5 m.
 */
@component
export class CutawayLabelsUI extends BaseScriptComponent {
  @ui.label("Cutaway labels — callouts and the one caption shown during an explanation")
  @ui.separator
  @input
  @hint("Distance (cm) at which labels are shown 1:1")
  @widget(new SliderWidget(60, 200, 5))
  designDistance: number = 110

  @input
  @hint("Smallest label scale, for labels closer than the design distance (keeps the angular size)")
  @widget(new SliderWidget(0.2, 1, 0.05))
  minScale: number = 0.3

  @input
  @hint("Maximum label width at design scale (cm)")
  @widget(new SliderWidget(8, 40, 1))
  maxWidth: number = 24

  @input
  @hint("Maximum caption width at design scale (cm)")
  @widget(new SliderWidget(8, 40, 1))
  captionWidth: number = 21

  private labels = new Map<string, Label>()
  private captions: Label[] = []
  private camTransform: Transform | null = null
  private lineMaterial: Material | null = null

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  /** Additive material for leader lines and anchor dots (set by CutawayMain). */
  setLineMaterial(m: Material): void {
    this.lineMaterial = m
  }

  /**
   * Show (or move/update) a label at a world position. With `anchor`, it becomes a callout: a dot
   * on the part and a hairline leader line ending at the label, with the text beside it.
   */
  show(id: string, text: string, worldPos: vec3, anchor?: vec3): void {
    let label = this.labels.get(id)
    if (!label) {
      label = this.makeLabel("Label_" + id)
      this.labels.set(id, label)
    }
    label.text.text = text
    const s = this.scaleAt(worldPos)
    const tr = label.so.getTransform()
    tr.setWorldPosition(worldPos)
    tr.setLocalScale(vec3.one().uniformScale(s))
    this.face(label.so)
    this.clearCallout(label)
    const w = this.maxWidth
    if (anchor && this.lineMaterial && this.camTransform) {
      // Text sits beside the leader's end, on the side away from the part.
      const right = this.camTransform.right
      const side = right.dot(worldPos.sub(anchor)) >= 0 ? 1 : -1
      const gap = 0.6
      label.text.horizontalAlignment = side > 0 ? HorizontalAlignment.Left : HorizontalAlignment.Right
      label.text.layoutRect = side > 0 ? Rect.create(gap, gap + w, -3, 3) : Rect.create(-gap - w, -gap, -3, 3)
      this.buildCallout(label, anchor, worldPos)
    } else {
      label.text.horizontalAlignment = HorizontalAlignment.Center
      label.text.layoutRect = Rect.create(-w / 2, w / 2, -3, 3)
    }
    label.drawT = 0
    label.so.enabled = true
    label.fader.show(true, false, label.leader ? 0.12 : 0)
  }

  hide(id: string): void {
    const label = this.labels.get(id)
    if (label) label.fader.show(false)
  }

  /** Show the one caption (hanging below `topCenter`), replacing any other; null hides it. */
  setCaption(text: string | null, topCenter?: vec3): void {
    for (const c of this.captions) c.fader.show(false)
    if (!text || !topCenter) return
    let c = this.captions.find((x) => !x.fader.isShown && !x.so.enabled)
    if (!c) {
      c = this.makeLabel("Caption")
      c.text.verticalAlignment = VerticalAlignment.Top
      c.text.horizontalAlignment = HorizontalAlignment.Center
      c.text.layoutRect = Rect.create(-this.captionWidth / 2, this.captionWidth / 2, -6, 0)
      this.captions.push(c)
    }
    c.text.enableRichText = true
    c.text.text = text
    const tr = c.so.getTransform()
    tr.setWorldPosition(topCenter)
    tr.setLocalScale(vec3.one().uniformScale(this.scaleAt(topCenter)))
    this.face(c.so)
    c.so.enabled = true
    // Cross-fade: the new caption waits for the old one to clear.
    c.fader.show(true, false, 0.12)
  }

  hideAll(instant: boolean = false): void {
    this.labels.forEach((l) => l.fader.show(false, instant))
    for (const c of this.captions) c.fader.show(false, instant)
    if (instant) this.onUpdate()
  }

  isShown(id: string): boolean {
    const label = this.labels.get(id)
    return !!label && label.fader.isShown
  }

  shownIds(): string[] {
    const out: string[] = []
    this.labels.forEach((l, id) => {
      if (l.fader.isShown) out.push(id)
    })
    return out
  }

  /** The caption currently showing (for tests / tools), or null. */
  captionText(): string | null {
    const c = this.captions.find((x) => x.fader.isShown)
    return c ? c.text.text : null
  }

  // ---------------- internals ----------------

  private makeLabel(name: string): Label {
    const so = global.scene.createSceneObject(name)
    so.setParent(this.sceneObject)
    const t = so.createComponent("Component.Text") as Text
    t.depthTest = true
    applyType(t, "note")
    setTextAlpha(t, 0)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Wrap
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-this.maxWidth / 2, this.maxWidth / 2, -3, 3)
    so.enabled = false
    return {so, text: t, fader: new Fader(false), leader: null, leaderMat: null, dot: null, leaderLen: 0, drawT: 0}
  }

  private clearCallout(label: Label): void {
    if (label.leader) label.leader.destroy()
    if (label.dot) label.dot.destroy()
    label.leader = null
    label.dot = null
    label.leaderMat = null
  }

  /** Hairline from the anchor dot to the label, in world space (not under the scaled text). */
  private buildCallout(label: Label, anchor: vec3, end: vec3): void {
    const k = this.scaleAt(anchor)
    const mat = this.lineMaterial.clone()
    const d = end.sub(anchor)
    const len = d.length
    const leader = global.scene.createSceneObject("Leader")
    leader.setParent(this.sceneObject)
    const ltr = leader.getTransform()
    ltr.setWorldPosition(anchor)
    if (len > 1e-3) ltr.setWorldRotation(quat.lookAt(d.normalize(), Math.abs(d.normalize().y) > 0.95 ? vec3.forward() : vec3.up()))
    const lk = new MeshKit()
    lk.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 0.05 * k, ink(UI_WHITE, 0.45), 4, 2)
    spawnMesh(leader, "Line", lk.build(), this.lineMaterial, undefined, mat)
    ltr.setLocalScale(new vec3(1, 1, 0.0001))
    const dot = global.scene.createSceneObject("AnchorDot")
    dot.setParent(this.sceneObject)
    dot.getTransform().setWorldPosition(anchor)
    const dk = new MeshKit()
    dk.addSphere(vec3.zero(), 0.12 * k, ink(UI_WHITE, 0.9), 6, 10)
    dk.addSphere(vec3.zero(), 0.3 * k, ink(UI_WHITE, 0.15), 6, 10)
    spawnMesh(dot, "Dot", dk.build(), this.lineMaterial, undefined, mat)
    label.leader = leader
    label.dot = dot
    label.leaderMat = mat
    label.leaderLen = len
    setFade(mat, 0)
  }

  private scaleAt(p: vec3): number {
    const d = this.camTransform ? p.distance(this.camTransform.getWorldPosition()) : p.length
    return Math.min(6, Math.max(this.minScale, d / this.designDistance))
  }

  private face(so: SceneObject): void {
    if (!this.camTransform) return
    const tr = so.getTransform()
    tr.setWorldRotation(faceToward(this.camTransform.getWorldPosition().sub(tr.getWorldPosition()), this.camTransform.up))
  }

  private step(l: Label, dt: number): void {
    if (!l.so.enabled) return
    const a = l.fader.update(dt)
    setTextAlpha(l.text, a)
    this.face(l.so)
    if (l.leader && l.leaderMat) {
      // The leader draws out from the part (250 ms), then the words fade in.
      l.drawT += dt
      const draw = l.fader.isShown ? easeOutCubic(l.drawT / 0.25) : 1
      l.leader.getTransform().setLocalScale(new vec3(1, 1, Math.max(0.0001, l.leaderLen * draw)))
      setFade(l.leaderMat, l.fader.isShown ? clamp01(l.drawT / 0.08) : a)
    }
    if (!l.fader.isShown && !l.fader.isAnimating) {
      l.so.enabled = false
      this.clearCallout(l)
    }
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    this.labels.forEach((l) => this.step(l, dt))
    for (const c of this.captions) this.step(c, dt)
  }
}
