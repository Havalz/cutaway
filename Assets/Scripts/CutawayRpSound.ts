/**
 * Record player hero: the sound in the room while the record plays (recordplayer-hero.md §2–3).
 *
 *   At the stylus: a magnify bubble opens beside it. The groove (seen from above) scrolls under the
 *   stylus tip and wiggles side to side; the tip and its cantilever shake with it, in amber.
 *   Signal: a cyan waveform leaves the cartridge and travels along a thin thread of light, down the
 *   arm, through the plinth and across the room to the real speaker (speakerMarker).
 *   At the real speaker: the ghost cone pumps, amber rings spread into the room, and the tone plays
 *   from the speaker's own position (an Audio Output on a spatial AudioComponent there).
 *
 * Real physics, shown honestly (the Devpost page says the waves are slowed and magnified):
 *   - The rings are the real wavelength in air: one leaves the cone each (slowed) period and they
 *     travel at the (slowed) speed of sound, so their spacing is λ = 34300 / f cm. They are computed
 *     from the speaker's phase each frame (ring i at RC + λ·(i + frac)), so Pitch respaces them at once.
 *   - The groove's wiggle is its real wavelength on the record, v / f with v = 2π·r·(33⅓/60) at the
 *     stylus radius r, magnified M times in the bubble.
 *   - All motion the eye follows (the groove's scroll and wiggle, the stylus, the signal waveform,
 *     the cone and the rings) is slowed by the same factor S. The tone itself plays at f.
 * Every value is computed from (loudness, f) each frame, so a slider moves everything at once.
 */
import {DynamicRibbon, GlowPath, MeshKit, setFade, spawnMesh, Spawned, STRUCT_GLOW, TrailRibbon, UnitLine} from "./CutawayGeometry"
import {loudnessGain, RpTone, rpToneAt, rpToneShape} from "./CutawayRpTone"
import {ENERGY, ink, INK} from "./CutawayStyle"
import {clamp01, easeIn, easeOutCubic, faceToward, Pop, RibbonClock} from "./CutawayTween"

// ---------------- The two display factors (reported) and the physics ----------------

/** Slow motion: every wave the eye follows runs S times slower than the real sound. */
export const RP_S = 200
/** The bubble magnifies the groove's real wavelength on the record M times. */
export const RP_M = 120
/** Speed of sound in air (cm/s). */
export const RP_SOUND_CM_S = 34300
/** The groove's side-to-side amplitude at full loudness (cm, real; shown × M): 130 µm, a few times a loud real groove so it reads. */
export const RP_GROOVE_AMP_CM = 0.013
/** Display: the waveform's speed along the thread (cm/s) and its start after the needle touches down (s). */
export const RP_SIGNAL_CM_S = 220
export const RP_SIGNAL_DELAY_S = 1.6
/** Pitch range (Hz), log scale. */
export const RP_F_MIN = 110
export const RP_F_MAX = 880

/** Pitch slider 0..1 → f (Hz), log scale 110–880. */
export function pitchToFreq(v: number): number {
  return RP_F_MIN * Math.pow(2, 3 * clamp01(v))
}

export function freqToPitch(f: number): number {
  return Math.log(f / RP_F_MIN) / Math.log(2) / 3
}

/** The groove's real speed under the stylus at radius r (cm) at 33⅓ rpm (cm/s). */
export function grooveSpeed(r: number): number {
  return (2 * Math.PI * r * (100 / 3)) / 60
}

/** Cone excursion (cm, shown) and signal waveform height (cm) at full loudness. */
const CONE_X = 0.9
const SIG_A = 2.4
/** Rings fade out by this radius (cm). */
const RING_MAX = 380
const RING_POOL = 14
const RING_PTS = 73
/** Cone rims (cm), as in the stage-1 explanation. */
const RC = 5.6
const DC = 1.7
/** Bubble: rim radius (bubble units), the groove's line, the stylus tip. */
const R = 12
const GY = -2.5
const TIP_X = 0
const WALL = 0.45
const NEXT_DY = -3.2
const WAVE_N = 120
const FADE_S = 0.4

const AMBER = ENERGY.motion
const SIGNAL = ENERGY.signal
const ZERO = new vec4(0, 0, 0, 0)
/** How far the eye moves (cm) before the waveform and the rings turn to it again: under half a degree at arm's length. */
const EYE_EPS = 0.5
/** A whole object faces the eye again after it has moved this far (cm). */
const FACE_EPS = 0.05
const near = (a: number, b: number, eps: number) => a - b < eps && b - a < eps

export type SoundPhase = "off" | "groove" | "signal" | "sound" | "fading"

export interface RpSoundParams {
  /** 0..1 */
  loudness: number
  /** Hz */
  freq: number
  /** Platter speed / 33⅓ rpm (the groove scrolls with it). */
  speedRatio: number
  /** Stylus tip (world) and its radius on the record (cm, real record). */
  stylus: vec3
  stylusR: number
}

export interface RpSoundInfo {
  phase: SoundPhase
  /** How much of the thread the signal has covered (0..1). */
  front: number
  threadStart: vec3 | null
  threadEnd: vec3 | null
  threadLength: number
  /** Shown in the bubble (world cm): the groove's side-to-side amplitude and its wavelength. */
  grooveAmp: number
  grooveWavelength: number
  /** The signal waveform's height (cm) and its wavelength along the thread (cm). */
  signalAmp: number
  signalWavelength: number
  /** The cone's (slowed) rate (Hz) and its excursion amplitude (cm). */
  coneHz: number
  coneAmp: number
  /** The cone's current offset along its axis (cm) and its position. */
  coneOffset: number
  conePos: vec3 | null
  coneShown: boolean
  /** Rings in the air: centre and radius (cm), newest first. */
  rings: {center: vec3; radius: number}[]
  ringBrightness: number
  /** What the tone is asked to play. */
  toneFreq: number
  toneGain: number
  bubbleOpen: number
}

interface Bubble {
  node: SceneObject
  face: SceneObject
  target: vec3
  S: number
  mats: Material[]
  walls: DynamicRibbon[]
  next: DynamicRibbon
  tip: SceneObject
  tipTr: Transform
  rod: UnitLine
  leader: GlowPath | null
  /** Where each groove's points sit across the bubble (fixed: the rim clips them), and a buffer for their heights. */
  wallX: Float64Array[]
  wallY: Float64Array
  nextX: Float64Array
  nextY: Float64Array
  /** What it was last drawn from. */
  drawnK: number
  drawnStylus: vec3
  drawnEye: vec3
  drawnPh: number
  drawnA: number
  drawnKx: number
  grooveDrawn: boolean
  leaderK: number
}

export class RpSoundShow {
  private root: SceneObject | null = null
  phase: SoundPhase = "off"
  private t = 0
  private tFade = 0
  private tArrive = 0
  /** The signal's phase at the cartridge (rad): advances 2π·(f/S)·speed per second. */
  private phi = 0
  /**
   * The phase at the speaker end of the thread (rad), advanced at the same rate. Kept on its own so a
   * Pitch change (which changes the waveform's wavelength along the thread) never makes the cone or
   * the rings jump; the waveform is drawn back from it along the thread.
   */
  private psiS = 0
  private psiInit = false
  private psiArrive = 0
  private ringR = new Float64Array(RING_POOL)
  private ringN = 0
  private bubble: Bubble | null = null
  private thread: GlowPath | null = null
  private wave: TrailRibbon | null = null
  private waveHalo: TrailRibbon | null = null
  private head: SceneObject | null = null
  private headMat: Material | null = null
  private cone: SceneObject | null = null
  private conePop: Pop | null = null
  private coneMats: Material[] = []
  private axis = vec3.forward()
  private rings: TrailRibbon[] = []
  private hair = 0.1
  private lastFreq = 440
  // One direction and one side per point round every ring: they differ only by radius.
  private dirX = new Float64Array(RING_PTS)
  private dirY = new Float64Array(RING_PTS)
  private dirZ = new Float64Array(RING_PTS)
  private sideX = new Float64Array(RING_PTS)
  private sideY = new Float64Array(RING_PTS)
  private sideZ = new Float64Array(RING_PTS)
  private sideEye = new vec3(0, 0, 0)
  private sideSp = new vec3(0, 0, 0)
  private sideSet = false
  private ringPsi = NaN
  private ringBright = -1
  private ringEnv = -1
  private ringDrawnN = -1
  // The thread as plain numbers and the waveform's buffers.
  private th = {n: 0, x: new Float64Array(0), y: new Float64Array(0), z: new Float64Array(0), cum: new Float64Array(0)}
  private headSeg = 1
  private baseX = new Float64Array(WAVE_N)
  private baseY = new Float64Array(WAVE_N)
  private baseZ = new Float64Array(WAVE_N)
  private tanX = new Float64Array(WAVE_N)
  private tanY = new Float64Array(WAVE_N)
  private tanZ = new Float64Array(WAVE_N)
  private nX = new Float64Array(WAVE_N)
  private nY = new Float64Array(WAVE_N)
  private nZ = new Float64Array(WAVE_N)
  private waveS = new Float64Array(WAVE_N)
  private waveX = new Float64Array(WAVE_N)
  private waveY = new Float64Array(WAVE_N)
  private waveZ = new Float64Array(WAVE_N)
  private waveA = new Float64Array(WAVE_N)
  private waveFront = -1
  private waveEye = new vec3(0, 0, 0)
  private wavePsi = NaN
  private waveKt = 0
  private waveL = -1
  private waveEnv = -1
  private waveShown = false
  private viewX = 0
  private viewY = 0
  private viewZ = 1
  private threadFront = -1
  private threadEnv = -1
  private headEnv = -1
  private coneDrawn = NaN
  private conePos = new vec3(0, 0, 0)
  private headPos = new vec3(0, 0, 0)
  private headDir = new vec3(0, 0, 1)
  private bubbleScale = new vec3(1, 1, 1)
  private bubblePos = new vec3(0, 0, 0)
  private bubbleDir = new vec3(0, 0, 1)
  private tipPos = new vec3(0, 0, 0.1)
  private rodEnd = new vec3(0, 0, 0.1)
  // The clocks are a third of a beat apart so the ribbons don't all land on one frame.
  private ringClock = new RibbonClock(0)
  private waveClock = new RibbonClock(0.33)
  private grooveClock = new RibbonClock(0.66)
  /** At least one frame has run since it started: getInfo() reads what that frame worked out. */
  private ran = false
  private f = {freq: 0, stylusR: 0, loudness: 0, front: 0, Ltot: 0, kt: 1, coneAmp: 0, coneOffset: 0, bright: 0, toneF: 0, toneG: 0}
  private empty: RpSoundInfo = this.emptyInfo()

  constructor(
    private parent: SceneObject,
    private glowMat: Material,
    private camPos: () => vec3,
    private speaker: () => vec3,
    private tone: RpTone,
    private cb: {log: (p: string) => void; caption: (stage: number) => void}
  ) {}

  get isOn(): boolean {
    return this.phase !== "off"
  }

  get sounding(): boolean {
    return this.phase === "sound"
  }

  /** Read-only state, worked out when asked for (the frames don't need it). */
  getInfo(): RpSoundInfo {
    if (!this.ran || !this.thread) return this.empty
    const f = this.f
    const sp = this.speaker()
    const rings: {center: vec3; radius: number}[] = []
    for (let i = 0; i < this.ringN; i++) rings.push({center: sp, radius: this.ringR[i]})
    const L = f.loudness
    const lam = grooveSpeed(f.stylusR) / Math.max(1, f.freq)
    return {
      phase: this.phase,
      front: f.Ltot > 0 ? f.front / f.Ltot : 0,
      threadStart: this.thread.pointAt(0),
      threadEnd: this.thread.pointAt(1),
      threadLength: f.Ltot,
      grooveAmp: L * RP_GROOVE_AMP_CM * RP_M,
      grooveWavelength: lam * RP_M,
      signalAmp: L * SIG_A,
      signalWavelength: (2 * Math.PI) / f.kt,
      coneHz: f.toneF / RP_S,
      coneAmp: f.coneAmp,
      coneOffset: f.coneOffset,
      conePos: this.cone ? this.cone.getTransform().getWorldPosition() : null,
      coneShown: !!this.conePop && this.conePop.isShown,
      rings,
      ringBrightness: f.bright,
      toneFreq: f.toneF,
      toneGain: f.toneG,
      bubbleOpen: this.bubbleOpen()
    }
  }

  // =====================================================================================
  // Start / stop
  // =====================================================================================

  /** The needle is on the record: open the bubble now; the signal leaves the cartridge shortly. */
  start(threadPts: vec3[], stylus: vec3): void {
    this.clear()
    const root = global.scene.createSceneObject("RpSound")
    root.setParent(this.parent)
    root.getTransform().setLocalPosition(vec3.zero())
    this.root = root
    this.phase = "groove"
    this.t = 0
    this.phi = 0
    this.psiS = 0
    this.psiInit = false
    this.psiArrive = 0
    this.ringN = 0
    this.buildBubble(stylus)
    this.buildThread(threadPts)
    this.buildCone()
    this.buildRings()
    this.cb.caption(1)
    this.cb.log("rp:bubble")
  }

  /** The needle left the record: the tone stops, the signal fades and the bubble closes. */
  stop(): void {
    if (this.phase === "off" || this.phase === "fading") return
    this.phase = "fading"
    this.tFade = this.t
    this.tone.set(this.lastFreq, 0)
    if (this.conePop) this.conePop.show(false)
    this.cb.log("rp:soundStop")
  }

  /** A slider moved: apply the new values now (same frame), without advancing time. */
  refresh(p: RpSoundParams): void {
    this.update(0, p)
  }

  /** Remove everything at once (Reset). */
  clear(): void {
    if (this.root) this.root.destroy()
    this.root = null
    this.bubble = null
    this.thread = null
    this.wave = null
    this.waveHalo = null
    this.head = null
    this.cone = null
    this.conePop = null
    this.coneMats = []
    this.rings = []
    this.ringN = 0
    this.phase = "off"
    this.tone.stop()
    this.ran = false
    this.sideSet = false
    this.ringPsi = NaN
    this.ringBright = -1
    this.ringEnv = -1
    this.ringDrawnN = -1
    this.headSeg = 1
    this.waveFront = -1
    this.wavePsi = NaN
    this.waveL = -1
    this.waveEnv = -1
    this.waveShown = false
    this.threadFront = -1
    this.threadEnv = -1
    this.headEnv = -1
    this.coneDrawn = NaN
  }

  // =====================================================================================
  // Per frame
  // =====================================================================================

  update(dt: number, p: RpSoundParams): void {
    if (this.phase === "off" || !this.root) return
    this.lastFreq = p.freq
    this.t += dt
    const L = clamp01(p.loudness)
    const fS = p.freq / RP_S
    const omega = 2 * Math.PI * fS * p.speedRatio
    this.phi += omega * dt
    this.psiS += omega * dt
    let env = 1
    if (this.phase === "fading") {
      env = 1 - clamp01((this.t - this.tFade) / FADE_S)
      if (env <= 0) {
        this.clear()
        return
      }
    }
    const cam = this.camPos()
    const now = getTime()
    this.updateBubble(p, L, env, cam, now)

    // ---------------- Signal along the thread ----------------
    const v = RP_SIGNAL_CM_S
    const Ltot = this.thread ? this.thread.length : 0
    const tSig = this.t - RP_SIGNAL_DELAY_S
    if (tSig >= 0 && this.phase === "groove") {
      this.phase = "signal"
      this.cb.caption(2)
      this.cb.log("rp:signal")
    }
    const front = tSig <= 0 ? 0 : Math.min(Ltot, v * tSig)
    const kt = (2 * Math.PI * fS) / v
    if (!this.psiInit) {
      // The speaker end lags the cartridge by the thread's length in waves.
      this.psiS = this.phi - kt * Ltot
      this.psiInit = true
    }
    if (this.thread) {
      if (front !== this.threadFront) {
        this.threadFront = front
        this.thread.setRange(0, Ltot > 0 ? front / Ltot : 0)
      }
      if (env !== this.threadEnv) {
        this.threadEnv = env
        setFade(this.thread.mat, env)
      }
    }
    this.updateWave(front, Ltot, kt, L, env, cam, now)
    if (this.phase === "signal" && front >= Ltot - 1e-3) {
      this.phase = "sound"
      this.tArrive = this.t
      this.psiArrive = this.psiS
      if (this.conePop) this.conePop.show(true)
      this.tone.start()
      this.cb.caption(3)
      this.cb.log("rp:soundArrived")
    }

    // ---------------- At the speaker: the cone, the rings, the tone ----------------
    // The cone moves with the waveform's value where the thread ends (in step with it).
    const psi = this.psiS
    const soundOn = this.phase === "sound" || (this.phase === "fading" && this.tArrive > 0)
    const sEnv = soundOn ? clamp01((this.t - this.tArrive) / 0.25) * env : 0
    const coneAmp = L * CONE_X
    const coneOffset = coneAmp * sEnv * rpToneShape(psi)
    const sp = this.speaker()
    if (this.cone) {
      if (coneOffset !== this.coneDrawn || sp.x !== this.conePos.x - this.axis.x * coneOffset) {
        this.coneDrawn = coneOffset
        const c = this.conePos
        c.x = sp.x + this.axis.x * coneOffset
        c.y = sp.y + this.axis.y * coneOffset
        c.z = sp.z + this.axis.z * coneOffset
        this.cone.getTransform().setLocalPosition(c)
      }
      if (this.conePop) this.conePop.update(dt)
    }
    // The tone: the record's frequency at the platter's speed, louder with Loudness.
    const toneF = p.freq * Math.max(0.05, p.speedRatio)

    // Rings: one left the cone at each whole cycle of the speaker's phase since the sound arrived;
    // the one born k cycles ago is k + frac wavelengths out, λ = c / f (the real wavelength in air).
    // They travel at (c/S) and the spacing follows Pitch in the same frame.
    let ringN = 0
    if (soundOn) {
      const lam = RP_SOUND_CM_S / toneF
      const cyc = psi / (Math.PI * 2)
      const m0 = Math.floor(cyc)
      const fr = cyc - m0
      const first = Math.ceil(this.psiArrive / (Math.PI * 2) - 1e-9)
      for (let i = 0; i < RING_POOL && m0 - i >= first; i++) {
        const r = RC + lam * (fr + i)
        if (r >= RING_MAX) break
        this.ringR[ringN++] = r
      }
    }
    this.ringN = ringN
    const bright = 0.3 + 0.7 * L
    if (this.ringClock.due(now)) this.updateRings(sp, bright, env, cam)
    const toneG = this.phase === "sound" ? loudnessGain(L) * sEnv : 0
    if (this.phase === "sound") this.tone.set(toneF, toneG)
    if (this.phase === "fading") this.tone.set(toneF, 0)

    // ---------------- For getInfo() ----------------
    const f = this.f
    f.freq = p.freq
    f.stylusR = p.stylusR
    f.loudness = L
    f.front = front
    f.Ltot = Ltot
    f.kt = kt
    f.coneAmp = coneAmp
    f.coneOffset = coneOffset
    f.bright = bright
    f.toneF = toneF
    f.toneG = toneG
    this.ran = true
  }

  // =====================================================================================
  // Bubble
  // =====================================================================================

  private hairAt(p: vec3): number {
    return 0.085 * Math.max(0.5, p.distance(this.camPos()) / 110)
  }

  private node(name: string, parent: SceneObject, pos: vec3 = vec3.zero()): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(pos)
    return so
  }

  private glow(parent: SceneObject, name: string, kit: MeshKit, twoSided: boolean = true): Spawned {
    const s = spawnMesh(parent, name, kit.build(), this.glowMat)
    s.mat.mainPass.twoSided = twoSided
    return s
  }

  private buildBubble(stylus: vec3): void {
    const cam = this.camPos()
    const up = vec3.up()
    const toUser = flat(cam.sub(stylus))
    const right = toUser.uniformScale(-1).cross(up).normalize()
    const S = Math.min(1.8, Math.max(1, cam.distance(stylus) / 320))
    // Up and to the left of the stylus (the rail and its captions are on the right).
    const target = stylus.add(up.uniformScale(R * S + 6)).add(right.uniformScale(-R * S * 0.55)).add(toUser.uniformScale(6))
    const node = this.node("RpBubble", this.root, stylus)
    node.getTransform().setLocalScale(vec3.one().uniformScale(1e-4))
    const face = this.node("RpBubbleFace", node)
    face.getTransform().setLocalScale(vec3.one().uniformScale(S))
    const mats: Material[] = []
    const fk = new MeshKit()
    fk.addArcXY(0, 0, R, 0.2, 0, Math.PI * 2, ink(INK, 0.85), 96)
    fk.addArcXY(0, 0, R - 0.55, 0.1, 0, Math.PI * 2, ink(INK, 0.4), 96)
    fk.addFanXY(0, 0, 8, 0, Math.PI * 2, ink(INK, 0.02), ink(INK, 0.03), 48)
    fk.addSoftRingXY(0, 0, 8, R - 0.6, ink(INK, 0.03), ink(INK, 0.1), 64)
    mats.push(this.glow(face, "RpBubbleFrame", fk).mat)
    // The cartridge's underside above the groove (structure, faint), where the cantilever goes in.
    const ck = new MeshKit(STRUCT_GLOW)
    ck.addPolylineXY([new vec2(-4.5, 3.2), new vec2(6.5, 3.2), new vec2(6.5, 7.5), new vec2(-4.5, 7.5), new vec2(-4.5, 3.2)], 0.1, ink(INK, 0.45))
    mats.push(this.glow(face, "RpBubbleCartridge", ck).mat)
    const walls: DynamicRibbon[] = []
    for (let i = 0; i < 2; i++) {
      const w = new DynamicRibbon(face, "RpGrooveWall", this.glowMat, 48, 0.2, ink(AMBER, 0.95))
      w.mat.mainPass.twoSided = true
      mats.push(w.mat)
      walls.push(w)
    }
    const next = new DynamicRibbon(face, "RpGrooveNext", this.glowMat, 40, 0.14, ink(AMBER, 0.3))
    next.mat.mainPass.twoSided = true
    mats.push(next.mat)
    const tip = this.node("RpBubbleTip", face)
    const tk = new MeshKit(1.5)
    tk.addSparkXY(0, 0, 0.34, ink(AMBER, 1))
    tk.addArcXY(0, 0, 0.85, 0.1, 0, Math.PI * 2, ink(AMBER, 0.6), 28)
    mats.push(this.glow(tip, "RpBubbleTipMesh", tk).mat)
    const rodKit = new MeshKit(1.6)
    rodKit.addLineXY(0, 0.17, 1, 0.17, 0.08, ink(AMBER, 0.9))
    rodKit.addLineXY(0, -0.17, 1, -0.17, 0.08, ink(AMBER, 0.9))
    rodKit.addRectXY(0, -0.13, 1, 0.13, ink(AMBER, 0.14))
    const rod = new UnitLine(face, "RpCantilever", this.glowMat, 0, AMBER, 0, undefined, rodKit)
    rod.mat.mainPass.twoSided = true
    mats.push(rod.mat)
    for (const m of mats) setFade(m, 0)
    const clipX = (y: number) => Math.sqrt(Math.max(0, (R - 0.9) * (R - 0.9) - y * y))
    const across = (n: number, half: number) => {
      const a = new Float64Array(n)
      for (let j = 0; j < n; j++) a[j] = -half + (2 * half * j) / (n - 1)
      return a
    }
    this.bubble = {
      node,
      face,
      target,
      S,
      mats,
      walls,
      next,
      tip,
      tipTr: tip.getTransform(),
      rod,
      leader: null,
      wallX: [across(48, clipX(GY + WALL)), across(48, clipX(GY - WALL))],
      wallY: new Float64Array(48),
      nextX: across(40, clipX(GY + NEXT_DY)),
      nextY: new Float64Array(40),
      drawnK: -1,
      drawnStylus: new vec3(0, 0, 0),
      drawnEye: new vec3(0, 0, 0),
      drawnPh: NaN,
      drawnA: -1,
      drawnKx: 0,
      grooveDrawn: false,
      leaderK: -1
    }
  }

  private bubbleOpen(): number {
    if (!this.bubble) return 0
    const open = easeOutCubic(this.t / 0.3)
    if (this.phase !== "fading") return open
    return open * (1 - easeIn((this.t - this.tFade) / 0.22))
  }

  private updateBubble(p: RpSoundParams, L: number, env: number, cam: vec3, now: number): void {
    const b = this.bubble
    if (!b) return
    const k = this.bubbleOpen()
    const st = p.stylus
    const ds = b.drawnStylus
    const de = b.drawnEye
    if (k !== b.drawnK || !near(st.x, ds.x, 0.005) || !near(st.y, ds.y, 0.005) || !near(st.z, ds.z, 0.005) || !near(cam.x, de.x, FACE_EPS) || !near(cam.y, de.y, FACE_EPS) || !near(cam.z, de.z, FACE_EPS)) {
      ds.x = st.x
      ds.y = st.y
      ds.z = st.z
      de.x = cam.x
      de.y = cam.y
      de.z = cam.z
      const tr = b.node.getTransform()
      const sc = Math.max(1e-4, k)
      const bs = this.bubbleScale
      bs.x = sc
      bs.y = sc
      bs.z = sc
      tr.setLocalScale(bs)
      const bp = this.bubblePos
      const tg = b.target
      bp.x = st.x + (tg.x - st.x) * k
      bp.y = st.y + (tg.y - st.y) * k
      bp.z = st.z + (tg.z - st.z) * k
      tr.setLocalPosition(bp)
      const w = tr.getWorldPosition()
      const bd = this.bubbleDir
      bd.x = cam.x - w.x
      bd.y = cam.y - w.y
      bd.z = cam.z - w.z
      b.face.getTransform().setWorldRotation(faceToward(bd))
      if (k !== b.drawnK) for (let i = 0; i < b.mats.length; i++) setFade(b.mats[i], k)
      b.drawnK = k
    }
    if (this.grooveClock.due(now) || !b.grooveDrawn) this.drawGroove(b, p, L)
    // A hairline from the stylus to the bubble's rim, once it is open.
    if (!b.leader && this.t > 0.32 && this.root) {
      const rim = b.target.add(p.stylus.sub(b.target).normalize().uniformScale(R * b.S))
      const hair = this.hairAt(p.stylus)
      b.leader = new GlowPath(this.root, "RpBubbleLeader", this.glowMat, [p.stylus, rim], {radius: hair * 0.6, color: ink(INK, 0.5), halo: hair * 1.5, step: 3, eye: cam})
      b.leader.setRange(0, 0)
    }
    if (b.leader) {
      const lk = easeOutCubic((this.t - 0.32) / 0.25) * (this.phase === "fading" ? k : 1)
      if (lk !== b.leaderK) {
        b.leaderK = lk
        b.leader.setRange(0, lk > 0.01 ? lk : 0)
      }
      if (env !== this.headEnv) {
        this.headEnv = env
        setFade(b.leader.mat, env)
      }
    }
  }

  /** The groove in bubble units: its real wavelength on the record × M, its amplitude × M. Only when it has moved. */
  private drawGroove(b: Bubble, p: RpSoundParams, L: number): void {
    const lamWorld = (grooveSpeed(p.stylusR) / Math.max(1, p.freq)) * RP_M
    const kx = (2 * Math.PI * b.S) / Math.max(1e-3, lamWorld)
    const A = (L * RP_GROOVE_AMP_CM * RP_M) / b.S
    // It scrolls under the tip at the (slowed) groove speed: the tip shakes at f / S.
    const ph = this.phi
    if (b.grooveDrawn && ph === b.drawnPh && A === b.drawnA && kx === b.drawnKx) return
    b.grooveDrawn = true
    b.drawnPh = ph
    b.drawnA = A
    b.drawnKx = kx
    for (let i = 0; i < 2; i++) {
      const off = i === 0 ? WALL : -WALL
      const xs = b.wallX[i]
      const ys = b.wallY
      for (let j = 0; j < 48; j++) ys[j] = GY + A * rpToneAt(kx * xs[j] + ph) + off
      b.walls[i].writeXY(xs, ys, 0.05)
    }
    const nx = b.nextX
    const ny = b.nextY
    for (let j = 0; j < 40; j++) ny[j] = GY + NEXT_DY + A * rpToneAt(kx * nx[j] + ph + 2.1)
    b.next.writeXY(nx, ny, 0.05)
    const tipY = GY + A * rpToneAt(kx * TIP_X + ph)
    const tp = this.tipPos
    tp.x = TIP_X
    tp.y = tipY
    tp.z = 0.1
    b.tipTr.setLocalPosition(tp)
    // The cantilever pivots in the cartridge: its far end moves less.
    const re = this.rodEnd
    re.x = 2.6
    re.y = 3.2 + 0.25 * (tipY - GY)
    re.z = 0.1
    b.rod.set(tp, re)
  }

  // =====================================================================================
  // Signal thread
  // =====================================================================================

  private buildThread(pts: vec3[]): void {
    const cam = this.camPos()
    const mid = pts[Math.floor(pts.length / 2)]
    this.hair = this.hairAt(mid)
    const hair = this.hair
    this.thread = new GlowPath(this.root, "RpThread", this.glowMat, pts, {radius: hair * 0.9, color: ink(SIGNAL, 0.55), halo: hair * 3.5, step: 2, eye: cam})
    this.thread.setRange(0, 0)
    this.th = this.thread.flatPoints()
    this.wave = new TrailRibbon(this.root, "RpSignalWave", this.glowMat, WAVE_N, hair * 2.4, ink(SIGNAL, 1))
    this.waveHalo = new TrailRibbon(this.root, "RpSignalWaveGlow", this.glowMat, WAVE_N, hair * 8, ink(SIGNAL, 0.2))
    this.wave.setVisible(false)
    this.waveHalo.setVisible(false)
    const head = this.node("RpSignalHead", this.root)
    const hk = new MeshKit()
    hk.addSparkXY(0, 0, hair * 1.7, ink(SIGNAL, 1))
    const hm = this.glow(head, "RpSignalHeadMesh", hk)
    this.headMat = hm.mat
    head.enabled = false
    this.head = head
  }

  private updateWave(front: number, Ltot: number, kt: number, L: number, env: number, cam: vec3, now: number): void {
    if (!this.thread || !this.wave || !this.waveHalo) return
    if (front <= 0.5 || Ltot <= 0) {
      this.wave.setVisible(false)
      this.waveHalo.setVisible(false)
      if (this.head) this.head.enabled = false
      return
    }
    if (this.head) {
      const travelling = front < Ltot - 0.5 && this.phase !== "fading"
      if (travelling !== this.head.enabled) this.head.enabled = travelling
      if (travelling) {
        this.placeHead(front, cam)
        if (this.headMat) setFade(this.headMat, env)
      }
    }
    const due = this.waveClock.due(now)
    if (!due && this.waveShown) return
    this.waveShown = true
    this.wave.setVisible(true)
    this.waveHalo.setVisible(true)
    const e = this.waveEye
    const moved = front !== this.waveFront
    const faced = !moved && near(cam.x, e.x, EYE_EPS) && near(cam.y, e.y, EYE_EPS) && near(cam.z, e.z, EYE_EPS)
    const psi = this.psiS
    if (faced && psi === this.wavePsi && kt === this.waveKt && L === this.waveL && env === this.waveEnv) return
    if (moved) this.sampleThread(front, Ltot)
    if (!faced) this.faceWave(cam)
    const shown = moved || env !== this.waveEnv
    this.waveFront = front
    this.wavePsi = psi
    this.waveKt = kt
    this.waveL = L
    this.waveEnv = env
    const amp = L * SIG_A
    for (let j = 0; j < WAVE_N; j++) {
      const s = this.waveS[j]
      // Small along the arm, full height once it is out of the deck.
      const grow = 0.5 + 0.5 * clamp01(s / 60)
      const h = amp * grow * rpToneAt(psi + kt * (Ltot - s))
      this.waveX[j] = this.baseX[j] + this.nX[j] * h
      this.waveY[j] = this.baseY[j] + this.nY[j] * h
      this.waveZ[j] = this.baseZ[j] + this.nZ[j] * h
      if (shown) this.waveA[j] = env * clamp01((front - s) / 6 + 0.15) * clamp01(s / 3 + 0.2)
    }
    this.wave.writeFlat(this.waveX, this.waveY, this.waveZ, this.viewX, this.viewY, this.viewZ, this.waveA)
    this.waveHalo.writeFlat(this.waveX, this.waveY, this.waveZ, this.viewX, this.viewY, this.viewZ, this.waveA)
  }

  /** Only the part of the thread the signal has reached carries the wave: its points and directions, walking along it once. */
  private sampleThread(front: number, Ltot: number): void {
    const th = this.th
    const cum = th.cum
    let at = 1
    let hi = 1
    let lo = 1
    const last = th.n - 1
    for (let j = 0; j < WAVE_N; j++) {
      const s = (front * j) / (WAVE_N - 1)
      this.waveS[j] = s
      const f = s / Ltot
      const l = Math.max(0, Math.min(1, f)) * Ltot
      const lh = Math.min(1, f + 0.004) * Ltot
      const ll = Math.max(0, f - 0.004) * Ltot
      while (at < last && cum[at] < l) at++
      while (hi < last && cum[hi] < lh) hi++
      while (lo < last && cum[lo] < ll) lo++
      const seg = cum[at] - cum[at - 1]
      const t = seg > 1e-6 ? (l - cum[at - 1]) / seg : 0
      this.baseX[j] = th.x[at - 1] + (th.x[at] - th.x[at - 1]) * t
      this.baseY[j] = th.y[at - 1] + (th.y[at] - th.y[at - 1]) * t
      this.baseZ[j] = th.z[at - 1] + (th.z[at] - th.z[at - 1]) * t
      const sh = cum[hi] - cum[hi - 1]
      const th1 = sh > 1e-6 ? (lh - cum[hi - 1]) / sh : 0
      const sl = cum[lo] - cum[lo - 1]
      const th0 = sl > 1e-6 ? (ll - cum[lo - 1]) / sl : 0
      this.tanX[j] = th.x[hi - 1] + (th.x[hi] - th.x[hi - 1]) * th1 - (th.x[lo - 1] + (th.x[lo] - th.x[lo - 1]) * th0)
      this.tanY[j] = th.y[hi - 1] + (th.y[hi] - th.y[hi - 1]) * th1 - (th.y[lo - 1] + (th.y[lo] - th.y[lo - 1]) * th0)
      this.tanZ[j] = th.z[hi - 1] + (th.z[hi] - th.z[hi - 1]) * th1 - (th.z[lo - 1] + (th.z[lo] - th.z[lo - 1]) * th0)
    }
  }

  /** Which way the waveform swings at each point (upward, across the thread as the eye sees it), and the ribbon's facing. */
  private faceWave(cam: vec3): void {
    const e = this.waveEye
    e.x = cam.x
    e.y = cam.y
    e.z = cam.z
    for (let j = 0; j < WAVE_N; j++) {
      let vx = cam.x - this.baseX[j]
      let vy = cam.y - this.baseY[j]
      let vz = cam.z - this.baseZ[j]
      const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (vl > 1e-9) {
        vx /= vl
        vy /= vl
        vz /= vl
      }
      const tx = this.tanX[j]
      const ty = this.tanY[j]
      const tz = this.tanZ[j]
      let nx = ty * vz - tz * vy
      let ny = tz * vx - tx * vz
      let nz = tx * vy - ty * vx
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz)
      if (nl > 1e-5) {
        nx /= nl
        ny /= nl
        nz /= nl
      } else {
        nx = 0
        ny = 1
        nz = 0
      }
      if (ny < 0) {
        nx = -nx
        ny = -ny
        nz = -nz
      }
      this.nX[j] = nx
      this.nY[j] = ny
      this.nZ[j] = nz
    }
    const mid = this.thread ? this.thread.pointAt(0.5) : cam
    let vx = cam.x - mid.x
    let vy = cam.y - mid.y
    let vz = cam.z - mid.z
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
    if (vl > 1e-9) {
      vx /= vl
      vy /= vl
      vz /= vl
    }
    this.viewX = vx
    this.viewY = vy
    this.viewZ = vz
  }

  /** The bright head at the signal's front while it travels. */
  private placeHead(front: number, cam: vec3): void {
    if (!this.head) return
    const th = this.th
    const cum = th.cum
    const last = th.n - 1
    let at = this.headSeg
    while (at > 1 && cum[at - 1] >= front) at--
    while (at < last && cum[at] < front) at++
    this.headSeg = at
    const seg = cum[at] - cum[at - 1]
    const t = seg > 1e-6 ? (front - cum[at - 1]) / seg : 0
    const x = th.x[at - 1] + (th.x[at] - th.x[at - 1]) * t
    const y = th.y[at - 1] + (th.y[at] - th.y[at - 1]) * t
    const z = th.z[at - 1] + (th.z[at] - th.z[at - 1]) * t
    const d = this.headDir
    d.x = cam.x - x
    d.y = cam.y - y
    d.z = cam.z - z
    const l = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z)
    const off = l > 1e-9 ? 0.3 / l : 0
    const hp = this.headPos
    hp.x = x + d.x * off
    hp.y = y + d.y * off
    hp.z = z + d.z * off
    const tr = this.head.getTransform()
    tr.setLocalPosition(hp)
    tr.setWorldRotation(faceToward(d))
  }

  // =====================================================================================
  // Cone and rings
  // =====================================================================================

  private buildCone(): void {
    const sp = this.speaker()
    const cam = this.camPos()
    this.axis = flat(cam.sub(sp))
    const node = this.node("RpCone", this.root, sp)
    const shape = this.node("RpConeShape", node)
    shape.getTransform().setLocalRotation(quat.lookAt(this.axis, vec3.up()))
    const hair = this.hairAt(sp)
    const ck = new MeshKit()
    ck.addArcXY(0, 0, RC, hair * 2, 0, Math.PI * 2, ink(AMBER, 0.95), 64)
    ck.addSoftRingXY(0, 0, RC, RC + 1.6, ink(AMBER, 0.28), ZERO, 64)
    ck.addArcXY(0, 0, DC, hair * 1.8, 0, Math.PI * 2, ink(AMBER, 0.9), 32)
    ck.addFanXY(0, 0, DC, 0, Math.PI * 2, ink(AMBER, 0.12), ink(AMBER, 0.12), 24)
    this.coneMats.push(this.glow(shape, "RpConeRims", ck).mat)
    const eye = shape.getTransform().getInvertedWorldTransform().multiplyPoint(cam)
    const pk = new MeshKit(1.4, eye)
    pk.addRing(new vec3(0, 0, -0.9), vec3.forward(), 3.7, hair * 1.2, ink(AMBER, 0.35), 48)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const c = Math.cos(a)
      const d = Math.sin(a)
      pk.addTube([new vec3(c * DC, d * DC, -1.8), new vec3(c * RC, d * RC, 0)], hair * 0.7, ink(AMBER, 0.35), 4, 20)
    }
    this.coneMats.push(this.glow(shape, "RpConeProfile", pk, false).mat)
    this.cone = node
    this.conePop = new Pop(node, vec3.one(), false)
    // Round every ring: the same directions (the axis is fixed for the whole play).
    const u = this.axis.cross(vec3.up()).normalize()
    const v = u.cross(this.axis).normalize()
    for (let j = 0; j < RING_PTS; j++) {
      const a = (j / (RING_PTS - 1)) * Math.PI * 2
      const c = Math.cos(a)
      const d = Math.sin(a)
      this.dirX[j] = u.x * c + v.x * d
      this.dirY[j] = u.y * c + v.y * d
      this.dirZ[j] = u.z * c + v.z * d
    }
  }

  private buildRings(): void {
    const w = this.hairAt(this.speaker()) * 2.2
    for (let i = 0; i < RING_POOL; i++) {
      const r = new TrailRibbon(this.root, "RpRing" + i, this.glowMat, RING_PTS, w, ink(AMBER, 0.9))
      r.setVisible(false)
      this.rings.push(r)
    }
  }

  private updateRings(center: vec3, bright: number, env: number, cam: vec3): void {
    const e = this.sideEye
    const c = this.sideSp
    const turned = !this.sideSet || !near(cam.x, e.x, EYE_EPS) || !near(cam.y, e.y, EYE_EPS) || !near(cam.z, e.z, EYE_EPS) || !near(center.x, c.x, FACE_EPS) || !near(center.y, c.y, FACE_EPS) || !near(center.z, c.z, FACE_EPS)
    const psi = this.psiS
    const n = Math.min(this.ringN, this.rings.length)
    if (!turned && psi === this.ringPsi && bright === this.ringBright && env === this.ringEnv && n === this.ringDrawnN) return
    if (turned) this.faceRings(center, cam)
    this.ringPsi = psi
    this.ringBright = bright
    this.ringEnv = env
    this.ringDrawnN = n
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i]
      if (i >= n) {
        ring.setVisible(false)
        continue
      }
      const radius = this.ringR[i]
      // Fades in as it leaves the cone's rim, out toward RING_MAX.
      const a = bright * env * Math.pow(1 - clamp01(radius / RING_MAX), 1.5) * clamp01((radius - RC) / 5 + 0.1)
      ring.setVisible(true)
      ring.writeCircle(c.x, c.y, c.z, radius, this.dirX, this.dirY, this.dirZ, this.sideX, this.sideY, this.sideZ, a)
    }
  }

  /** The sides of the rings: each point's way along the circle × the way to the eye. */
  private faceRings(center: vec3, cam: vec3): void {
    const e = this.sideEye
    const c = this.sideSp
    e.x = cam.x
    e.y = cam.y
    e.z = cam.z
    c.x = center.x
    c.y = center.y
    c.z = center.z
    this.sideSet = true
    let vx = cam.x - center.x
    let vy = cam.y - center.y
    let vz = cam.z - center.z
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
    if (vl > 1e-9) {
      vx /= vl
      vy /= vl
      vz /= vl
    }
    const last = RING_PTS - 1
    for (let j = 0; j <= last; j++) {
      const a = j > 0 ? j - 1 : 0
      const b = j < last ? j + 1 : last
      const tx = this.dirX[b] - this.dirX[a]
      const ty = this.dirY[b] - this.dirY[a]
      const tz = this.dirZ[b] - this.dirZ[a]
      let sx = ty * vz - tz * vy
      let sy = tz * vx - tx * vz
      let sz = tx * vy - ty * vx
      const l = Math.sqrt(sx * sx + sy * sy + sz * sz)
      if (l > 1e-6) {
        sx /= l
        sy /= l
        sz /= l
      } else {
        sx = 0
        sy = 1
        sz = 0
      }
      this.sideX[j] = sx
      this.sideY[j] = sy
      this.sideZ[j] = sz
    }
  }

  private emptyInfo(): RpSoundInfo {
    return {
      phase: "off",
      front: 0,
      threadStart: null,
      threadEnd: null,
      threadLength: 0,
      grooveAmp: 0,
      grooveWavelength: 0,
      signalAmp: 0,
      signalWavelength: 0,
      coneHz: 0,
      coneAmp: 0,
      coneOffset: 0,
      conePos: null,
      coneShown: false,
      rings: [],
      ringBrightness: 0,
      toneFreq: 0,
      toneGain: 0,
      bubbleOpen: 0
    }
  }
}

function flat(v: vec3): vec3 {
  const f = new vec3(v.x, 0, v.z)
  return f.length > 1e-4 ? f.normalize() : new vec3(0, 0, 1)
}


