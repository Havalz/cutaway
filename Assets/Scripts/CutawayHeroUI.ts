import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {Slider} from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setFade, spawnMesh, UnitLine} from "./CutawayGeometry"
import {CapsuleGlow} from "./CutawayStationUI"
import {applyType, FILL_ALPHA, ink, setTextAlpha, STROKE_ALPHA, UI_WHITE} from "./CutawayStyle"
import {faceToward, Pop, Spring} from "./CutawayTween"

export type HeroRailMode = "none" | "apart" | "viewfinder" | "light"

export interface HeroRailVisual {
  apart: boolean
  focus: boolean
  putBack: boolean
  photo: boolean
}

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
}

interface Pill {
  pop: Pop
  so: SceneObject
  btn: Button
  glow: CapsuleGlow | null
  label: Text
  masked: boolean
}

/**
 * The camera hero stage's control rail: a small strip beside the replica, on the user's side.
 * It shows only what the current step needs: the "Take apart" slider, then the "Focus" slider
 * and "Take a photo", with "Put it back" throughout. UI Kit sliders and buttons do the input;
 * their own visuals are masked and everything is drawn with light like the chips (hairline
 * strokes, 85% white text). Built at the 110 cm design scale and scaled with distance, so the
 * pinch targets keep a constant apparent size. CutawayMain / CutawayHero place it every frame.
 */
@component
export class CutawayHeroUI extends BaseScriptComponent {
  @ui.label("Cutaway — camera hero control rail (Take apart / Focus / Take a photo / Put it back)")
  @ui.separator
  @ui.group_start("Style (matches the chips)")
  @input
  @hint("Additive glow material for strokes (the one the chips use)")
  glowMaterial: Material

  @input
  @hint("Slider track width at the design scale (cm)")
  @widget(new SliderWidget(10, 24, 0.5))
  sliderWidth: number = 16

  @input
  @hint("Row height at the design scale (cm): slider knob and pill height")
  @widget(new SliderWidget(2.4, 5, 0.1))
  rowHeight: number = 3.2

  @input
  @hint("Distance (cm) at which the rail is shown 1:1, as for the chips")
  @widget(new SliderWidget(60, 200, 5))
  designDistance: number = 110
  @ui.group_end

  @ui.group_start("Labels")
  @input
  @hint("Label above the take-apart slider")
  apartLabel: string = "Take apart"

  @input
  @hint("Label above the focus slider")
  focusLabel: string = "Focus"

  @input
  @hint("The stop pill for this stage")
  putBackLabel: string = "Put it back"

  @input
  @hint("The shutter button")
  photoLabel: string = "Take a photo"
  @ui.group_end

  readonly onPutBack = new Event<void>()
  readonly onPhoto = new Event<void>()
  /** Fired on every pinch of a rail control (world position), for the tick sound. */
  readonly onPinch = new Event<vec3>()

  private panel: SceneObject
  private apart: LightSlider
  private focus: LightSlider
  private putBack: Pill
  private photo: Pill
  private putBackX: Spring
  /** The take-apart slider's row: level with Focus until the light path, then above it. */
  private apartY: Spring
  private mode: HeroRailMode = "none"
  private camTransform: Transform | null = null
  private firstFrame = true

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.panel = this.child(this.sceneObject, "HeroRailPanel")
    this.apart = this.buildSlider("HeroApartSlider", this.apartLabel)
    this.focus = this.buildSlider("HeroFocusSlider", this.focusLabel)
    const pillY = -(this.rowHeight + 1.6)
    this.putBack = this.buildPill("HeroPutBack", this.putBackLabel, 10.5)
    this.photo = this.buildPill("HeroPhoto", this.photoLabel, 11)
    this.putBackX = new Spring(420, 0.9, 0)
    this.apartY = new Spring(420, 0.9, 0)
    this.putBack.pop.so.getTransform().setLocalPosition(new vec3(0, pillY, 0))
    this.photo.pop.so.getTransform().setLocalPosition(new vec3(6, pillY, 0))
    this.putBack.btn.onTriggerUp.add(() => {
      if (this.putBack.pop.isShown) this.onPutBack.invoke()
    })
    this.photo.btn.onTriggerUp.add(() => {
      if (this.photo.pop.isShown) this.onPhoto.invoke()
    })
    this.createEvent("OnStartEvent").bind(() => {
      this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ---------------- Public API ----------------

  /** Show only the controls this step needs. `instant` skips the animation (Reset). */
  setMode(mode: HeroRailMode, instant: boolean = false): void {
    this.mode = mode
    // "Take apart" stays through the light path (dragging it back reverses everything); once
    // "Focus" appears it moves up a row to make room.
    this.apart.pop.show(mode !== "none", instant)
    this.focus.pop.show(mode === "light", instant)
    this.putBack.pop.show(mode !== "none", instant)
    this.photo.pop.show(mode === "light", instant)
    // "Put it back" sits centred alone, and moves left to make room for "Take a photo".
    this.putBackX.target = mode === "light" ? -6 : 0
    this.apartY.target = mode === "light" ? this.rowHeight + 3 : 0
    if (instant) {
      this.putBackX.snap(this.putBackX.target)
      this.apartY.snap(this.apartY.target)
    }
  }

  getMode(): HeroRailMode {
    return this.mode
  }

  /** Take-apart value 0..1 (follows the knob while it is dragged). */
  getApartValue(): number {
    return this.apart.slider.knobValue
  }

  setApartValue(v: number): void {
    this.apart.slider.resetToValue(Math.max(0, Math.min(1, v)))
  }

  getFocusValue(): number {
    return this.focus.slider.knobValue
  }

  setFocusValue(v: number): void {
    this.focus.slider.resetToValue(Math.max(0, Math.min(1, v)))
  }

  isDragging(): boolean {
    return (this.apart.slider as unknown as {_isDragged?: boolean})._isDragged === true || (this.focus.slider as unknown as {_isDragged?: boolean})._isDragged === true
  }

  getVisual(): HeroRailVisual {
    return {apart: this.apart.pop.isShown, focus: this.focus.pop.isShown, putBack: this.putBack.pop.isShown, photo: this.photo.pop.isShown}
  }

  /** True while any part of the rail is still on screen (including its exit animation). */
  isVisible(): boolean {
    return [this.apart.pop, this.focus.pop, this.putBack.pop, this.photo.pop].some((p) => p.so.enabled)
  }

  /** Place the rail at `p` (world), facing the viewer, scaled to keep its apparent size. */
  place(p: vec3): void {
    const tr = this.sceneObject.getTransform()
    tr.setWorldPosition(p)
    if (!this.camTransform) return
    const cam = this.camTransform.getWorldPosition()
    tr.setWorldRotation(faceToward(cam.sub(p), this.camTransform.up))
    const s = Math.min(6, Math.max(0.3, p.distance(cam) / this.designDistance))
    this.panel.getTransform().setLocalScale(vec3.one().uniformScale(s))
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

  /** A UI Kit slider whose track, fill and knob are drawn with light (transforms only move). */
  private buildSlider(name: string, labelText: string): LightSlider {
    const wrap = this.child(this.panel, name + "Pop")
    const so = this.child(wrap, name)
    const slider = so.createComponent(Slider.getTypeName()) as Slider
    slider.size = new vec3(this.sliderWidth, this.rowHeight, 1)
    slider.knobSize = new vec2(this.rowHeight, this.rowHeight)
    const track = this.sliderWidth - this.rowHeight
    const label = this.text(wrap, labelText, HorizontalAlignment.Left, Rect.create(-track / 2, track / 2 + 4, -1.2, 1.2))
    label.getSceneObject().getTransform().setLocalPosition(new vec3(0, this.rowHeight * 0.5 + 1.5, 0.08))

    const trackMat = this.glowMaterial.clone()
    const tk = new MeshKit()
    tk.addRectXY(-track / 2, -0.045, track / 2, 0.045, ink(UI_WHITE, STROKE_ALPHA))
    // End ticks so the track's range reads.
    tk.addRectXY(-track / 2 - 0.045, -0.35, -track / 2 + 0.045, 0.35, ink(UI_WHITE, STROKE_ALPHA))
    tk.addRectXY(track / 2 - 0.045, -0.35, track / 2 + 0.045, 0.35, ink(UI_WHITE, STROKE_ALPHA))
    spawnMesh(so, name + "Track", tk.build(), this.glowMaterial, new vec3(0, 0, 0.02), trackMat)
    const fill = new UnitLine(so, name + "Fill", this.glowMaterial, 0.22, ink(UI_WHITE, 0.85), 0, trackMat)
    fill.so.getTransform().setLocalPosition(new vec3(-track / 2, 0, 0.03))

    const knob = this.child(so, name + "Knob")
    const kk = new MeshKit()
    const r = this.rowHeight * 0.36
    kk.addArcXY(0, 0, r, 0.13, 0, Math.PI * 2, ink(UI_WHITE, 0.9), 40)
    kk.addFanXY(0, 0, r - 0.07, 0, Math.PI * 2, ink(UI_WHITE, 0.16), ink(UI_WHITE, FILL_ALPHA), 40)
    const knobMat = this.glowMaterial.clone()
    spawnMesh(knob, name + "KnobRing", kk.build(), this.glowMaterial, new vec3(0, 0, 0.04), knobMat)

    const hover = new Spring(900, 1, 1)
    slider.onHoverEnter.add(() => (hover.target = 1.5))
    slider.onHoverExit.add(() => (hover.target = 1))
    slider.onTriggerDown.add(() => this.onPinch.invoke(knob.getTransform().getWorldPosition()))

    const ls: LightSlider = {pop: undefined as unknown as Pop, slider, label, knob, knobMat, fill, trackMat, masked: false, hover}
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
    btn.size = new vec3(width, this.rowHeight, 1)
    const glow = this.glowMaterial ? new CapsuleGlow(so, name + "Glow", this.glowMaterial, this.rowHeight) : null
    if (glow) glow.setShape(width, this.rowHeight)
    const hw = width / 2 - 0.3
    const label = this.text(so, labelText, HorizontalAlignment.Center, Rect.create(-hw, hw, -1.2, 1.2))
    const pop = new Pop(wrap, vec3.one(), false, {
      minScale: 0.85,
      onAmount: (a) => {
        if (glow) glow.setOpacity(a)
        setTextAlpha(label, a)
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
    if (!s.pop.so.enabled) return
    s.hover.update(dt)
    const track = this.sliderWidth - this.rowHeight
    const x = (s.slider.knobValue - 0.5) * track
    s.knob.getTransform().setLocalPosition(new vec3(x, 0, 0))
    s.fill.set(new vec3(-track / 2, 0, 0.03), new vec3(Math.max(-track / 2 + 1e-3, x), 0, 0.03))
    setFade(s.knobMat, s.pop.amount * s.hover.value)
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    if (this.firstFrame) {
      this.firstFrame = false
      this.setMode(this.mode, true)
    }
    this.updateSlider(this.apart, dt)
    this.updateSlider(this.focus, dt)
    for (const p of [this.putBack, this.photo]) {
      if (!p.masked) this.maskPill(p)
      p.pop.update(dt)
      if (p.glow && p.so.isEnabledInHierarchy) p.glow.update(dt)
    }
    const x = this.putBackX.update(dt)
    const ptr = this.putBack.pop.so.getTransform()
    const lp = ptr.getLocalPosition()
    ptr.setLocalPosition(new vec3(x, lp.y, lp.z))
    this.apart.pop.so.getTransform().setLocalPosition(new vec3(0, this.apartY.update(dt), 0))
  }
}
