/**
 * The rail (polish-pass.md): one glass column on the user's side of the copy, on the spacing grid.
 * Top to bottom: the caption's slot, sliders (label left, value right), the primary pill, the
 * secondary pill. A hairline leader joins its top to the copy. Sliders are instruments: a hairline
 * track whose filled part glows in the colour of the energy it controls, a small glass knob with a
 * halo in that colour, and a live value in real units. UI Kit does the input; its visuals are masked
 * and everything is drawn with light. Each stage's rail (CutawayHeroUI, CutawayRpRail,
 * CutawayLampRail) is a thin wrapper that names the rows and keeps its own public API.
 *
 * The rail stays fully inside the view: place() pulls it in from where the stage wants it, keeping
 * its depth and so its apparent size. It stays put while a slider is held.
 */
import {Slider} from "SpectaclesUIKit.lspkg/Scripts/Components/Slider/Slider"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {MeshKit, setLevel, setTint, spawnMesh, UnitLine} from "./CutawayGeometry"
import {ALPHA, applyType, GLASS, HOVER, INK, lit, NO_LIGHT, PRESS, RAIL, setTextAlpha, STROKE, VERTEX_WHITE} from "./CutawayStyle"
import {clamp01, Fader, faceToward, Pop, Spring} from "./CutawayTween"
import {GlassCapsule, gradientArc, PillKind, PressRing, UiPill} from "./CutawayUiKit"

const T = RAIL.column
const PLATE_W = RAIL.column + 2 * RAIL.padding
/** The track's height inside a slider row (the label line sits above it). */
const TRACK_Y = -RAIL.sliderRow / 4
const LABEL_Y = RAIL.sliderRow / 4
const LABEL_RECT_H = 1.2
const VALUE_GAP = 0.6
/** Inside the view by this share of its half-size. */
const VIEW_X = 0.96
const VIEW_Y = 0.9
/** Farther from the middle of the view than this, the rail stays where the stage wants it. */
const MAX_FOLLOW_COS = Math.cos((70 * Math.PI) / 180)
const FOLLOW_S = 0.12
const TICK_MIN_APART = 0.022
const DESIGN_D = 110

export interface SliderSpec {
  name: string
  label: string
  /** The energy it controls: the fill's and the knob halo's colour. */
  fill: vec4
  /** Colour along the track (slider value 0..1): the whole track is drawn in it (Warmth). */
  gradient?: (v: number) => vec4
  /** The live value with units. Without it, setReadout says what shows. */
  format?: (v: number) => string
}

export interface SliderTick {
  at: number
  freed: boolean
}

function makeText(parent: SceneObject, name: string, value: string, align: HorizontalAlignment, rect: Rect, pos: vec3): Text {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  so.getTransform().setLocalPosition(pos)
  const t = so.createComponent("Component.Text") as Text
  t.text = value
  t.depthTest = true
  applyType(t, "note")
  setTextAlpha(t, 0)
  t.horizontalAlignment = align
  t.verticalAlignment = VerticalAlignment.Center
  t.horizontalOverflow = HorizontalOverflow.Overflow
  t.verticalOverflow = VerticalOverflow.Overflow
  t.layoutRect = rect
  return t
}

function textWidth(t: Text): number {
  try {
    const r = t.getBoundingBox()
    if (r.right > r.left) return r.right - r.left
  } catch (e) {
    // no glyph bounds yet: estimate below
  }
  return t.text.length * 0.55
}

/** One slider row: name and live value on the label line, the track and knob below. */
export class InstrumentSlider {
  readonly pop: Pop
  readonly wrap: SceneObject
  readonly so: SceneObject
  readonly slider: Slider
  readonly fillColor: vec4
  readonly height = RAIL.sliderRow
  /** Text child named "Label": never drawn, the slider's words and value as one string. */
  private words: Text
  private nameText: Text
  private valueText: Text
  private nameW = -1
  private valueW = 0
  private readout = ""
  private measured = ""
  private knob: SceneObject
  private glass: GlassCapsule
  private haloMat: Material
  private trackMat: Material
  private fill: UnitLine | null = null
  private ring: PressRing
  private hover = new Spring(HOVER.stiffness, 1, 1)
  private press = new Spring(900, 1, 1)
  private stops: vec4[] | null = null
  private masked = false
  private amount = 0
  private dim = 1
  private dimTarget = 1
  private ticks: {at: number; x: number; freed: boolean; so: SceneObject}[] = []
  private tickMat: Material | null = null
  private dimTicks: SceneObject | null = null

  constructor(parent: SceneObject, private spec: SliderSpec, private material: Material) {
    this.fillColor = spec.fill
    this.wrap = global.scene.createSceneObject(spec.name + "Pop")
    this.wrap.setParent(parent)
    this.so = global.scene.createSceneObject(spec.name)
    this.so.setParent(this.wrap)
    this.so.getTransform().setLocalPosition(new vec3(0, TRACK_Y, 0))
    this.slider = this.so.createComponent(Slider.getTypeName()) as Slider
    this.slider.size = new vec3(T + RAIL.knobHit, RAIL.knobHit, 1)
    this.slider.knobSize = new vec2(RAIL.knobHit, RAIL.knobHit)

    this.nameText = makeText(this.wrap, "SliderName", spec.label, HorizontalAlignment.Left, Rect.create(0, T, -LABEL_RECT_H, LABEL_RECT_H), new vec3(-T / 2, LABEL_Y, 0.08))
    this.valueText = makeText(this.wrap, "SliderValue", "", HorizontalAlignment.Center, Rect.create(-T / 2, T / 2, -LABEL_RECT_H, LABEL_RECT_H), new vec3(0, LABEL_Y, 0.08))
    this.words = makeText(this.wrap, "Label", spec.label, HorizontalAlignment.Left, Rect.create(0, T, -LABEL_RECT_H, LABEL_RECT_H), new vec3(-T / 2, LABEL_Y, 0.08))
    this.words.enabled = false

    this.trackMat = material.clone()
    const hw = STROKE.hairline / 2
    const tk = new MeshKit()
    tk.addRectXY(-T / 2, -hw, T / 2, hw, lit(INK, ALPHA.hairline))
    spawnMesh(this.so, spec.name + "Track", tk.build(), material, new vec3(0, 0, 0.02), this.trackMat)
    if (spec.gradient) this.buildGradient(spec.gradient)
    else {
      this.fill = new UnitLine(this.so, spec.name + "Fill", material, RAIL.fillWidth, lit(spec.fill, 0.95), 0, this.trackMat)
      this.fill.so.getTransform().setLocalPosition(new vec3(-T / 2, 0, 0.03))
    }

    this.knob = global.scene.createSceneObject(spec.name + "Knob")
    this.knob.setParent(this.so)
    const r = RAIL.knobRadius
    this.haloMat = material.clone()
    const hk = new MeshKit()
    hk.addSoftRingXY(0, 0, r, r + RAIL.knobHaloSpread, lit(VERTEX_WHITE, 1), NO_LIGHT, 32)
    spawnMesh(this.knob, spec.name + "KnobHalo", hk.build(), material, new vec3(0, 0, 0.03), this.haloMat)
    this.glass = new GlassCapsule(this.knob, spec.name + "KnobGlass", material, 2 * r, "glass")
    this.glass.setShape(2 * r, 2 * r)
    this.ring = new PressRing(this.so, spec.name + "PressRing", material, 2 * r, 2 * r)

    this.slider.onHoverEnter.add(() => this.setHover(true))
    this.slider.onHoverExit.add(() => {
      this.press.target = 1
      this.setHover(false)
    })
    this.slider.onTriggerUp.add(() => (this.press.target = 1))
    this.pop = new Pop(this.wrap, vec3.one(), false, {onAmount: (a) => (this.amount = a)})
  }

  /** Called on every pinch of the knob, with its world position (for the tick). */
  bindPinch(cb: (p: vec3) => void): void {
    this.slider.onTriggerDown.add(() => {
      this.press.target = PRESS.scale
      this.ring.play(this.knob.getTransform().getLocalPosition(), vec3.one())
      cb(this.knob.getTransform().getWorldPosition())
    })
  }

  get value(): number {
    return this.slider.knobValue
  }

  set value(v: number) {
    this.slider.resetToValue(clamp01(v))
  }

  get isDragged(): boolean {
    return (this.slider as unknown as {_isDragged?: boolean})._isDragged === true
  }

  /** "Warmth  3000 K": the words stay whole for whoever asks, the part after the name is the value. */
  setWords(text: string): void {
    if (this.words.text !== text) this.words.text = text
    const i = text.indexOf("  ")
    if (i >= 0) this.setReadout(text.substring(i + 2))
  }

  getWords(): string {
    return this.words.text
  }

  /** The live value above the knob, e.g. "L 22.4 cm". */
  setReadout(text: string): void {
    this.readout = text
  }

  getReadout(): string {
    return this.readout
  }

  /** Disabled: 35% alpha. The look only: what the slider does stays with the owner. */
  setDisabled(v: boolean): void {
    this.dimTarget = v ? ALPHA.disabled : 1
  }

  /** The track's colour at slider value v (Warmth). Interpolates the same stops as its mesh. */
  trackColorAt(v: number): vec4 {
    if (!this.stops) return this.fillColor
    const n = this.stops.length - 1
    const x = clamp01(v) * n
    const i = Math.min(n - 1, Math.floor(x))
    return vec4.lerp(this.stops[i], this.stops[i + 1], x - i)
  }

  /** Where each part frees itself and whether it has. One small tick per part. */
  syncTicks(list: SliderTick[]): void {
    if (list.length !== this.ticks.length) this.buildTicks(list)
    for (let i = 0; i < list.length; i++) {
      const t = this.ticks[i]
      if (t.freed !== list[i].freed) {
        t.freed = list[i].freed
        t.so.enabled = t.freed
      }
    }
  }

  getTicks(): SliderTick[] {
    return this.ticks.map((t) => ({at: t.at, freed: t.freed}))
  }

  /** Whether the tick's light is really on (LEAF checks). */
  tickShows(i: number): boolean {
    return this.ticks[i].so.enabled
  }

  update(dt: number): void {
    if (!this.masked) this.mask()
    this.ring.update(dt)
    this.pop.update(dt)
    if (!this.pop.so.enabled) return
    this.hover.update(dt)
    this.press.update(dt)
    this.dim += (this.dimTarget - this.dim) * (1 - Math.exp(-dt / 0.05))
    const a = this.amount * this.dim
    const v = this.value
    const x = (v - 0.5) * T
    const kt = this.knob.getTransform()
    kt.setLocalPosition(new vec3(x, 0, 0))
    const s = this.hover.value * this.press.value
    kt.setLocalScale(new vec3(s, s, 1))
    if (this.fill) this.fill.set(new vec3(-T / 2, 0, 0.03), new vec3(Math.max(-T / 2 + 1e-3, x), 0, 0.03))
    setLevel(this.trackMat, a)
    if (this.tickMat) setLevel(this.tickMat, a)
    setTint(this.haloMat, this.spec.gradient ? this.trackColorAt(v) : this.fillColor, RAIL.knobHaloLevel * a)
    this.glass.setOpacity(a)
    this.glass.update(dt)
    if (this.spec.format) this.readout = this.spec.format(v)
    this.updateTexts(x, a)
  }

  private setHover(h: boolean): void {
    this.hover.target = h ? HOVER.scale : 1
    this.glass.setHover(h)
  }

  private updateTexts(knobX: number, a: number): void {
    const base = ALPHA.secondary + (1 - ALPHA.secondary) * this.glass.hoverAmount
    setTextAlpha(this.nameText, a, base)
    setTextAlpha(this.valueText, a, base)
    if (this.valueText.text !== this.readout) this.valueText.text = this.readout
    if (!this.readout) return
    if (this.nameW < 0) this.nameW = textWidth(this.nameText)
    if (this.measured !== this.readout) {
      this.measured = this.readout
      this.valueW = textWidth(this.valueText)
    }
    // Above the knob, but never over the name: label left, value right.
    const lo = -T / 2 + this.nameW + VALUE_GAP + this.valueW / 2
    const hi = T / 2 - this.valueW / 2
    const vx = lo < hi ? Math.max(lo, Math.min(hi, knobX)) : hi
    this.valueText.getSceneObject().getTransform().setLocalPosition(new vec3(vx, LABEL_Y, 0.08))
  }

  private buildGradient(g: (v: number) => vec4): void {
    const N = 24
    const c = RAIL.fillWidth / 2
    const h = 0.35
    const k = new MeshKit()
    const nz = new vec3(0, 0, 1)
    this.stops = []
    let base = -1
    for (let i = 0; i <= N; i++) {
      const v = i / N
      const x = -T / 2 + T * v
      const col = g(v)
      this.stops.push(col)
      const ink = lit(col, 0.95)
      const a = k.vert(new vec3(x, h, 0), nz, NO_LIGHT)
      if (base < 0) base = a
      k.vert(new vec3(x, c, 0), nz, ink)
      k.vert(new vec3(x, -c, 0), nz, ink)
      k.vert(new vec3(x, -h, 0), nz, NO_LIGHT)
    }
    for (let i = 0; i < N; i++) {
      const p = base + i * 4
      for (let j = 0; j < 3; j++) {
        k.tri(p + j, p + j + 5, p + j + 1)
        k.tri(p + j, p + j + 4, p + j + 5)
      }
    }
    spawnMesh(this.so, this.spec.name + "Gradient", k.build(), this.material, new vec3(0, 0, 0.03), this.trackMat)
  }

  private buildTicks(list: SliderTick[]): void {
    for (const t of this.ticks) t.so.destroy()
    if (this.dimTicks) this.dimTicks.destroy()
    // Parts that free at the same moment keep a tick each: nudged apart along the track.
    const order = list.map((t, i) => ({at: t.at, i})).sort((a, b) => a.at - b.at)
    const xs: number[] = new Array(list.length)
    let last = -1
    for (const o of order) {
      const v = Math.max(o.at, last + TICK_MIN_APART)
      last = v
      xs[o.i] = (Math.min(1, v) - 0.5) * T
    }
    const hw = STROKE.hairline / 2
    const hh = RAIL.tickHeight / 2
    if (!this.tickMat) this.tickMat = this.material.clone()
    const dim = new MeshKit()
    const on = new MeshKit()
    on.addRectXY(-hw, -hh, hw, hh, lit(INK, ALPHA.text))
    const onMesh = on.build()
    this.ticks = list.map((t, i) => {
      dim.addRectXY(xs[i] - hw, -hh, xs[i] + hw, hh, lit(INK, ALPHA.hairline))
      const so = spawnMesh(this.so, this.spec.name + "Tick" + i, onMesh, this.material, new vec3(xs[i], 0, 0.035), this.tickMat).so
      so.enabled = false
      return {at: t.at, x: xs[i], freed: false, so}
    })
    this.dimTicks = spawnMesh(this.so, this.spec.name + "Ticks", dim.build(), this.material, new vec3(0, 0, 0.025), this.tickMat).so
  }

  private mask(): void {
    const vs = [this.slider.visual, this.slider.knobVisual, this.slider.trackFillVisual]
    if (vs.some((v) => !v || !v.renderMeshVisual)) return
    for (const v of vs) v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
    this.masked = true
  }
}

type RailRow = InstrumentSlider | UiPill

interface RowSlot {
  row: RailRow
  y: Spring
  height: number
}

/** The plate: top, stretching middle and bottom, so its height changes by transforms alone. */
function buildPlate(parent: SceneObject, name: string, material: Material, mat: Material): {top: SceneObject; mid: SceneObject; bottom: SceneObject} {
  const W = PLATE_W
  const R = RAIL.corner
  const S = STROKE.rim
  const H = STROKE.highlight
  const inner = W / 2 - R
  const rim = lit(INK, GLASS.rim)
  const hi = lit(INK, GLASS.highlight)
  const fill = lit(INK, GLASS.fill)
  const top = new MeshKit()
  top.addArcXY(-inner, 0, R - S / 2, S, Math.PI / 2, Math.PI, rim, 12)
  top.addArcXY(inner, 0, R - S / 2, S, 0, Math.PI / 2, rim, 12)
  top.addFanXY(-inner, 0, R - S, Math.PI / 2, Math.PI, fill, fill, 12)
  top.addFanXY(inner, 0, R - S, 0, Math.PI / 2, fill, fill, 12)
  top.addRectXY(-inner, R - S, inner, R, rim)
  top.addRectXY(-inner, R - S - H, inner, R - S, hi)
  top.addRectXY(-inner, 0, inner, R - S - H, fill)
  gradientArc(top, R - S - H / 2, H, Math.PI / 2, Math.PI / 2 + 1.1, hi, NO_LIGHT, 8, -inner, 0)
  gradientArc(top, R - S - H / 2, H, Math.PI / 2, Math.PI / 2 - 1.1, hi, NO_LIGHT, 8, inner, 0)
  const mid = new MeshKit()
  mid.addRectXY(-W / 2, -0.5, -W / 2 + S, 0.5, rim)
  mid.addRectXY(W / 2 - S, -0.5, W / 2, 0.5, rim)
  mid.addRectXY(-W / 2 + S, -0.5, W / 2 - S, 0.5, fill)
  const bottom = new MeshKit()
  bottom.addArcXY(-inner, 0, R - S / 2, S, Math.PI, 1.5 * Math.PI, rim, 12)
  bottom.addArcXY(inner, 0, R - S / 2, S, 1.5 * Math.PI, 2 * Math.PI, rim, 12)
  bottom.addFanXY(-inner, 0, R - S, Math.PI, 1.5 * Math.PI, fill, fill, 12)
  bottom.addFanXY(inner, 0, R - S, 1.5 * Math.PI, 2 * Math.PI, fill, fill, 12)
  bottom.addRectXY(-inner, -R, inner, -R + S, rim)
  bottom.addRectXY(-inner, -R + S, inner, 0, fill)
  return {
    top: spawnMesh(parent, name + "PlateTop", top.build(), material, undefined, mat).so,
    mid: spawnMesh(parent, name + "PlateMid", mid.build(), material, undefined, mat).so,
    bottom: spawnMesh(parent, name + "PlateBottom", bottom.build(), material, undefined, mat).so
  }
}

/** The column: plate, leader, rows and where it all stands. */
export class RailColumn {
  readonly panel: SceneObject
  /** Fired on every pinch of a control (world position), for the tick sound. */
  onPinch: ((p: vec3) => void) | null = null
  private slots: RowSlot[] = []
  private layouts: {[name: string]: RailRow[]} = {}
  private current = "none"
  private plate: {top: SceneObject; mid: SceneObject; bottom: SceneObject}
  private plateMat: Material
  private plateFade = new Fader(false)
  private topY = new Spring(420, 0.9, RAIL.bottom + 2 * RAIL.corner)
  private leader: UnitLine
  private leaderMat: Material
  private leaderOn = false
  private camTransform: Transform | null = null
  private camera: Camera | null = null
  private tan: {h: number; v: number} | null = null
  private cur: vec3 | null = null
  private offset = vec3.zero()
  private wasVisible = false

  constructor(private root: SceneObject, panelName: string, private material: Material) {
    this.panel = global.scene.createSceneObject(panelName)
    this.panel.setParent(root)
    this.plateMat = material.clone()
    setLevel(this.plateMat, 0)
    this.plate = buildPlate(this.panel, panelName, material, this.plateMat)
    this.leaderMat = material.clone()
    setLevel(this.leaderMat, 0)
    const hw = STROKE.hairline / 2
    const lk = new MeshKit()
    lk.addRectXY(0, -hw, 1, hw, lit(INK, ALPHA.hairline))
    this.leader = new UnitLine(this.panel, panelName + "Leader", material, 0, NO_LIGHT, 0, this.leaderMat, lk)
    this.applyPlate()
    this.setPlateEnabled(false)
  }

  addSlider(spec: SliderSpec): InstrumentSlider {
    const s = new InstrumentSlider(this.panel, spec, this.material)
    s.bindPinch((p) => {
      if (this.onPinch) this.onPinch(p)
    })
    this.slots.push({row: s, y: new Spring(420, 0.9, 0), height: s.height})
    return s
  }

  addPill(name: string, label: string, kind: PillKind): UiPill {
    const pill = new UiPill({parent: this.panel, name, label, width: RAIL.column, height: RAIL.pillHeight, material: this.material, kind, minScale: 0.85})
    pill.onPinch = (p) => {
      if (this.onPinch) this.onPinch(p)
    }
    this.slots.push({row: pill, y: new Spring(420, 0.9, 0), height: RAIL.pillHeight})
    return pill
  }

  /** The rows of one step, top to bottom (below the caption's slot). */
  defineLayout(name: string, rows: RailRow[]): void {
    this.layouts[name] = rows
  }

  /** Show one step's rows ("none" hides everything). `instant` skips the animation. */
  setLayout(name: string, instant: boolean = false): void {
    this.current = name
    const rows = this.layouts[name] ?? []
    let y = RAIL.bottom + RAIL.padding
    for (let i = rows.length - 1; i >= 0; i--) {
      const slot = this.slots.find((s) => s.row === rows[i])
      const target = y + slot.height / 2
      slot.y.target = target
      if (instant || !slot.row.pop.so.enabled) slot.y.snap(target)
      y += slot.height + RAIL.gap
    }
    for (const s of this.slots) s.row.pop.show(rows.indexOf(s.row) >= 0, instant)
    const shown = rows.length > 0
    this.topY.target = shown ? this.topOf(name) : this.topY.target
    if (instant || !this.plateFade.isShown) this.topY.snap(this.topY.target)
    this.plateFade.show(shown, instant)
    if (shown) this.setPlateEnabled(true)
    else if (instant) this.setPlateEnabled(false)
    this.applyPlate()
  }

  getLayout(): string {
    return this.current
  }

  /** The top of the plate in a step's layout (design units, in the rail's own space). */
  topOf(name: string): number {
    const rows = this.layouts[name] ?? []
    let y = RAIL.bottom + RAIL.padding
    for (const r of rows) y += this.slots.find((s) => s.row === r).height + RAIL.gap
    return y + RAIL.captionSlot + RAIL.padding
  }

  /** The plate's outline in the rail's own space, for a step (design units). */
  extent(name: string): {x0: number; x1: number; y0: number; y1: number} {
    return {x0: -PLATE_W / 2, x1: PLATE_W / 2, y0: RAIL.bottom, y1: this.topOf(name)}
  }

  private tallest(): number {
    let t = RAIL.bottom + 2 * RAIL.corner
    for (const n of Object.keys(this.layouts)) t = Math.max(t, this.topOf(n))
    return t
  }

  /** True while any part of the rail is still on screen (including its exit animation). */
  isVisible(): boolean {
    return this.slots.some((s) => s.row.pop.so.enabled) || this.plate.top.enabled
  }

  isDragging(): boolean {
    return this.slots.some((s) => s.row instanceof InstrumentSlider && s.row.isDragged)
  }

  /**
   * Put the rail where the stage wants it (`p`, world), pulled inside the view, facing the viewer at
   * a constant apparent size. With `target`, the leader runs to it, stopping `radius` cm short.
   */
  place(p: vec3, target?: vec3, radius: number = 0): void {
    const tr = this.root.getTransform()
    if (!this.findCamera()) {
      tr.setWorldPosition(p)
      return
    }
    const want = this.clampToView(p)
    if (!this.cur || !this.wasVisible) this.cur = want
    else if (this.isDragging()) this.cur = p.add(this.offset)
    else this.cur = vec3.lerp(this.cur, want, 1 - Math.exp(-Math.max(0, getDeltaTime()) / FOLLOW_S))
    this.offset = this.cur.sub(p)
    this.wasVisible = this.isVisible()
    tr.setWorldPosition(this.cur)
    const cam = this.camTransform.getWorldPosition()
    tr.setWorldRotation(faceToward(cam.sub(this.cur), this.camTransform.up))
    this.panel.getTransform().setLocalScale(vec3.one().uniformScale(RailColumn.scaleAt(this.cur, cam)))
    this.placeLeader(target, radius)
  }

  /** Where the rail really stands (world). */
  getPlaced(): vec3 {
    return this.root.getTransform().getWorldPosition()
  }

  /** The rail's scale at `p` seen from `cam`: it keeps its apparent size. */
  static scaleAt(p: vec3, cam: vec3): number {
    return Math.min(6, Math.max(0.3, p.distance(cam) / DESIGN_D))
  }

  /** The top centre of the caption's slot (world), for a rail wanted at `p`, in a step's layout. */
  captionPoint(p: vec3, layout: string): vec3 {
    if (!this.findCamera()) return p
    const at = this.clampToView(p)
    const cam = this.camTransform.getWorldPosition()
    const k = RailColumn.scaleAt(at, cam)
    const up = faceToward(cam.sub(at), this.camTransform.up).multiplyVec3(vec3.up())
    return at.add(up.uniformScale(k * (this.topOf(layout) - RAIL.padding)))
  }

  /** The plate's four world corners as laid out for the current step (U4). */
  getCorners(): vec3[] {
    const m = this.panel.getTransform().getWorldTransform()
    const e = this.extent(this.current)
    return [new vec3(e.x0, e.y0, 0), new vec3(e.x1, e.y0, 0), new vec3(e.x1, e.y1, 0), new vec3(e.x0, e.y1, 0)].map((q) => m.multiplyPoint(q))
  }

  /** The rail's outline as one world box (8 corners), for layout checks. Empty when hidden. */
  getBoxes(): vec3[][] {
    if (!this.isVisible()) return []
    const m = this.panel.getTransform().getWorldTransform()
    const top = this.topY.value
    const c: vec3[] = []
    for (const x of [-PLATE_W / 2, PLATE_W / 2]) for (const y of [RAIL.bottom, top]) for (const z of [0, 0.1]) c.push(m.multiplyPoint(new vec3(x, y, z)))
    return [c]
  }

  update(dt: number): void {
    for (const s of this.slots) {
      s.row.update(dt)
      if (s.row.pop.so.enabled) s.row.pop.so.getTransform().setLocalPosition(new vec3(0, s.y.update(dt), 0))
    }
    this.topY.update(dt)
    const a = this.plateFade.update(dt)
    if (this.plate.top.enabled) {
      setLevel(this.plateMat, a)
      setLevel(this.leaderMat, this.leaderOn ? a : 0)
      this.applyPlate()
      if (!this.plateFade.isShown && !this.plateFade.isAnimating) this.setPlateEnabled(false)
    }
  }

  private setPlateEnabled(v: boolean): void {
    this.plate.top.enabled = v
    this.plate.mid.enabled = v
    this.plate.bottom.enabled = v
    this.leader.so.enabled = v && this.leaderOn
  }

  private applyPlate(): void {
    const top = this.topY.value
    const R = RAIL.corner
    this.plate.top.getTransform().setLocalPosition(new vec3(0, top - R, 0))
    this.plate.bottom.getTransform().setLocalPosition(new vec3(0, RAIL.bottom + R, 0))
    const mt = this.plate.mid.getTransform()
    mt.setLocalPosition(new vec3(0, (top + RAIL.bottom) / 2, 0))
    mt.setLocalScale(new vec3(1, Math.max(1e-3, top - RAIL.bottom - 2 * R), 1))
  }

  private findCamera(): boolean {
    if (this.camTransform && this.camera) return true
    try {
      const provider = WorldCameraFinderProvider.getInstance()
      this.camTransform = provider.getTransform()
      this.camera = provider.getComponent()
    } catch (e) {
      this.camTransform = null
      this.camera = null
    }
    return !!this.camTransform && !!this.camera
  }

  /** The view's half-size as tangents, from where the camera really projects. */
  private viewTangents(): {h: number; v: number} {
    if (this.tan) return this.tan
    const cam = this.camTransform.getWorldPosition()
    const look = this.camTransform.forward.uniformScale(-1)
    const q = cam.add(look.uniformScale(100))
    const ux = this.camera.worldSpaceToScreenSpace(q.add(this.camTransform.right.uniformScale(20)))
    const uy = this.camera.worldSpaceToScreenSpace(q.add(this.camTransform.up.uniformScale(20)))
    const c = this.camera.worldSpaceToScreenSpace(q)
    this.tan = {h: 0.1 / Math.max(1e-3, Math.abs(ux.x - c.x)), v: 0.1 / Math.max(1e-3, Math.abs(uy.y - c.y))}
    return this.tan
  }

  /** `p`, moved at the same depth until the rail's tallest layout fits inside the view. */
  private clampToView(p: vec3): vec3 {
    const cam = this.camTransform.getWorldPosition()
    const look = this.camTransform.forward.uniformScale(-1)
    const right = this.camTransform.right
    const up = this.camTransform.up
    const v = p.sub(cam)
    const z = v.dot(look)
    if (z <= 1 || z / Math.max(1e-3, v.length) < MAX_FOLLOW_COS) return p
    const tan = this.viewTangents()
    const k = RailColumn.scaleAt(p, cam)
    const hw = (k * PLATE_W) / 2 / z
    const limX = tan.h * VIEW_X - hw
    let tx = v.dot(right) / z
    tx = limX > 0 ? Math.max(-limX, Math.min(limX, tx)) : 0
    const lo = -tan.v * VIEW_Y - (k * RAIL.bottom) / z
    const hi = tan.v * VIEW_Y - (k * this.tallest()) / z
    let ty = v.dot(up) / z
    ty = lo <= hi ? Math.max(lo, Math.min(hi, ty)) : (lo + hi) / 2
    return cam.add(look.uniformScale(z)).add(right.uniformScale(tx * z)).add(up.uniformScale(ty * z))
  }

  /** The hairline from the rail's top to the copy, drawn in the rail's plane as the user sees it. */
  private placeLeader(target: vec3 | undefined, radius: number): void {
    this.leaderOn = !!target
    if (!target || !this.plate.top.enabled) {
      this.leader.so.enabled = false
      return
    }
    const cam = this.camTransform.getWorldPosition()
    const n = cam.sub(this.cur).normalize()
    const to = target.sub(cam)
    const denom = to.dot(n)
    if (Math.abs(denom) < 1e-3) {
      this.leader.so.enabled = false
      return
    }
    const s = this.cur.sub(cam).dot(n) / denom
    const hit = cam.add(to.uniformScale(s))
    const m = this.panel.getTransform().getInvertedWorldTransform()
    const t = m.multiplyPoint(hit)
    const top = this.topY.value
    const inner = PLATE_W / 2 - RAIL.corner
    // From the top edge if the copy is above it, otherwise from the top corner on the copy's side.
    const start = t.y >= top ? new vec3(Math.max(-inner, Math.min(inner, t.x)), top, -0.02) : new vec3(t.x >= 0 ? PLATE_W / 2 : -PLATE_W / 2, top - RAIL.corner, -0.02)
    const k = RailColumn.scaleAt(this.cur, cam)
    const r = (radius * Math.abs(s)) / k
    const d = new vec3(t.x - start.x, t.y - start.y, 0)
    const len = d.length
    if (len <= r + 0.5) {
      this.leader.so.enabled = false
      return
    }
    this.leader.so.enabled = true
    const end = start.add(d.uniformScale((len - r) / len))
    this.leader.set(start, end)
  }
}
