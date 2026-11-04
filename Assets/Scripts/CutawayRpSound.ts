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
 *   - The rings are the real wavelength in air: they leave the cone once per (slowed) period and
 *     travel at the (slowed) speed of sound, so their spacing is exactly λ = 34300 / f cm.
 *   - The groove's wiggle is its real wavelength on the record, v / f with v = 2π·r·(33⅓/60) at the
 *     stylus radius r, magnified M times in the bubble.
 *   - All motion the eye follows (the groove's scroll and wiggle, the stylus, the signal waveform,
 *     the cone and the rings) is slowed by the same factor S. The tone itself plays at f.
 * Every value is computed from (loudness, f) each frame, so a slider moves everything at once.
 */
import {DynamicRibbon, GlowPath, MeshKit, setFade, spawnMesh, Spawned, STRUCT_GLOW, TrailRibbon, UnitLine} from "./CutawayGeometry"
import {loudnessGain, RpTone, rpToneShape} from "./CutawayRpTone"
import {ENERGY, ink, UI_WHITE} from "./CutawayStyle"
import {clamp01, easeIn, easeOutCubic, faceToward, Pop} from "./CutawayTween"

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
  /** The signal waveform's height (cm) and the cone's excursion amplitude (cm). */
  signalAmp: number
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
  rod: UnitLine
  leader: GlowPath | null
}

export class RpSoundShow {
  private root: SceneObject | null = null
  phase: SoundPhase = "off"
  private t = 0
  private tFade = 0
  private tArrive = 0
  /** The signal's phase at the cartridge (rad): advances 2π·(f/S)·speed per second. */
  private phi = 0
  private psiPrev = 0
  private births: number[] = []
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
  private last: RpSoundParams | null = null
  private info: RpSoundInfo = this.emptyInfo()

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

  getInfo(): RpSoundInfo {
    return this.info
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
    this.psiPrev = 0
    this.births = []
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
    this.tone.set(this.last ? this.last.freq : 440, 0)
    if (this.conePop) this.conePop.show(false)
    this.cb.log("rp:soundStop")
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
    this.births = []
    this.phase = "off"
    this.tone.stop()
    this.info = this.emptyInfo()
  }

  // =====================================================================================
  // Per frame
  // =====================================================================================

  update(dt: number, p: RpSoundParams): void {
    if (this.phase === "off" || !this.root) return
    this.last = p
    this.t += dt
    const L = clamp01(p.loudness)
    const fS = p.freq / RP_S
    const omega = 2 * Math.PI * fS * p.speedRatio
    this.phi += omega * dt
    let env = 1
    if (this.phase === "fading") {
      env = 1 - clamp01((this.t - this.tFade) / FADE_S)
      if (env <= 0) {
        this.clear()
        return
      }
    }
    const cam = this.camPos()
    this.updateBubble(dt, p, L, env, cam)

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
    if (this.thread) {
      this.thread.setRange(0, Ltot > 0 ? front / Ltot : 0)
      setFade(this.thread.mat, env)
    }
    this.updateWave(front, Ltot, kt, L, env, cam)
    if (this.phase === "signal" && front >= Ltot - 1e-3) {
      this.phase = "sound"
      this.tArrive = this.t
      this.psiPrev = this.phi - kt * Ltot
      if (this.conePop) this.conePop.show(true)
      this.tone.start()
      this.cb.caption(3)
      this.cb.log("rp:soundArrived")
    }

    // ---------------- At the speaker: the cone, the rings, the tone ----------------
    // The cone moves with the waveform's value where the thread ends (in step with it).
    const psi = this.phi - kt * Ltot
    const soundOn = this.phase === "sound" || (this.phase === "fading" && this.tArrive > 0)
    const sEnv = soundOn ? clamp01((this.t - this.tArrive) / 0.25) * env : 0
    const coneAmp = L * CONE_X
    const coneOffset = coneAmp * sEnv * rpToneShape(psi)
    const sp = this.speaker()
    if (this.cone) {
      this.cone.getTransform().setLocalPosition(sp.add(this.axis.uniformScale(coneOffset)))
      if (this.conePop) this.conePop.update(dt)
    }
    // A ring leaves the cone each time its (slowed) cycle comes round; the exact moment within the
    // frame keeps the spacing exact: (c/S)·(S/f) = c/f.
    if (this.phase === "sound" && omega > 1e-6) {
      const twoPi = Math.PI * 2
      let k = Math.floor(this.psiPrev / twoPi) + 1
      while (k * twoPi <= psi) {
        this.births.push(this.t - (psi - k * twoPi) / omega)
        k++
      }
    }
    this.psiPrev = psi
    const cS = RP_SOUND_CM_S / RP_S
    this.births = this.births.filter((b) => RC + cS * (this.t - b) < RING_MAX)
    const bright = 0.3 + 0.7 * L
    this.updateRings(sp, cS, bright, env, cam)

    // The tone: the record's frequency at the platter's speed, louder with Loudness.
    const toneF = p.freq * Math.max(0.05, p.speedRatio)
    const toneG = this.phase === "sound" ? loudnessGain(L) * sEnv : 0
    if (this.phase === "sound") this.tone.set(toneF, toneG)
    if (this.phase === "fading") this.tone.set(toneF, 0)

    // ---------------- Read-only state ----------------
    const lam = grooveSpeed(p.stylusR) / Math.max(1, p.freq)
    this.info = {
      phase: this.phase,
      front: Ltot > 0 ? front / Ltot : 0,
      threadStart: this.thread ? this.thread.pointAt(0) : null,
      threadEnd: this.thread ? this.thread.pointAt(1) : null,
      threadLength: Ltot,
      grooveAmp: L * RP_GROOVE_AMP_CM * RP_M,
      grooveWavelength: lam * RP_M,
      signalAmp: L * SIG_A,
      coneAmp,
      coneOffset,
      conePos: this.cone ? this.cone.getTransform().getWorldPosition() : null,
      coneShown: !!this.conePop && this.conePop.isShown,
      rings: this.births
        .slice()
        .reverse()
        .map((b) => ({center: sp, radius: RC + cS * (this.t - b)})),
      ringBrightness: bright,
      toneFreq: toneF,
      toneGain: toneG,
      bubbleOpen: this.bubbleOpen()
    }
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
    fk.addArcXY(0, 0, R, 0.2, 0, Math.PI * 2, ink(UI_WHITE, 0.85), 96)
    fk.addArcXY(0, 0, R - 0.55, 0.1, 0, Math.PI * 2, ink(UI_WHITE, 0.4), 96)
    fk.addFanXY(0, 0, 8, 0, Math.PI * 2, ink(UI_WHITE, 0.02), ink(UI_WHITE, 0.03), 48)
    fk.addSoftRingXY(0, 0, 8, R - 0.6, ink(UI_WHITE, 0.03), ink(UI_WHITE, 0.1), 64)
    mats.push(this.glow(face, "RpBubbleFrame", fk).mat)
    // The cartridge's underside above the groove (structure, faint), where the cantilever goes in.
    const ck = new MeshKit(STRUCT_GLOW)
    ck.addPolylineXY([new vec2(-4.5, 3.2), new vec2(6.5, 3.2), new vec2(6.5, 7.5), new vec2(-4.5, 7.5), new vec2(-4.5, 3.2)], 0.1, ink(UI_WHITE, 0.45))
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
    this.bubble = {node, face, target, S, mats, walls, next, tip, rod, leader: null}
  }

  private bubbleOpen(): number {
    if (!this.bubble) return 0
    const open = easeOutCubic(this.t / 0.3)
    if (this.phase !== "fading") return open
    return open * (1 - easeIn((this.t - this.tFade) / 0.22))
  }

  private updateBubble(dt: number, p: RpSoundParams, L: number, env: number, cam: vec3): void {
    const b = this.bubble
    if (!b) return
    void dt
    const k = this.bubbleOpen()
    const tr = b.node.getTransform()
    tr.setLocalScale(vec3.one().uniformScale(Math.max(1e-4, k)))
    tr.setLocalPosition(vec3.lerp(p.stylus, b.target, k))
    b.face.getTransform().setWorldRotation(faceToward(cam.sub(tr.getWorldPosition())))
    for (const m of b.mats) setFade(m, k)
    // The groove in bubble units: its real wavelength on the record × M, its amplitude × M.
    const lamWorld = (grooveSpeed(p.stylusR) / Math.max(1, p.freq)) * RP_M
    const kx = (2 * Math.PI * b.S) / Math.max(1e-3, lamWorld)
    const A = (L * RP_GROOVE_AMP_CM * RP_M) / b.S
    // It scrolls under the tip at the (slowed) groove speed: the tip shakes at f / S.
    const ph = this.phi
    const gy = (x: number) => GY + A * rpToneShape(kx * x + ph)
    const clipX = (y: number) => Math.sqrt(Math.max(0, (R - 0.9) * (R - 0.9) - y * y))
    b.walls.forEach((w, i) => {
      const off = i === 0 ? WALL : -WALL
      const hc = clipX(GY + off)
      w.update((j) => {
        const x = -hc + (2 * hc * j) / 47
        return new vec3(x, gy(x) + off, 0.05)
      })
    })
    const hn = clipX(GY + NEXT_DY)
    b.next.update((j) => {
      const x = -hn + (2 * hn * j) / 39
      return new vec3(x, GY + NEXT_DY + A * rpToneShape(kx * x + ph + 2.1), 0.05)
    })
    const tipY = gy(TIP_X)
    const tipP = new vec3(TIP_X, tipY, 0.1)
    b.tip.getTransform().setLocalPosition(tipP)
    // The cantilever pivots in the cartridge: its far end moves less.
    b.rod.set(tipP, new vec3(2.6, 3.2 + 0.25 * (tipY - GY), 0.1))
    // A hairline from the stylus to the bubble's rim, once it is open.
    if (!b.leader && this.t > 0.32 && this.root) {
      const rim = b.target.add(p.stylus.sub(b.target).normalize().uniformScale(R * b.S))
      const hair = this.hairAt(p.stylus)
      b.leader = new GlowPath(this.root, "RpBubbleLeader", this.glowMat, [p.stylus, rim], {radius: hair * 0.6, color: ink(UI_WHITE, 0.5), halo: hair * 1.5, step: 3, eye: cam})
      b.leader.setRange(0, 0)
    }
    if (b.leader) {
      const lk = easeOutCubic((this.t - 0.32) / 0.25) * (this.phase === "fading" ? k : 1)
      b.leader.setRange(0, lk > 0.01 ? lk : 0)
      setFade(b.leader.mat, env)
    }
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

  private updateWave(front: number, Ltot: number, kt: number, L: number, env: number, cam: vec3): void {
    if (!this.thread || !this.wave || !this.waveHalo) return
    if (front <= 0.5 || Ltot <= 0) {
      this.wave.setVisible(false)
      this.waveHalo.setVisible(false)
      if (this.head) this.head.enabled = false
      return
    }
    const up = vec3.up()
    const pts: vec3[] = []
    const alphas: number[] = []
    // Only the part of the thread the signal has reached carries the wave.
    for (let j = 0; j < WAVE_N; j++) {
      const s = (front * j) / (WAVE_N - 1)
      const f = s / Ltot
      const base = this.thread.pointAt(f)
      const tan = this.thread.pointAt(Math.min(1, f + 0.004)).sub(this.thread.pointAt(Math.max(0, f - 0.004)))
      const view = cam.sub(base).normalize()
      let n = tan.cross(view)
      n = n.length > 1e-5 ? n.normalize() : up
      if (n.dot(up) < 0) n = n.uniformScale(-1)
      // Small along the arm, full height once it is out of the deck.
      const grow = 0.5 + 0.5 * clamp01(s / 60)
      pts.push(base.add(n.uniformScale(L * SIG_A * grow * rpToneShape(this.phi - kt * s))))
      alphas.push(env * clamp01((front - s) / 6 + 0.15) * clamp01(s / 3 + 0.2))
    }
    const view = cam.sub(this.thread.pointAt(0.5)).normalize()
    this.wave.setVisible(true)
    this.waveHalo.setVisible(true)
    this.wave.update(pts, view, alphas)
    this.waveHalo.update(pts, view, alphas)
    if (this.head) {
      const travelling = front < Ltot - 0.5 && this.phase !== "fading"
      this.head.enabled = travelling
      if (travelling) {
        const hp = this.thread.pointAt(front / Ltot)
        const htr = this.head.getTransform()
        htr.setLocalPosition(hp.add(cam.sub(hp).normalize().uniformScale(0.3)))
        htr.setWorldRotation(faceToward(cam.sub(hp)))
        if (this.headMat) setFade(this.headMat, env)
      }
    }
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
  }

  private buildRings(): void {
    const w = this.hairAt(this.speaker()) * 2.2
    for (let i = 0; i < RING_POOL; i++) {
      const r = new TrailRibbon(this.root, "RpRing" + i, this.glowMat, RING_PTS, w, ink(AMBER, 0.9))
      r.setVisible(false)
      this.rings.push(r)
    }
  }

  private updateRings(center: vec3, cS: number, bright: number, env: number, cam: vec3): void {
    const u = this.axis.cross(vec3.up()).normalize()
    const v = u.cross(this.axis).normalize()
    const view = cam.sub(center).normalize()
    const n = Math.min(this.births.length, this.rings.length)
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i]
      if (i >= n) {
        ring.setVisible(false)
        continue
      }
      const b = this.births[this.births.length - 1 - i]
      const radius = RC + cS * (this.t - b)
      const a = bright * env * Math.pow(1 - clamp01(radius / RING_MAX), 1.5) * clamp01((this.t - b) / 0.08)
      const pts: vec3[] = []
      const alphas: number[] = []
      for (let j = 0; j < RING_PTS; j++) {
        const th = (j / (RING_PTS - 1)) * Math.PI * 2
        pts.push(center.add(u.uniformScale(radius * Math.cos(th))).add(v.uniformScale(radius * Math.sin(th))))
        alphas.push(a)
      }
      ring.setVisible(true)
      ring.update(pts, view, alphas)
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


