import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CutawayStationUI, StationVisual} from "./CutawayStationUI"
import {CutawayResetUI} from "./CutawayResetUI"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {CameraExplanation, ExplainContext, Explanation, LampExplanation, RecordPlayerExplanation} from "./CutawayExplanations"
import {easeIn} from "./CutawayTween"

export type StationKey = "recordPlayer" | "camera" | "lamp"
export type StationState = "idle" | "chip" | "questions" | "playing" | "explained"
type Mode = "rest" | "chip" | "questions" | "playing"

interface Station {
  key: StationKey
  ui: CutawayStationUI
  target: SceneObject
  mode: Mode
  explained: boolean
  armed: boolean
}

interface Running {
  index: number
  exp: Explanation
  root: SceneObject
  state: "playing" | "collapsing"
  collapseT: number
  collapseDur: number
  completed: boolean
}

/**
 * Cutaway: look at a real object → its chip grows from a quiet dot → pinch the chip →
 * pinch a question → a hard-coded explanation plays on the real objects → it collapses
 * into an "explained" dot. Markers are hand-placed stand-ins for recognition and depth.
 */
@component
export class CutawayMain extends BaseScriptComponent {
  @ui.label("Cutaway — controller. Markers are hand-placed stand-ins for object recognition")
  @ui.separator
  @ui.group_start("Station UIs")
  @input
  @hint("UI for the record player")
  recordPlayerUI: CutawayStationUI

  @input
  @hint("UI for the camera")
  cameraUI: CutawayStationUI

  @input
  @hint("UI for the lamp")
  lampUI: CutawayStationUI

  @input
  @hint("Reset pill (clears all explained dots)")
  resetUI: CutawayResetUI

  @input
  @hint("Floating labels used by the explanations")
  labelsUI: CutawayLabelsUI
  @ui.group_end

  @ui.group_start("Markers (move these over the real objects)")
  @input
  @hint("Record player marker (used for looking at it; also the platter centre)")
  recordPlayerMarker: SceneObject

  @input
  @hint("Needle / stylus marker: the magnify bubble opens here and the line of light starts here")
  needleMarker: SceneObject

  @input
  @hint("Nearest speaker marker: cone, sound rings and the chime come from here")
  speakerMarker: SceneObject

  @input
  @hint("Camera marker")
  cameraMarker: SceneObject

  @input
  @hint("Lamp marker (the shade / bulb)")
  lampMarker: SceneObject

  @input
  @hint("Lamp base marker (bottom of the pole)")
  lampBaseMarker: SceneObject

  @input
  @hint("Where the lamp cord starts (wall outlet)")
  cordStartMarker: SceneObject
  @ui.group_end

  @ui.group_start("Effects")
  @input
  @hint("Additive glow material (lines of light, rays, rings)")
  glowMaterial: Material

  @input
  @hint("Solid model material (cone, lens, stylus, shell panels)")
  modelMaterial: Material

  @input
  @hint("Spatial AudioComponent placed at the speaker, holding the chime")
  chimeAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Optional: your own speaker-cone model (pinned at the speaker marker). Leave empty to use the built-in cone")
  coneModel: SceneObject

  @input
  @hint("Height (world Y, cm) of the shelf the line of light runs along")
  shelfY: number = -144

  @input
  @hint("Direction the real camera's lens points (into the room, horizontal)")
  cameraFacing: vec3 = new vec3(0.94, 0, -0.34)

  @input
  @hint("Real DSLR body (cm): x = depth along the lens axis, y = height, z = width. Centred on the camera station's bounds centre")
  cameraBodySize: vec3 = new vec3(11.5, 11.3, 14.7)

  @input
  @allowUndefined
  @hint("Spatial AudioComponent at the camera body: mirror flip and shutter click")
  clickAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent at the lamp: soft rising power-up tone as the light comes on")
  powerUpAudio: AudioComponent
  @ui.group_end

  @ui.group_start("Looking")
  @input
  @hint("An object counts as 'looked at' when it is within this angle of the view center (degrees)")
  @widget(new SliderWidget(4, 30, 1))
  gazeEnterDeg: number = 12

  @input
  @hint("The chip shrinks back once the object is farther than this from the view center (degrees)")
  @widget(new SliderWidget(8, 45, 1))
  gazeExitDeg: number = 24
  @ui.group_end

  private stations: Station[] = []
  private running: Running | null = null
  private camTransform: Transform | null = null
  private focused = -1
  private gazeOverride: vec3 | null = null
  private headOverride: vec3 | null = null
  /** Dots closer together than this (as seen from the head, degrees) count as lined up. */
  private static readonly LINE_UP_DEG = 4
  private phaseLog: string[] = []
  private chimeLog: {time: number; position: vec3}[] = []

  onAwake(): void {
    this.stations = [
      {key: "recordPlayer", ui: this.recordPlayerUI, target: this.recordPlayerMarker, mode: "rest", explained: false, armed: true},
      {key: "camera", ui: this.cameraUI, target: this.cameraMarker, mode: "rest", explained: false, armed: true},
      {key: "lamp", ui: this.lampUI, target: this.lampMarker, mode: "rest", explained: false, armed: true}
    ]
    for (const a of [this.chimeAudio, this.clickAudio, this.powerUpAudio]) {
      if (!a) continue
      try {
        a.playbackMode = Audio.PlaybackMode.LowLatency
      } catch (e) {
        print("Cutaway: could not set audio playback mode: " + e)
      }
    }
    if (this.labelsUI && this.glowMaterial) this.labelsUI.setLineMaterial(this.glowMaterial)
    this.createEvent("OnStartEvent").bind(() => this.onStart())
    this.createEvent("UpdateEvent").bind(() => this.onUpdate())
  }

  private onStart(): void {
    this.camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    this.stations.forEach((s, i) => {
      s.ui.onChipPressed.add(() => this.onChip(i))
      s.ui.onQuestionPressed.add((q) => this.onQuestion(i, q))
      s.ui.onStopPressed.add(() => this.onStop(i))
      s.ui.onDotPressed.add(() => this.onDot(i))
      this.setMode(i, "rest")
    })
    this.resetUI.onResetPressed.add(() => this.resetAll())
    print("Cutaway ready: 3 stations")
  }

  // ---------------- Input handlers ----------------

  private onChip(i: number): void {
    const s = this.stations[i]
    if (this.running || s.mode !== "chip") return
    this.setMode(i, "questions")
  }

  private onQuestion(i: number, q: number): void {
    const s = this.stations[i]
    if (this.running || s.mode !== "questions") return
    this.startExplanation(i, q)
  }

  private onStop(i: number): void {
    if (this.running && this.running.index === i && this.running.state === "playing") this.beginCollapse(false)
  }

  private onDot(i: number): void {
    const s = this.stations[i]
    if (this.running || s.mode !== "rest" || !s.explained) return
    this.focused = i
    this.setMode(i, "questions")
  }

  /** Clears every explained dot and returns all three objects to idle. */
  resetAll(): void {
    if (this.running) {
      this.running.exp.hideLabels()
      this.running.root.destroy()
      this.stations[this.running.index].ui.setCaptionWorldPosition(null)
      this.running = null
    }
    this.labelsUI.hideAll()
    this.stations.forEach((s, i) => {
      s.explained = false
      s.armed = false
      this.setMode(i, "rest")
    })
    this.focused = -1
    this.log("reset")
  }

  // ---------------- State ----------------

  private setMode(i: number, mode: Mode, question: number = 0): void {
    const s = this.stations[i]
    const ui = s.ui
    s.mode = mode
    switch (mode) {
      case "rest":
        ui.setScan(false)
        ui.setChip(false)
        ui.setQuestions(false)
        ui.setStop(false)
        ui.setIdleDot(!s.explained)
        ui.setExplainedDot(s.explained)
        break
      case "chip":
        ui.setScan(false)
        ui.setIdleDot(false)
        ui.setExplainedDot(false)
        ui.setChip(true)
        ui.setQuestions(false)
        break
      case "questions":
        // Pinching the chip (or the explained dot) scans the object, then the questions fan out.
        ui.setScan(true)
        ui.setIdleDot(false)
        ui.setExplainedDot(false)
        ui.setChip(true)
        ui.setQuestions(true)
        break
      case "playing":
        // The scan's brackets hand over to the explanation's ghost shell.
        ui.setScan(false)
        ui.setIdleDot(false)
        ui.setExplainedDot(false)
        ui.keepOnlyQuestion(question)
        ui.setStop(true)
        break
    }
  }

  private startExplanation(i: number, q: number): void {
    const s = this.stations[i]
    this.setMode(i, "playing", q)
    const root = global.scene.createSceneObject("Effects_" + s.ui.namePrefix)
    root.setParent(this.sceneObject)
    const tr = root.getTransform()
    tr.setWorldPosition(s.ui.getAnchorWorldPosition())
    tr.setWorldRotation(quat.quatIdentity())
    tr.setWorldScale(vec3.one())
    this.phaseLog = []
    this.log("start:" + s.key + ":q" + q)
    const ctx: ExplainContext = {
      root,
      glowMat: this.glowMaterial,
      modelMat: this.modelMaterial,
      labels: this.labelsUI,
      camPos: () => this.camPos(),
      log: (p) => this.log(p),
      playChime: () => this.playChime(),
      playClick: () => this.playClick(),
      playPowerUp: () => this.playPowerUp(),
      coneOverride: this.coneModel ?? null,
      caption: (text) => this.labelsUI.setCaption(text, text ? s.ui.getCaptionAnchor() : undefined),
      bounds: s.ui.getBounds(),
      uiScale: s.ui.getUiScale()
    }
    let exp: Explanation
    if (s.key === "recordPlayer") {
      exp = new RecordPlayerExplanation(ctx, this.pos(this.needleMarker), this.pos(this.speakerMarker), this.shelfY, this.pos(this.recordPlayerMarker))
    } else if (s.key === "camera") {
      exp = new CameraExplanation(ctx, this.cameraFacing, this.cameraBodySize)
    } else {
      exp = new LampExplanation(ctx, this.pos(this.lampMarker), this.pos(this.lampBaseMarker), this.pos(this.cordStartMarker))
    }
    if (exp.stopHint) s.ui.setStopWorldPosition(exp.stopHint)
    else s.ui.resetStopPosition()
    s.ui.setCaptionWorldPosition(exp.captionHint)
    this.running = {index: i, exp, root, state: "playing", collapseT: 0, collapseDur: 0.3, completed: false}
  }

  private beginCollapse(completed: boolean): void {
    const r = this.running
    if (!r) return
    r.state = "collapsing"
    r.completed = completed
    r.collapseT = 0
    // Finish: everything folds back into the dot (400 ms, ease-in). Stop: a quick 220 ms exit.
    r.collapseDur = completed ? 0.4 : 0.22
    r.exp.hideLabels()
    this.labelsUI.setCaption(null)
    this.stations[r.index].ui.hideControls()
    this.log(completed ? "finish" : "stopped")
  }

  private endRunning(): void {
    const r = this.running
    if (!r) return
    r.root.destroy()
    this.running = null
    const s = this.stations[r.index]
    s.ui.setCaptionWorldPosition(null)
    if (r.completed) {
      s.explained = true
      s.ui.setEnergies(r.exp.energies)
      s.ui.playFlash()
    }
    s.armed = false
    this.setMode(r.index, "rest")
    this.log(r.completed ? "explained" : "returnedToDot")
  }

  private playChime(): void {
    if (!this.chimeAudio) {
      this.log("chime:missing")
      return
    }
    if (this.chimeAudio.isPlaying()) this.chimeAudio.stop(false)
    this.chimeAudio.play(1)
    this.chimeLog.push({time: getTime(), position: this.chimeAudio.getSceneObject().getTransform().getWorldPosition()})
    this.log("chime")
  }

  private playClick(): void {
    if (!this.clickAudio) {
      this.log("click:missing")
      return
    }
    if (this.clickAudio.isPlaying()) this.clickAudio.stop(false)
    this.clickAudio.play(1)
  }

  private playPowerUp(): void {
    if (!this.powerUpAudio) {
      this.log("powerUp:missing")
      return
    }
    if (this.powerUpAudio.isPlaying()) this.powerUpAudio.stop(false)
    this.powerUpAudio.play(1)
  }

  // ---------------- Frame loop ----------------

  private onUpdate(): void {
    const dt = getDeltaTime()
    const r = this.running
    if (r) {
      if (r.state === "playing") {
        if (!this.holdExplanation) r.exp.update(dt)
        if (r.exp.finished) this.beginCollapse(true)
      } else {
        r.collapseT += dt
        const k = Math.max(0.0001, 1 - easeIn(r.collapseT / r.collapseDur))
        r.root.getTransform().setLocalScale(vec3.one().uniformScale(k))
        if (r.collapseT >= r.collapseDur) this.endRunning()
      }
    }
    this.updateGaze()
  }

  private updateGaze(): void {
    if (!this.camTransform || this.running) return
    const cam = this.camPos()
    const dir = this.gazeDir()
    const toT = this.stations.map((s) => this.pos(s.target).sub(cam))
    const angles = toT.map((d) => this.angleDeg(dir, d))
    this.stations.forEach((s, i) => {
      if (!s.armed && angles[i] > this.gazeExitDeg) s.armed = true
    })
    // Two dots that line up in the gaze (one in front of the other, e.g. the camera in front of
    // the record player from the sofa): the nearer one wins. Otherwise the one nearest the view centre.
    const lined = (a: number, b: number) => this.angleDeg(toT[a], toT[b]) < CutawayMain.LINE_UP_DEG
    const nearer = (a: number, b: number) => toT[a].length < toT[b].length
    let best = -1
    for (let i = 0; i < angles.length; i++) {
      if (angles[i] >= this.gazeEnterDeg) continue
      if (best < 0 || (lined(i, best) ? nearer(i, best) : angles[i] < angles[best])) best = i
    }
    let f = this.focused
    const exitFor = (i: number) => (this.stations[i].mode === "questions" ? this.gazeExitDeg * 1.6 : this.gazeExitDeg)
    if (f >= 0 && angles[f] < exitFor(f)) {
      if (best >= 0 && best !== f && (lined(best, f) ? nearer(best, f) : angles[best] < angles[f] - 2)) f = best
    } else {
      f = best
    }
    this.focused = f
    this.stations.forEach((s, i) => {
      if (i === f) {
        if (s.mode === "rest" && !s.explained && s.armed) this.setMode(i, "chip")
      } else if (s.mode === "chip" || s.mode === "questions") {
        this.setMode(i, "rest")
      }
    })
  }

  private gazeDir(): vec3 {
    if (this.gazeOverride) return this.gazeOverride.normalize()
    return this.camTransform.forward.uniformScale(-1).normalize()
  }

  private angleDeg(a: vec3, b: vec3): number {
    const d = Math.min(1, Math.max(-1, a.normalize().dot(b.normalize())))
    return (Math.acos(d) * 180) / Math.PI
  }

  private camPos(): vec3 {
    if (this.headOverride) return this.headOverride
    return this.camTransform ? this.camTransform.getWorldPosition() : vec3.zero()
  }

  private pos(so: SceneObject): vec3 {
    return so.getTransform().getWorldPosition()
  }

  private log(p: string): void {
    this.phaseLog.push(p)
    print("Cutaway: " + p)
  }

  private index(key: StationKey): number {
    return this.stations.findIndex((s) => s.key === key)
  }

  // ---------------- Read-only state + test hooks (used by the LEAF scenarios) ----------------

  /** Test hook: true freezes the playing explanation's timeline (for screenshots of one beat). */
  holdExplanation = false

  /** Test hook: pretend the user is looking along `dir` (world). Pass null to use the real head pose. */
  setGazeOverride(dir: vec3 | null): void {
    this.gazeOverride = dir
  }

  /** Test hook: pretend the head is at `p` (world) for gaze. Pass null to use the real head pose. */
  setHeadOverride(p: vec3 | null): void {
    this.headOverride = p
  }

  /** Test hook: look straight at a station's marker. */
  lookAt(key: StationKey): void {
    this.gazeOverride = this.pos(this.stations[this.index(key)].target).sub(this.camPos())
  }

  /** Test hook: look at the ceiling (away from every object). */
  lookAway(): void {
    this.gazeOverride = new vec3(0, 1, -0.2)
  }

  getStationState(key: StationKey): StationState {
    const s = this.stations[this.index(key)]
    if (s.mode === "rest") return s.explained ? "explained" : "idle"
    return s.mode
  }

  getStationVisual(key: StationKey): StationVisual {
    return this.stations[this.index(key)].ui.getVisual()
  }

  isExplained(key: StationKey): boolean {
    return this.stations[this.index(key)].explained
  }

  isRunning(): boolean {
    return this.running !== null
  }

  getPhaseLog(): string[] {
    return this.phaseLog.slice()
  }

  getChimeLog(): {time: number; position: vec3}[] {
    return this.chimeLog.slice()
  }

  getMarkerPosition(name: "recordPlayer" | "needle" | "speaker" | "camera" | "lamp"): vec3 {
    const map = {
      recordPlayer: this.recordPlayerMarker,
      needle: this.needleMarker,
      speaker: this.speakerMarker,
      camera: this.cameraMarker,
      lamp: this.lampMarker
    }
    return this.pos(map[name])
  }

  getCameraPosition(): vec3 {
    return this.camPos()
  }

  getEffectsRootName(): string | null {
    return this.running ? this.running.root.name : null
  }
}
