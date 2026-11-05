/**
 * Record player hero: the control rail beside the copy, on the user's side (recordplayer-hero.md).
 * One glass column (CutawayRail) showing only what the current step needs:
 *   "rest": "Take apart" and "Put it back" (the arm at rest);
 *   "play": "Pitch", "Loudness" and "Put it back" (once the record plays).
 * Built in code by the record player stage (no scene component), placed by it every frame.
 */
import {InstrumentSlider, RailColumn, SliderTick} from "./CutawayRail"
import {ENERGY, INK} from "./CutawayStyle"
import {UiPill} from "./CutawayUiKit"

export type RpRailMode = "none" | "rest" | "play"

export interface RpRailVisual {
  apart: boolean
  loudness: boolean
  pitch: boolean
  putBack: boolean
}

export type SliderKey = "apart" | "loudness" | "pitch"

export class RpRail {
  readonly so: SceneObject
  /** Fired when "Put it back" is pinched. */
  onPutBack: (() => void) | null = null
  /** Fired on every pinch of a rail control (world position), for the tick sound. */
  onPinch: ((p: vec3) => void) | null = null
  /** Fired as soon as a slider's value changes (drag or setValue), so its effects land in the same frame. */
  onChange: ((k: SliderKey, v: number) => void) | null = null

  private rail: RailColumn
  private sliders: Record<SliderKey, InstrumentSlider>
  private putBack: UiPill
  private mode: RpRailMode = "none"
  private seen: Record<SliderKey, number> = {apart: -1, loudness: -1, pitch: -1}

  constructor(parent: SceneObject, glowMaterial: Material) {
    this.so = global.scene.createSceneObject("RpRail")
    this.so.setParent(parent)
    this.so.createComponent("Component.Canvas")
    this.rail = new RailColumn(this.so, "RpRailPanel", glowMaterial)
    this.rail.onPinch = (p) => {
      if (this.onPinch) this.onPinch(p)
    }
    this.sliders = {
      apart: this.rail.addSlider({name: "RpRailApart", label: "Take apart", fill: INK}),
      loudness: this.rail.addSlider({name: "RpRailLoudness", label: "Loudness", fill: ENERGY.motion, format: (v) => Math.round(v * 100) + "%"}),
      pitch: this.rail.addSlider({name: "RpRailPitch", label: "Pitch", fill: ENERGY.motion})
    }
    for (const k of Object.keys(this.sliders) as SliderKey[]) {
      const sl = this.sliders[k].slider
      sl.onValueChange.add(() => this.notify(k))
      sl.onKnobMoved.add(() => this.notify(k))
    }
    this.putBack = this.rail.addPill("RpRailPutBack", "Put it back", "outline")
    this.putBack.btn.onTriggerUp.add(() => {
      if (this.putBack.pop.isShown && this.onPutBack) this.onPutBack()
    })
    const s = this.sliders
    this.rail.defineLayout("rest", [s.apart, this.putBack])
    this.rail.defineLayout("play", [s.pitch, s.loudness, this.putBack])
    this.setMode("none", true)
  }

  // ---------------- Public API ----------------

  /** Show only the controls this step needs. `instant` skips the animation (Reset). */
  setMode(mode: RpRailMode, instant: boolean = false): void {
    this.mode = mode
    this.rail.setLayout(mode, instant)
  }

  getMode(): RpRailMode {
    return this.mode
  }

  /** Slider value 0..1 (follows the knob while it is dragged). */
  getValue(k: SliderKey): number {
    return this.sliders[k].value
  }

  setValue(k: SliderKey, v: number): void {
    this.sliders[k].value = v
    this.notify(k)
  }

  /** A slider's words and value (e.g. "Pitch  440 Hz"). */
  setLabel(k: SliderKey, text: string): void {
    this.sliders[k].setWords(text)
  }

  getSlider(k: SliderKey): InstrumentSlider {
    return this.sliders[k]
  }

  /** One tick per part on "Take apart", lit as each part frees itself. */
  syncTicks(list: SliderTick[]): void {
    this.sliders.apart.syncTicks(list)
  }

  /** "Take apart" does nothing while the arm is away: it looks it. */
  setApartDisabled(v: boolean): void {
    this.sliders.apart.setDisabled(v)
  }

  isDragging(): boolean {
    return this.rail.isDragging()
  }

  getVisual(): RpRailVisual {
    const s = this.sliders
    return {apart: s.apart.pop.isShown, loudness: s.loudness.pop.isShown, pitch: s.pitch.pop.isShown, putBack: this.putBack.pop.isShown}
  }

  /** True while any part of the rail is still on screen (including its exit animation). */
  isVisible(): boolean {
    return this.rail.isVisible()
  }

  /** Place the rail for `p` (world), inside the view, with its leader to `target`. */
  place(p: vec3, target?: vec3, radius?: number): void {
    this.rail.place(p, target, radius)
  }

  getRail(): RailColumn {
    return this.rail
  }

  /** The rail's scale at `p` seen from `cam` (it keeps its apparent size). */
  static scaleAt(p: vec3, cam: vec3): number {
    return RailColumn.scaleAt(p, cam)
  }

  /** The rail's outline as a world box (layout checks). */
  getBoxes(): vec3[][] {
    return this.rail.getBoxes()
  }

  /** Per frame (driven by the stage). */
  update(dt: number): void {
    for (const k of Object.keys(this.sliders) as SliderKey[]) this.notify(k)
    this.rail.update(dt)
  }

  destroy(): void {
    this.so.destroy()
  }

  /** Tell the stage when a value really changed (from an event, setValue, or the per-frame check). */
  private notify(k: SliderKey): void {
    const v = this.getValue(k)
    if (v === this.seen[k]) return
    this.seen[k] = v
    if (this.onChange) this.onChange(k, v)
  }
}
