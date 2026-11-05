import Event from "SpectaclesInteractionKit.lspkg/Utils/Event"
import {InstrumentSlider, RailColumn, SliderTick} from "./CutawayRail"
import {ENERGY, INK} from "./CutawayStyle"
import {UiPill} from "./CutawayUiKit"

export type HeroRailMode = "none" | "apart" | "viewfinder" | "light"

export interface HeroRailVisual {
  apart: boolean
  focus: boolean
  putBack: boolean
  photo: boolean
}

/**
 * The camera hero stage's control rail: one glass column (CutawayRail) beside the replica, on the
 * user's side. It shows only what the current step needs: the "Take apart" slider, then the "Focus"
 * slider and "Take a photo", with "Put it back" throughout. CutawayHero places it every frame.
 */
@component
export class CutawayHeroUI extends BaseScriptComponent {
  @ui.label("Cutaway — camera hero control rail (Take apart / Focus / Take a photo / Put it back)")
  @ui.separator
  @input
  @hint("Additive glow material for strokes (the one the chips use)")
  glowMaterial: Material

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

  private rail: RailColumn
  private apart: InstrumentSlider
  private focus: InstrumentSlider
  private putBack: UiPill
  private photo: UiPill
  private mode: HeroRailMode = "none"
  private firstFrame = true

  onAwake(): void {
    this.sceneObject.createComponent("Component.Canvas")
    this.rail = new RailColumn(this.sceneObject, "HeroRailPanel", this.glowMaterial)
    this.rail.onPinch = (p) => this.onPinch.invoke(p)
    this.apart = this.rail.addSlider({name: "HeroApartSlider", label: this.apartLabel, fill: INK})
    this.focus = this.rail.addSlider({name: "HeroFocusSlider", label: this.focusLabel, fill: ENERGY.light})
    this.photo = this.rail.addPill("HeroPhoto", this.photoLabel, "primary")
    this.putBack = this.rail.addPill("HeroPutBack", this.putBackLabel, "outline")
    this.rail.defineLayout("apart", [this.apart, this.putBack])
    this.rail.defineLayout("viewfinder", [this.apart, this.putBack])
    this.rail.defineLayout("light", [this.apart, this.focus, this.photo, this.putBack])
    this.putBack.btn.onTriggerUp.add(() => {
      if (this.putBack.pop.isShown) this.onPutBack.invoke()
    })
    this.photo.btn.onTriggerUp.add(() => {
      if (this.photo.pop.isShown) this.onPhoto.invoke()
    })
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  // ---------------- Public API ----------------

  /** Show only the controls this step needs. `instant` skips the animation (Reset). */
  setMode(mode: HeroRailMode, instant: boolean = false): void {
    this.mode = mode
    this.rail.setLayout(mode, instant)
  }

  getMode(): HeroRailMode {
    return this.mode
  }

  /** Take-apart value 0..1 (follows the knob while it is dragged). */
  getApartValue(): number {
    return this.apart.value
  }

  setApartValue(v: number): void {
    this.apart.value = v
  }

  getFocusValue(): number {
    return this.focus.value
  }

  setFocusValue(v: number): void {
    this.focus.value = v
  }

  /** The value above the Focus knob, e.g. "L 22.4 cm". */
  setFocusReadout(text: string): void {
    this.focus.setReadout(text)
  }

  getApartSlider(): InstrumentSlider {
    return this.apart
  }

  getFocusSlider(): InstrumentSlider {
    return this.focus
  }

  /** One tick per part on "Take apart", lit as each part frees itself. */
  syncTicks(list: SliderTick[]): void {
    this.apart.syncTicks(list)
  }

  /** "Take a photo" does nothing while a shot runs: it looks it. */
  setPhotoDisabled(v: boolean): void {
    this.photo.setDisabled(v)
  }

  isDragging(): boolean {
    return this.rail.isDragging()
  }

  getVisual(): HeroRailVisual {
    return {apart: this.apart.pop.isShown, focus: this.focus.pop.isShown, putBack: this.putBack.pop.isShown, photo: this.photo.pop.isShown}
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

  /** The rail's outline as a world box (layout tests). */
  getBoxes(): vec3[][] {
    return this.rail.getBoxes()
  }

  private onUpdate(): void {
    const dt = getDeltaTime()
    if (this.firstFrame) {
      this.firstFrame = false
      this.setMode(this.mode, true)
    }
    this.rail.update(dt)
  }
}
