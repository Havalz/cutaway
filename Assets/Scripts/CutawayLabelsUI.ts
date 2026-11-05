import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CaptionHost, CaptionInfo, WordCaption} from "./CutawayCaption"
import {MeshKit, setFade, spawnMesh} from "./CutawayGeometry"
import {ALPHA, applyType, ink, INK, lit, setTextAlpha, STROKE} from "./CutawayStyle"
import {clamp01, easeOutCubic, Fader, faceToward} from "./CutawayTween"

/** Until a character has been measured (design cm). */
const AVG_ADVANCE = 0.38
/** Leaves room in the five-a-frame limit for anything else that needs a bounding box. */
const CHARS_PER_FRAME = 3
/** What every character is measured between. */
const PAIR = "nn"

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
  /** Callouts: the text sits right (+1) or left (-1) of the leader's end. */
  side: number
}

/**
 * Words placed in the room during an explanation:
 * - Callout labels: secondary text, an ink anchor dot on the part, a hairline leader line, and four
 *   words or fewer. Without an anchor a label is plain text at its spot. An explanation clears its
 *   labels at each beat, so the labels showing are always those of the active step.
 * - The caption: one line of narration per beat (nine words or fewer), revealed word by word. Only
 *   one shows at a time (CutawayCaption).
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
  /** Character widths at design scale (cm). */
  private advances = new Map<string, number>()
  /** Characters still to measure, last first: the pair they are measured against goes first. */
  private pendingChars: string[] = [PAIR]
  private pairWidth = 0
  private lineBox = 1
  private ruler: Label | null = null
  private caption: WordCaption
  private camTransform: Transform | null = null
  private lineMaterial: Material | null = null

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    for (let c = 32; c <= 126; c++) this.pendingChars.unshift(String.fromCharCode(c))
    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.caption = new WordCaption(this.sceneObject, {
      measure: (w) => this.measure(w).x,
      scaleAt: (p) => this.scaleAt(p),
      camera: () => this.camTransform
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
    // After the rail has moved this frame, so words on it don't trail behind it.
    this.createEvent("LateUpdateEvent").bind(() => this.caption.follow())
  }

  /** Additive material for leader lines and anchor dots (set by CutawayMain). */
  setLineMaterial(m: Material): void {
    this.lineMaterial = m
  }

  /**
   * Show (or move/update) a label at a world position. With `anchor`, it becomes a callout: a dot
   * on the part and a hairline leader line ending at the label, with the text beside it.
   */
  show(id: string, text: string, worldPos: vec3, anchor?: vec3, side?: number): void {
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
      this.setSide(label, side ?? (right.dot(worldPos.sub(anchor)) >= 0 ? 1 : -1))
      this.buildCallout(label, anchor, worldPos)
    } else {
      label.text.horizontalAlignment = HorizontalAlignment.Center
      label.text.layoutRect = Rect.create(-w / 2, w / 2, -3, 3)
    }
    label.drawT = 0
    label.so.enabled = true
    label.fader.show(true, false, label.leader ? 0.12 : 0)
  }

  /** Change the words of a label that is showing, in place. */
  setText(id: string, text: string): void {
    const label = this.labels.get(id)
    if (label && label.text.text !== text) label.text.text = text
  }

  /** Move a label that is showing (and its callout) without rebuilding it, e.g. to follow a moving part. */
  move(id: string, worldPos: vec3, anchor?: vec3, side?: number): void {
    const label = this.labels.get(id)
    if (!label || !label.fader.isShown) return
    if (side !== undefined && anchor && side !== label.side) this.setSide(label, side)
    const tr = label.so.getTransform()
    tr.setWorldPosition(worldPos)
    tr.setLocalScale(vec3.one().uniformScale(this.scaleAt(worldPos)))
    if (anchor && label.leader && label.dot) {
      const d = worldPos.sub(anchor)
      const len = d.length
      const ltr = label.leader.getTransform()
      ltr.setWorldPosition(anchor)
      if (len > 1e-3) ltr.setWorldRotation(quat.lookAt(d.normalize(), Math.abs(d.normalize().y) > 0.95 ? vec3.forward() : vec3.up()))
      label.leaderLen = len
      label.dot.getTransform().setWorldPosition(anchor)
    }
  }

  hide(id: string): void {
    const label = this.labels.get(id)
    if (label) label.fader.show(false)
  }

  /**
   * The one caption, replacing any other once it has faded; null hides it. With `host` it lives on
   * the rail; otherwise it hangs below `topCenter`.
   */
  setCaption(text: string | null, topCenter?: vec3, host?: CaptionHost): void {
    this.caption.set(text, topCenter ?? null, this.captionWidth, host ?? null)
  }

  /** A line that isn't part of the story (the opening): any real caption replaces it. */
  setAmbientCaption(text: string | null, at?: vec3): void {
    if (text && at) this.caption.set(text, at, this.captionWidth, null, true)
    else this.caption.clearAmbient()
  }

  /** The caption on screen, word by word (tests). */
  getCaptionInfo(): CaptionInfo | null {
    return this.caption.info()
  }

  hideAll(instant: boolean = false): void {
    this.labels.forEach((l) => l.fader.show(false, instant))
    this.caption.hide(instant)
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

  /** The caption currently showing, as plain words (for tests / tools), or null. */
  captionText(): string | null {
    return this.caption.text()
  }

  /** Distance (cm) at which labels show 1:1; their angular size is constant beyond 1/minScale of it. */
  getDesignDistance(): number {
    return this.designDistance
  }

  /**
   * Words at design scale (cm): width and height of the glyphs. Text.getBoundingBox is limited to
   * five calls a frame, so widths come from a table of character advances filled over the first
   * frames (see measureChars); words are a plain sum of them, the type having no kerning to speak of.
   */
  measure(text: string): vec2 {
    let w = 0
    for (let i = 0; i < text.length; i++) w += this.advances.get(text[i]) ?? AVG_ADVANCE
    return new vec2(w, this.lineBox)
  }

  /** A few characters a frame, until the table is full. */
  private measureChars(): void {
    if (!this.pendingChars.length) return
    if (!this.ruler) {
      this.ruler = this.makeLabel("LabelRuler")
      this.ruler.text.horizontalAlignment = HorizontalAlignment.Left
      this.ruler.text.layoutRect = Rect.create(0, this.maxWidth, -3, 3)
    }
    for (let i = 0; i < CHARS_PER_FRAME && this.pendingChars.length; i++) {
      const c = this.pendingChars[this.pendingChars.length - 1]
      // A glyph's bounds are tight, so its advance is what it adds between two letters. That also
      // covers the space, which has no glyph at all.
      this.ruler.text.text = c === PAIR ? PAIR : "n" + c + "n"
      let r: Rect
      try {
        r = this.ruler.text.getBoundingBox()
      } catch (e) {
        return
      }
      this.pendingChars.pop()
      if (r.right <= r.left) continue
      this.lineBox = r.top - r.bottom
      if (c === PAIR) this.pairWidth = r.right - r.left
      else this.advances.set(c, r.right - r.left - this.pairWidth)
    }
  }

  /** The caption's words as a world quad (4 corners), or null when no caption shows. */
  getCaptionQuad(): vec3[] | null {
    return this.caption.quad()
  }

  /** A label's glyph bounds in its own space (its text box, past the bounding-box rate limit). */
  private localRect(l: Label): Rect {
    try {
      return l.text.getBoundingBox()
    } catch (e) {
      return l.text.layoutRect
    }
  }

  private setSide(label: Label, side: number): void {
    const w = this.maxWidth
    const gap = 0.6
    label.side = side
    label.text.horizontalAlignment = side > 0 ? HorizontalAlignment.Left : HorizontalAlignment.Right
    label.text.layoutRect = side > 0 ? Rect.create(gap, gap + w, -3, 3) : Rect.create(-gap - w, -gap, -3, 3)
  }

  /** World corners of each shown label's text and of the caption (layout tests): id, words, 4 corners. */
  getTextQuads(): {id: string; text: string; corners: vec3[]}[] {
    const out: {id: string; text: string; corners: vec3[]}[] = []
    const add = (id: string, l: Label) => {
      if (!l.fader.isShown || !l.so.enabled) return
      const r = this.localRect(l)
      const m = l.so.getTransform().getWorldTransform()
      const corners = [new vec3(r.left, r.bottom, 0), new vec3(r.right, r.bottom, 0), new vec3(r.right, r.top, 0), new vec3(r.left, r.top, 0)].map((q) => m.multiplyPoint(q))
      out.push({id, text: l.text.text, corners})
    }
    this.labels.forEach((l, id) => add(id, l))
    const quad = this.caption.quad()
    if (quad) out.push({id: "caption", text: this.caption.text(), corners: quad})
    return out
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
    return {so, text: t, fader: new Fader(false), leader: null, leaderMat: null, dot: null, leaderLen: 0, drawT: 0, side: 1}
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
    lk.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], (STROKE.hairline / 2) * k, lit(INK, ALPHA.hairline), 4, 2)
    spawnMesh(leader, "Line", lk.build(), this.lineMaterial, undefined, mat)
    ltr.setLocalScale(new vec3(1, 1, 0.0001))
    const dot = global.scene.createSceneObject("AnchorDot")
    dot.setParent(this.sceneObject)
    dot.getTransform().setWorldPosition(anchor)
    const dk = new MeshKit()
    dk.addSphere(vec3.zero(), 0.12 * k, lit(INK, ALPHA.text), 6, 10)
    dk.addSphere(vec3.zero(), 0.3 * k, ink(INK, 0.15), 6, 10)
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
    setTextAlpha(l.text, a, ALPHA.secondary)
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
    this.measureChars()
    this.labels.forEach((l) => this.step(l, dt))
    this.caption.update(dt)
  }
}
