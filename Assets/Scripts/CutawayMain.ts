import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CutawayStationUI, StationVisual} from "./CutawayStationUI"
import {CutawayResetUI} from "./CutawayResetUI"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {CameraExplanation, ExplainContext, Explanation, LampExplanation, RecordPlayerExplanation} from "./CutawayExplanations"
import {easeIn} from "./CutawayTween"
import {CameraHero, HeroSound} from "./CutawayHero"
import {TableSurface, TableSurveyor} from "./CutawayHeroSurface"
import {CutawayHeroUI} from "./CutawayHeroUI"
import {ENERGY} from "./CutawayStyle"
import {RpTone} from "./CutawayRpTone"
import {RecordPlayerHero, RpSound} from "./CutawayRpHero"
import {RpRail, RpRailVisual} from "./CutawayRpRail"
import {RP_GEOM} from "./CutawayRecordPlayerModel"

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
  @allowUndefined
  @hint("Bulb marker: the real lamp's LED chips, low inside the shade on its socket (the explanation's x-ray window and chip bubble; the lamp marker stays the gaze target)")
  bulbMarker: SceneObject

  @input
  @hint("Where the lamp cord starts (wall outlet)")
  cordStartMarker: SceneObject

  @input
  @hint("Camera hero stage: the centre of the top surface of the round coffee table in front of the sofa. The table is surveyed by World Query hit test around it at launch")
  tableMarker: SceneObject

  @input
  @hint("Fallback table top (if hit testing finds no table): its height, world Y in cm (measured in the preview: -144.4)")
  tableTopHeight: number = -144.4

  @input
  @hint("Fallback table top: radius in cm, centred on the table marker (the oval top's inscribed circle: 45)")
  tableRadius: number = 45

  @input
  @hint("Camera hero stage: the lens inside its bag next to the camera on the console. The replica's lens rises out of here")
  lensBagMarker: SceneObject
  @ui.group_end

  @ui.group_start("Camera hero stage (Bring it closer)")
  @input
  @hint("Control rail beside the replica (Take apart / Focus / Take a photo / Put it back)")
  heroUI: CutawayHeroUI

  @input
  @hint("Replica body mesh (Models/CameraReplica: Body), pivot at the lens mount, 14 cm wide at scale 1")
  replicaBodyMesh: RenderMesh

  @input
  @hint("Replica lens mesh (Models/CameraReplica: Lens), pivot at the mount, pointing along +Z")
  replicaLensMesh: RenderMesh

  @input
  @hint("The replica's shell material (ReplicaShell slot: textures + 35% emissive lift + warm fresnel rim)")
  replicaShellMaterial: Material

  @input
  @allowUndefined
  @hint("The record player model's shell material (RecordPlayerShell slot: uber PBR, vertex colour as emissive lift, warm fresnel rim)")
  recordPlayerShellMaterial: Material

  @input
  @allowUndefined
  @hint("The lamp model's shell material (LampShell slot: uber PBR, vertex colour as emissive lift, warm fresnel rim)")
  lampShellMaterial: Material

  @input
  @allowUndefined
  @hint("The lamp's paper (LampPaper: LampShell with the procedural rice-paper crinkle as base and emissive texture; the paper uses it as is)")
  lampPaperMaterial: Material

  @input
  @allowUndefined
  @hint("The lamp's steel (LampSteel: LampShell with the procedural brushed-steel texture, for the base, collar, stem and rings)")
  lampSteelMaterial: Material

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: soft rising tone as the copy lifts off the camera")
  heroLiftAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: bayonet click where the lens mounts")
  heroBayonetAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: soft air sweep that follows the replica in flight")
  heroFlightAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: soft landing tone from the table")
  heroLandAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: soft contact tap where the replica touches the table")
  heroTapAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Physics matter for the table and the replica: high friction, bounciness 0.05 (HeroMatter)")
  heroMatter: Matter

  @input
  @allowUndefined
  @hint("Texture-free PBR with rim highlight (additive): the replica's code-built solid parts (HeroSolid)")
  heroSolidMaterial: Material

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: one soft click per part as it frees itself")
  heroPartAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: mirror lift (MirrorClick.wav)")
  heroMirrorAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: two-part shutter sound")
  heroShutterAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent: the print sliding out")
  heroPrintAudio: AudioComponent
  @ui.group_end

  @ui.group_start("Record player hero stage (Bring it closer)")
  @input
  @allowUndefined
  @hint("Spatial AudioComponent at the speaker marker: the record's tone, synthesized live through an Audio Output track")
  rpToneAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Audio Output asset (RpToneOutput) the tone is written into, sample by sample")
  rpToneOutput: AudioTrackAsset
  @ui.group_end

  @ui.group_start("Effects")
  @input
  @hint("Additive glow material (lines of light, rays, rings)")
  glowMaterial: Material

  @input
  @hint("Solid model material (cone, lens, stylus, shell panels)")
  modelMaterial: Material

  @input
  @hint("Spatial AudioComponent placed at the speaker: the short warm tone as the waves leave it")
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

  @input
  @allowUndefined
  @hint("Spatial AudioComponent at the stylus: the needle-drop crackle")
  crackleAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent for the soft tick on every pinch (moved to the pinched control)")
  tickAudio: AudioComponent

  @input
  @allowUndefined
  @hint("Spatial AudioComponent for the scan sweep (moved to the scanned object)")
  scanAudio: AudioComponent
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
  private soundLog: {name: string; time: number; position: vec3}[] = []
  private hero: CameraHero | null = null
  private surveyor: TableSurveyor | null = null
  private surface: TableSurface | null = null
  private rpHero: RecordPlayerHero | null = null
  private rpRail: RpRail | null = null
  private rpTone: RpTone | null = null

  onAwake(): void {
    this.stations = [
      {key: "recordPlayer", ui: this.recordPlayerUI, target: this.recordPlayerMarker, mode: "rest", explained: false, armed: true},
      {key: "camera", ui: this.cameraUI, target: this.cameraMarker, mode: "rest", explained: false, armed: true},
      {key: "lamp", ui: this.lampUI, target: this.lampMarker, mode: "rest", explained: false, armed: true}
    ]
    for (const a of [this.chimeAudio, this.clickAudio, this.powerUpAudio, this.crackleAudio, this.tickAudio, this.scanAudio, ...this.heroAudios()]) {
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
      // Sound comes from where the event happens: the pinched control, the scanned object.
      s.ui.onPinch.add((p) => this.playAt("tick", this.tickAudio, p))
      s.ui.onScan.add((c) => this.playAt("scan", this.scanAudio, c))
      this.setMode(i, "rest")
    })
    this.resetUI.onResetPressed.add(() => this.resetAll())
    this.resetUI.onPinch.add((p) => this.playAt("tick", this.tickAudio, p))
    this.setupHero()
    this.setupRpHero()
    print("Cutaway ready: 3 stations")
  }

  // ---------------- Record player hero stage ----------------

  private rpAudio(s: RpSound): AudioComponent | null {
    const map: {[k in RpSound]: AudioComponent} = {
      lift: this.heroLiftAudio,
      flight: this.heroFlightAudio,
      land: this.heroLandAudio,
      tap: this.heroTapAudio,
      part: this.heroPartAudio,
      crackle: this.crackleAudio
    }
    return map[s] ?? null
  }

  /** The real deck's footprint centre on the shelf: the record player marker sits on the platter centre, on the record. */
  private rpRealOrigin(): vec3 {
    const m = this.pos(this.recordPlayerMarker)
    return m.sub(new vec3(RP_GEOM.axis.x, RP_GEOM.recordTop, RP_GEOM.axis.y))
  }

  private setupRpHero(): void {
    if (!this.recordPlayerShellMaterial || !this.tableMarker || !this.surveyor) {
      print("Cutaway: record player hero stage is not wired (shell material, table marker, camera stage's surveyor)")
      return
    }
    const camProvider = WorldCameraFinderProvider.getInstance()
    this.rpRail = new RpRail(this.sceneObject, this.glowMaterial)
    this.rpTone = new RpTone(this.rpToneAudio ?? null, this.rpToneOutput ?? null)
    print("Cutaway: rp tone " + (this.rpTone.ok ? "live synthesis through the Audio Output" : "unavailable: " + this.rpTone.why))
    this.rpHero = new RecordPlayerHero({
      parent: this.sceneObject,
      glowMat: this.glowMaterial,
      shellMat: this.recordPlayerShellMaterial,
      labels: this.labelsUI,
      rail: this.rpRail,
      tone: this.rpTone,
      camPos: () => this.camPos(),
      camera: camProvider.getComponent(),
      realOrigin: () => this.rpRealOrigin(),
      realRotation: quat.quatIdentity(),
      speaker: () => this.pos(this.speakerMarker),
      surface: () => this.surface ?? this.fallbackSurface(),
      survey: (done) => {
        const fb = this.fallbackSurface()
        this.surface = fb
        this.surveyor.survey(this.pos(this.tableMarker), fb, (s) => {
          this.surface = s
          done(s)
        })
      },
      matter: this.heroMatter ?? null,
      sound: (s, p) => {
        const a = this.rpAudio(s)
        if (a) this.playAt("rp_" + s, a, p)
        else this.soundLog.push({name: "rp_" + s, time: getTime(), position: p})
      },
      moveSound: (s, p) => {
        const a = this.rpAudio(s)
        if (a) a.getSceneObject().getTransform().setWorldPosition(p)
      },
      log: (p) => this.log(p),
      caption: (text, at) => this.labelsUI.setCaption(text, at)
    })
    this.rpRail.onPutBack = () => this.rpHero.putBack()
    this.rpRail.onPinch = (p) => this.playAt("tick", this.tickAudio, p)
    this.recordPlayerUI.onCloserPressed.add(() => this.launchRp())
  }

  /**
   * "Bring it closer" (the record player's pill or its second question). One copy on the table at a
   * time: if the camera's copy is out, it is sent home first through the camera's own Reset path.
   */
  private launchRp(): void {
    const i = this.index("recordPlayer")
    const s = this.stations[i]
    if (!this.rpHero || this.running) return
    if (this.rpHero.isOut) {
      if (s.mode === "questions") this.setMode(i, "rest")
      return
    }
    this.phaseLog = []
    if (this.hero && this.hero.isOut) {
      this.hero.clear()
      this.log("rp:cameraHome")
    }
    if (!s.explained) {
      s.explained = true
      s.ui.setEnergies([ENERGY.motion, ENERGY.signal])
    }
    s.armed = false
    this.setMode(i, "rest")
    s.ui.setCloser(false)
    this.log("rp:start")
    this.rpHero.launch()
  }

  // ---------------- Camera hero stage ----------------

  private heroAudios(): AudioComponent[] {
    return [this.heroLiftAudio, this.heroBayonetAudio, this.heroFlightAudio, this.heroLandAudio, this.heroTapAudio, this.heroPartAudio, this.heroMirrorAudio, this.heroShutterAudio, this.heroPrintAudio].filter((a) => !!a)
  }

  private heroAudio(s: HeroSound): AudioComponent | null {
    const map: {[k in HeroSound]: AudioComponent} = {
      lift: this.heroLiftAudio,
      bayonet: this.heroBayonetAudio,
      flight: this.heroFlightAudio,
      land: this.heroLandAudio,
      tap: this.heroTapAudio,
      part: this.heroPartAudio,
      mirror: this.heroMirrorAudio,
      shutter: this.heroShutterAudio,
      print: this.heroPrintAudio
    }
    return map[s] ?? null
  }

  private setupHero(): void {
    if (!this.heroUI || !this.replicaBodyMesh || !this.replicaLensMesh || !this.replicaShellMaterial || !this.tableMarker || !this.lensBagMarker) {
      print("Cutaway: camera hero stage is not wired (rail, replica meshes, shell material, table and lens-bag markers)")
      return
    }
    const camProvider = WorldCameraFinderProvider.getInstance()
    // World Query needs its depth running before a launch asks for the table: start it now.
    this.surveyor = new TableSurveyor((s) => print("Cutaway: " + s))
    this.surface = this.fallbackSurface()
    this.hero = new CameraHero({
      parent: this.sceneObject,
      glowMat: this.glowMaterial,
      shellMat: this.replicaShellMaterial,
      solidMat: this.heroSolidMaterial ?? null,
      bodyMesh: this.replicaBodyMesh,
      lensMesh: this.replicaLensMesh,
      labels: this.labelsUI,
      rail: this.heroUI,
      camPos: () => this.camPos(),
      camera: camProvider.getComponent(),
      realBounds: () => this.cameraUI.getBounds(),
      realFacing: this.cameraFacing,
      surface: () => this.surface,
      survey: (done) => {
        const fb = this.fallbackSurface()
        this.surface = fb
        this.surveyor.survey(this.pos(this.tableMarker), fb, (s) => {
          this.surface = s
          done(s)
        })
      },
      matter: this.heroMatter ?? null,
      bag: () => this.pos(this.lensBagMarker),
      sound: (s, p) => {
        const a = this.heroAudio(s)
        if (a) this.playAt("hero_" + s, a, p)
        else this.soundLog.push({name: "hero_" + s, time: getTime(), position: p})
      },
      moveSound: (s, p) => {
        const a = this.heroAudio(s)
        if (a) a.getSceneObject().getTransform().setWorldPosition(p)
      },
      log: (p) => this.log(p),
      caption: (text, at) => this.labelsUI.setCaption(text, at),
      avoid: () => (this.resetUI ? [this.resetUI.getCorners()] : [])
    })
    this.heroUI.onPutBack.add(() => this.hero.putBack())
    this.heroUI.onPhoto.add(() => this.hero.photo())
    this.heroUI.onPinch.add((p) => this.playAt("tick", this.tickAudio, p))
    this.cameraUI.onCloserPressed.add(() => this.launchHero())
  }

  /** The fallback table top: the inspector's height and radius at the table marker. */
  private fallbackSurface(): TableSurface {
    const m = this.pos(this.tableMarker)
    const center = new vec3(m.x, this.tableTopHeight, m.z)
    return {method: "fallback", height: this.tableTopHeight, center, radius: this.tableRadius, safeRadius: this.tableRadius, kept: 0, offCenter: 0, offHeight: this.tableTopHeight - m.y, note: ""}
  }

  /** "Bring it closer" (the camera's pill or its second question): launch the 3x replica. */
  private launchHero(): void {
    const i = this.index("camera")
    const s = this.stations[i]
    if (!this.hero || this.running) return
    if (this.hero.isOut) {
      if (s.mode === "questions") this.setMode(i, "rest")
      return
    }
    if (this.rpHero && this.rpHero.isOut) {
      this.rpHero.clear()
      this.log("hero:recordPlayerHome")
    }
    // The stage follows the camera's explanation: the camera keeps (or gets) its explained dot.
    if (!s.explained) {
      s.explained = true
      s.ui.setEnergies([ENERGY.light, ENERGY.signal])
    }
    s.armed = false
    this.setMode(i, "rest")
    s.ui.setCloser(false)
    this.phaseLog = []
    this.log("hero:start")
    this.hero.launch()
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
    // The camera's second question is the hero stage's other entry point.
    if (s.key === "camera" && q === 1 && this.hero) {
      this.launchHero()
      return
    }
    if (s.key === "recordPlayer" && q === 1 && this.rpHero) {
      this.launchRp()
      return
    }
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
    if (this.hero) this.hero.clear()
    if (this.rpHero) this.rpHero.clear()
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
      playCrackle: () => this.playAt("crackle", this.crackleAudio, this.pos(this.needleMarker)),
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
      exp = new LampExplanation(ctx, this.pos(this.lampMarker), this.pos(this.lampBaseMarker), this.pos(this.cordStartMarker), this.bulbMarker ? this.pos(this.bulbMarker) : null)
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
    const p = this.chimeAudio.getSceneObject().getTransform().getWorldPosition()
    this.chimeLog.push({time: getTime(), position: p})
    this.soundLog.push({name: "tone", time: getTime(), position: p})
    this.log("chime")
  }

  /** Play a one-shot spatial sound from `p` (its AudioComponent is moved there first). */
  private playAt(name: string, audio: AudioComponent, p: vec3): void {
    if (!audio) return
    const so = audio.getSceneObject()
    so.getTransform().setWorldPosition(p)
    if (audio.isPlaying()) audio.stop(false)
    audio.play(1)
    this.soundLog.push({name, time: getTime(), position: p})
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
    if (this.surveyor) this.surveyor.update()
    if (this.hero) this.hero.update(dt)
    if (this.rpHero) this.rpHero.update(dt)
    this.updateCloser()
    this.updateGaze()
  }

  /** The "Bring it closer" pills: under the camera / the record player once explained and idle. */
  private updateCloser(): void {
    const s = this.stations[this.index("camera")]
    if (s && s.ui.hasCloser) s.ui.setCloser(!!this.hero && s.explained && s.mode === "rest" && !this.running && !this.hero.isOut)
    const r = this.stations[this.index("recordPlayer")]
    if (r && r.ui.hasCloser) r.ui.setCloser(!!this.rpHero && r.explained && r.mode === "rest" && !this.running && !this.rpHero.isOut)
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

  /** Every one-shot sound played (tick, scan, crackle, tone), with where it came from. */
  getSoundLog(): {name: string; time: number; position: vec3}[] {
    return this.soundLog.slice()
  }

  getMarkerPosition(name: "recordPlayer" | "needle" | "speaker" | "camera" | "lamp" | "bulb"): vec3 {
    const map = {
      recordPlayer: this.recordPlayerMarker,
      needle: this.needleMarker,
      speaker: this.speakerMarker,
      camera: this.cameraMarker,
      lamp: this.lampMarker,
      bulb: this.bulbMarker ?? this.lampMarker
    }
    return this.pos(map[name])
  }

  getCameraPosition(): vec3 {
    return this.camPos()
  }

  getEffectsRootName(): string | null {
    return this.running ? this.running.root.name : null
  }

  /** The Reset pill's four world corners (layout tests). */
  getResetPillCorners(): vec3[] {
    return this.resetUI.getCorners()
  }

  /** The camera hero stage (null if it is not wired). */
  getHero(): CameraHero | null {
    return this.hero
  }

  /** Test hook: true freezes the hero stage's timeline (for screenshots of one step). */
  setHoldHero(v: boolean): void {
    if (this.hero) this.hero.hold = v
  }

  getHeroRailVisual(): {apart: boolean; focus: boolean; putBack: boolean; photo: boolean} | null {
    return this.heroUI ? this.heroUI.getVisual() : null
  }

  getTablePosition(): vec3 {
    return this.tableMarker ? this.pos(this.tableMarker) : vec3.zero()
  }

  /** The record player hero stage (null if it is not wired). */
  getRpHero(): RecordPlayerHero | null {
    return this.rpHero
  }

  getRpTone(): RpTone | null {
    return this.rpTone
  }

  getRpRail(): RpRail | null {
    return this.rpRail
  }

  /** Test hook: true freezes the record player stage's timeline (for screenshots of one step). */
  setHoldRp(v: boolean): void {
    if (this.rpHero) this.rpHero.hold = v
  }

  getRpRailVisual(): RpRailVisual | null {
    return this.rpRail ? this.rpRail.getVisual() : null
  }
}
