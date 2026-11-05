/**
 * Lamp hero: the control rail beside the copy, on the user's side (lamp-hero.md, Phase B).
 * One glass column (CutawayRail) showing only what the current step needs:
 *   "rest": "Take apart", the switch hint and "Put it back" (the lamp off);
 *   "on": "Warmth", "Brightness", "Take apart" and "Put it back" (the lamp on).
 * Built in code by the lamp stage (no scene component), placed by it every frame.
 */
import {kelvinToRgb, warmthToKelvin} from "./CutawayLampLight"
import {InstrumentSlider, RailColumn, SliderTick} from "./CutawayRail"
import {ENERGY, INK, opaque} from "./CutawayStyle"
import {UiPill} from "./CutawayUiKit"

export type LampRailMode = "none" | "rest" | "on"

export interface LampRailVisual {
  apart: boolean
  brightness: boolean
  warmth: boolean
  putBack: boolean
  switchHint: boolean
}

export type LampSliderKey = "apart" | "brightness" | "warmth"
const SLIDER_KEYS: LampSliderKey[] = ["apart", "brightness", "warmth"]

export class LampRail {
  readonly so: SceneObject
  /** Fired when "Put it back" is pinched. */
  onPutBack: (() => void) | null = null
  /** Fired when the switch hint is pinched: the same as pressing the switch on the cord. */
  onSwitchHint: (() => void) | null = null
  /** Fired on every pinch of a rail control (world position), for the tick sound. */
  onPinch: ((p: vec3) => void) | null = null
  /** Fired as soon as a slider's value changes (drag or setValue), so its effects land in the same frame. */
  onChange: ((k: LampSliderKey, v: number) => void) | null = null

  private rail: RailColumn
  private sliders: Record<LampSliderKey, InstrumentSlider>
  private putBack: UiPill
  private switchHint: UiPill
  private mode: LampRailMode = "none"
  private seen: Record<LampSliderKey, number> = {apart: -1, brightness: -1, warmth: -1}

  constructor(parent: SceneObject, glowMaterial: Material) {
    this.so = global.scene.createSceneObject("LampRail")
    this.so.setParent(parent)
    this.so.createComponent("Component.Canvas")
    this.rail = new RailColumn(this.so, "LampRailPanel", glowMaterial)
    this.rail.onPinch = (p) => {
      if (this.onPinch) this.onPinch(p)
    }
    this.sliders = {
      apart: this.rail.addSlider({name: "LampRailApart", label: "Take apart", fill: INK}),
      brightness: this.rail.addSlider({name: "LampRailBrightness", label: "Brightness", fill: ENERGY.light, format: (v) => Math.round(v * 100) + "%"}),
      warmth: this.rail.addSlider({
        name: "LampRailWarmth",
        label: "Warmth",
        fill: ENERGY.light,
        // The track is the colour scale: the lamp's own formula, cool on the left to warm on the right.
        gradient: (v) => opaque(kelvinToRgb(warmthToKelvin(v)))
      })
    }
    for (const k of Object.keys(this.sliders) as LampSliderKey[]) {
      const sl = this.sliders[k].slider
      sl.onValueChange.add(() => this.notify(k))
      sl.onKnobMoved.add(() => this.notify(k))
    }
    this.switchHint = this.rail.addPill("LampRailSwitch", "Press the switch", "primary")
    this.switchHint.btn.onTriggerUp.add(() => {
      if (this.switchHint.pop.isShown && this.onSwitchHint) this.onSwitchHint()
    })
    this.putBack = this.rail.addPill("LampRailPutBack", "Put it back", "outline")
    this.putBack.btn.onTriggerUp.add(() => {
      if (this.putBack.pop.isShown && this.onPutBack) this.onPutBack()
    })
    const s = this.sliders
    this.rail.defineLayout("rest", [s.apart, this.switchHint, this.putBack])
    this.rail.defineLayout("on", [s.warmth, s.brightness, s.apart, this.putBack])
    this.setMode("none", true)
  }

  // ---------------- Public API ----------------

  /** Show only the controls this step needs. `instant` skips the animation (Reset). */
  setMode(mode: LampRailMode, instant: boolean = false): void {
    this.mode = mode
    this.rail.setLayout(mode, instant)
  }

  getMode(): LampRailMode {
    return this.mode
  }

  /** Slider value 0..1 (follows the knob while it is dragged). */
  getValue(k: LampSliderKey): number {
    return this.sliders[k].value
  }

  setValue(k: LampSliderKey, v: number): void {
    this.sliders[k].value = v
    this.notify(k)
  }

  /** A slider's words and value (e.g. "Warmth  2700 K"). */
  setLabel(k: LampSliderKey, text: string): void {
    this.sliders[k].setWords(text)
  }

  getLabel(k: LampSliderKey): string {
    return this.sliders[k].getWords()
  }

  getSlider(k: LampSliderKey): InstrumentSlider {
    return this.sliders[k]
  }

  /** One tick per part on "Take apart", lit as each part frees itself. */
  syncTicks(list: SliderTick[]): void {
    this.sliders.apart.syncTicks(list)
  }

  /** "Take apart" does nothing while the shade is off or held: it looks it. */
  setApartDisabled(v: boolean): void {
    this.sliders.apart.setDisabled(v)
  }

  isDragging(): boolean {
    return this.rail.isDragging()
  }

  getVisual(): LampRailVisual {
    const s = this.sliders
    return {apart: s.apart.pop.isShown, brightness: s.brightness.pop.isShown, warmth: s.warmth.pop.isShown, putBack: this.putBack.pop.isShown, switchHint: this.switchHint.pop.isShown}
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
    for (let i = 0; i < SLIDER_KEYS.length; i++) this.notify(SLIDER_KEYS[i])
    this.rail.update(dt)
  }

  destroy(): void {
    this.so.destroy()
  }

  /** Tell the stage when a value really changed (from an event, setValue, or the per-frame check). */
  private notify(k: LampSliderKey): void {
    const v = this.getValue(k)
    if (v === this.seen[k]) return
    this.seen[k] = v
    if (this.onChange) this.onChange(k, v)
  }
}
