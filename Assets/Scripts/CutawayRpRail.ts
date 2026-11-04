/**
 * Record player hero: the control rail beside the copy, on the user's side (recordplayer-hero.md).
 * The same look and behaviour as the camera's rail (CutawayHeroUI): UI Kit sliders and a pill do
 * the input; their own visuals are masked and everything is drawn with light (hairline strokes,
 * 85% white text), built at the 110 cm design scale and scaled with distance so the pinch targets
 * keep a constant apparent size. It shows only what the current step needs:
 *   "rest": "Take apart" and "Put it back" (the arm at rest);
 *   "play": "Loudness", "Pitch" and "Put it back" (once the record plays).
 * Built in code by the record player stage (no scene component), placed by it every frame.
 */
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {Slider} from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setFade, spawnMesh, UnitLine} from "./CutawayGeometry"
import {CapsuleGlow} from "./CutawayStationUI"
import {applyType, FILL_ALPHA, ink, setTextAlpha, STROKE_ALPHA, UI_WHITE} from "./CutawayStyle"
import {faceToward, Pop, Spring} from "./CutawayTween"

export type RpRailMode = "none" | "rest" | "play"

export interface RpRailVisual {
  apart: boolean
  loudness: boolean
  pitch: boolean
  putBack: boolean
}

type SliderKey = "apart" | "loudness" | "pitch"

interface LightSlider {
  pop: Pop
  slider: Slider
  label: Text
  knob: SceneObject
  knobMat: Material
  fill: UnitLine
  trackMat: Material
  masked: boolean
  hover: Spring
  row: Spring
}

interface Pill {
  pop: Pop
  so: SceneObject
  btn: Button
  glow: CapsuleGlow | null
  label: Text
  masked: boolean
}

const SLIDER_W = 16
const ROW_H = 3.2
const DESIGN_D = 110

export class RpRail {
  readonly so: SceneObject
  /** Fired when "Put it back" is pinched. */
  onPutBack: (() => void) | null = null
  /** Fired on every pinch of a rail control (world position), for the tick sound. */
  onPinch: ((p: vec3) => void) | null = null

  private panel: SceneObject
  private sliders: Record<SliderKey, LightSlider>
  private putBack: Pill
  private mode: RpRailMode = "none"
  private camTransform: Transform | null = null

  constructor(parent: SceneObject, private glowMaterial: Material) {
    this.so = this.child(parent, "RpRail")
    this.so.createComponent("Component.Canvas")
    this.panel = this.child(this.so, "RpRailPanel")
    this.sliders = {
      apart: this.buildSlider("RpRailApart", "Take apart"),
      loudness: this.buildSlider("RpRailLoudness", "Loudness"),
      pitch: this.buildSlider("RpRailPitch", "Pitch")
    }
    this.putBack = this.buildPill("RpRailPutBack", "Put it back", 10.5)
    this.putBack.pop.so.getTransform().setLocalPosition(new vec3(0, -(ROW_H + 1.6), 0))
    this.putBack.btn.onTriggerUp.add(() => {
      if (this.putBack.pop.isShown && this.onPutBack) this.onPutBack()
    })
    try {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    } catch (e) {
      this.camTransform = null
    }
    this.setMode("none", true)
  }

  // ---------------- Public API ----------------

  /** Show only the controls this step needs. `instant` skips the animation (Reset). */
  setMode(mode: RpRailMode, instant: boolean = false): void {
    this.mode = mode
    const s = this.sliders
    s.apart.pop.show(mode === "rest", instant)
    s.loudness.pop.show(mode === "play", instant)
    s.pitch.pop.show(mode === "play", instant)
    this.putBack.pop.show(mode !== "none", instant)
    // Rows: "Take apart" (rest) or "Loudness" sit right above "Put it back"; "Pitch" a row above.
    s.apart.row.target = 0
    s.loudness.row.target = 0
    s.pitch.row.target = ROW_H + 3
    if (instant) for (const k of Object.keys(s) as SliderKey[]) s[k].row.snap(s[k].row.target)
  }

  getMode(): RpRailMode {
    return this.mode
  }

  /** Slider value 0..1 (follows the knob while it is dragged). */
  getValue(k: SliderKey): number {
    return this.sliders[k].slider.knobValue
  }

  setValue(k: SliderKey, v: number): void {
    this.sliders[k].slider.resetToValue(Math.max(0, Math.min(1, v)))
  }

  /** Change a slider's label (e.g. "Pitch  440 Hz"). */
  setLabel(k: SliderKey, text: string): void {
    const t = this.sliders[k].label
    if (t.text !== text) t.text = text
  }

  isDragging(): boolean {
    return (Object.keys(this.sliders) as SliderKey[]).some((k) => (this.sliders[k].slider as unknown as {_isDragged?: boolean})._isDragged === true)
  }

  getVisual(): RpRailVisual {
    const s = this.sliders
    return {apart: s.apart.pop.isShown, loudness: s.loudness.pop.isShown, pitch: s.pitch.pop.isShown, putBack: this.putBack.pop.isShown}
  }

  /** True while any part of the rail is still on screen (including its exit animation). */
  isVisible(): boolean {
    const s = this.sliders
    return [s.apart.pop, s.loudness.pop, s.pitch.pop, this.putBack.pop].some((p) => p.so.enabled)
  }

  /** Place the rail at `p` (world), facing the viewer, scaled to keep its apparent size. */
  place(p: vec3): void {
    const tr = this.so.getTransform()
    tr.setWorldPosition(p)
    if (!this.camTransform) return
    const cam = this.camTransform.getWorldPosition()
    tr.setWorldRotation(faceToward(cam.sub(p), this.camTransform.up))
    this.panel.getTransform().setLocalScale(vec3.one().uniformScale(RpRail.scaleAt(p, cam)))
  }

  /** The rail's scale at `p` seen from `cam` (it keeps its apparent size). */
  static scaleAt(p: vec3, cam: vec3): number {
    return Math.min(6, Math.max(0.3, p.distance(cam) / DESIGN_D))
  }

  /** World boxes (8 corners) of the rail's visible text and meshes (layout checks). */
  getBoxes(): vec3[][] {
    const out: vec3[][] = []
    const corners = (m: mat4, a: vec3, b: vec3) => {
      const c: vec3[] = []
      for (const x of [a.x, b.x]) for (const y of [a.y, b.y]) for (const z of [a.z, b.z]) c.push(m.multiplyPoint(new vec3(x, y, z)))
      return c
    }
    const walk = (so: SceneObject) => {
      if (!so.enabled) return
      const m = so.getTransform().getWorldTransform()
      const t = so.getComponent("Component.Text") as Text
      if (t && t.enabled && t.text.length) {
        try {
          const r = t.getBoundingBox()
          out.push(corners(m, new vec3(r.left, r.bottom, 0), new vec3(r.right, r.top, 0)))
        } catch (e) {
          // rich text: no glyph bounds
        }
      }
      const v = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
      if (v && v.enabled && v.mesh) out.push(corners(m, v.mesh.aabbMin, v.mesh.aabbMax))
      for (let i = 0; i < so.getChildrenCount(); i++) walk(so.getChild(i))
    }
    walk(this.panel)
    return out
  }

  /** Per frame (driven by the stage). */
  update(dt: number): void {
    for (const k of Object.keys(this.sliders) as SliderKey[]) this.updateSlider(this.sliders[k], dt)
    const p = this.putBack
    if (!p.masked) this.maskPill(p)
    p.pop.update(dt)
    if (p.glow && p.so.isEnabledInHierarchy) p.glow.update(dt)
  }

  destroy(): void {
    this.so.destroy()
  }

  // ---------------- Build ----------------

  private child(parent: SceneObject, name: string): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    return so
  }

  private text(parent: SceneObject, value: string, align: HorizontalAlignment, rect: Rect): Text {
    const so = this.child(parent, "Label")
    so.getTransform().setLocalPosition(new vec3(0, 0, 0.08))
    const t = so.createComponent("Component.Text") as Text
    t.text = value
    t.depthTest = true
    applyType(t, "ui")
    setTextAlpha(t, 0)
    t.horizontalAlignment = align
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = rect
    return t
  }

  private buildSlider(name: string, labelText: string): LightSlider {
    const wrap = this.child(this.panel, name + "Pop")
    const so = this.child(wrap, name)
    const slider = so.createComponent(Slider.getTypeName()) as Slider
    slider.size = new vec3(SLIDER_W, ROW_H, 1)
    slider.knobSize = new vec2(ROW_H, ROW_H)
    const track = SLIDER_W - ROW_H
    const label = this.text(wrap, labelText, HorizontalAlignment.Left, Rect.create(-track / 2, track / 2 + 4, -1.2, 1.2))
    label.getSceneObject().getTransform().setLocalPosition(new vec3(0, ROW_H * 0.5 + 1.5, 0.08))

    const trackMat = this.glowMaterial.clone()
    const tk = new MeshKit()
    tk.addRectXY(-track / 2, -0.045, track / 2, 0.045, ink(UI_WHITE, STROKE_ALPHA))
    tk.addRectXY(-track / 2 - 0.045, -0.35, -track / 2 + 0.045, 0.35, ink(UI_WHITE, STROKE_ALPHA))
    tk.addRectXY(track / 2 - 0.045, -0.35, track / 2 + 0.045, 0.35, ink(UI_WHITE, STROKE_ALPHA))
    spawnMesh(so, name + "Track", tk.build(), this.glowMaterial, new vec3(0, 0, 0.02), trackMat)
    const fill = new UnitLine(so, name + "Fill", this.glowMaterial, 0.22, ink(UI_WHITE, 0.85), 0, trackMat)
    fill.so.getTransform().setLocalPosition(new vec3(-track / 2, 0, 0.03))

    const knob = this.child(so, name + "Knob")
    const kk = new MeshKit()
    const r = ROW_H * 0.36
    kk.addArcXY(0, 0, r, 0.13, 0, Math.PI * 2, ink(UI_WHITE, 0.9), 40)
    kk.addFanXY(0, 0, r - 0.07, 0, Math.PI * 2, ink(UI_WHITE, 0.16), ink(UI_WHITE, FILL_ALPHA), 40)
    const knobMat = this.glowMaterial.clone()
    spawnMesh(knob, name + "KnobRing", kk.build(), this.glowMaterial, new vec3(0, 0, 0.04), knobMat)

    const hover = new Spring(900, 1, 1)
    slider.onHoverEnter.add(() => (hover.target = 1.5))
    slider.onHoverExit.add(() => (hover.target = 1))
    slider.onTriggerDown.add(() => {
      if (this.onPinch) this.onPinch(knob.getTransform().getWorldPosition())
    })

    const ls: LightSlider = {pop: undefined as unknown as Pop, slider, label, knob, knobMat, fill, trackMat, masked: false, hover, row: new Spring(420, 0.9, 0)}
    ls.pop = new Pop(wrap, vec3.one(), false, {
      onAmount: (a) => {
        setTextAlpha(label, a)
        setFade(trackMat, a)
        setFade(knobMat, a * ls.hover.value)
      }
    })
    return ls
  }

  private buildPill(name: string, labelText: string, width: number): Pill {
    const wrap = this.child(this.panel, name + "Pop")
    const so = this.child(wrap, name)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.setVariant({theme: "SnapOS2", shape: "Capsule", style: "Ghost"})
    btn.size = new vec3(width, ROW_H, 1)
    const glow = new CapsuleGlow(so, name + "Glow", this.glowMaterial, ROW_H)
    glow.setShape(width, ROW_H)
    const hw = width / 2 - 0.3
    const label = this.text(so, labelText, HorizontalAlignment.Center, Rect.create(-hw, hw, -1.2, 1.2))
    const pop = new Pop(wrap, vec3.one(), false, {
      minScale: 0.85,
      onAmount: (a) => {
        glow.setOpacity(a)
        setTextAlpha(label, a)
      }
    })
    btn.onTriggerDown.add(() => {
      pop.setPressed(true)
      if (this.onPinch) this.onPinch(so.getTransform().getWorldPosition())
    })
    btn.onTriggerUp.add(() => pop.setPressed(false))
    btn.onHoverEnter.add(() => glow.setHover(true))
    btn.onHoverExit.add(() => {
      pop.setPressed(false)
      glow.setHover(false)
    })
    return {pop, so, btn, glow, label, masked: false}
  }

  // ---------------- Frame loop ----------------

  private maskSlider(s: LightSlider): void {
    const vs = [s.slider.visual, s.slider.knobVisual, s.slider.trackFillVisual]
    if (vs.some((v) => !v || !v.renderMeshVisual)) return
    for (const v of vs) v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
    s.masked = true
  }

  private maskPill(p: Pill): void {
    const v = p.btn.visual
    if (!v || !v.renderMeshVisual) return
    v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
    p.masked = true
  }

  private updateSlider(s: LightSlider, dt: number): void {
    if (!s.masked) this.maskSlider(s)
    s.pop.update(dt)
    s.pop.so.getTransform().setLocalPosition(new vec3(0, s.row.update(dt), 0))
    if (!s.pop.so.enabled) return
    s.hover.update(dt)
    const track = SLIDER_W - ROW_H
    const x = (s.slider.knobValue - 0.5) * track
    s.knob.getTransform().setLocalPosition(new vec3(x, 0, 0))
    s.fill.set(new vec3(-track / 2, 0, 0.03), new vec3(Math.max(-track / 2 + 1e-3, x), 0, 0.03))
    setFade(s.knobMat, s.pop.amount * s.hover.value)
  }
}
