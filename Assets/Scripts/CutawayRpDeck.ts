/**
 * Record player hero: the deck's own mechanics on the copy (recordplayer-hero.md §2, Phase B).
 *
 * The tonearm moves only as the real one does: it swings about its pivot (yaw, RpTonearm) between
 * its rest and the record's inner groove, and it lifts by turning about the same pivot's horizontal
 * bearing (pitch, RpTonearmLift), never higher than the real cueing height. Released over the
 * record's grooves it lowers onto the record (a damped cue, about 0.5 s) and the platter spins up to
 * 33⅓ rpm over 1 s; released anywhere else it swings back to its rest. Lifted off the record, the
 * platter runs down within 2 s. The motor pulley and sub-platter turn with the platter (belt ratio).
 *
 * Everything is in the model's own space (cm at 1x); the copy's transform scales it.
 */
import {RecordPlayerModel, RP_GEOM} from "./CutawayRecordPlayerModel"
import {easeInOutCubic} from "./CutawayTween"

const G = RP_GEOM
const DEG = Math.PI / 180

/** 33⅓ rpm in rad/s. */
export const RP_OMEGA = ((100 / 3) * 2 * Math.PI) / 60
/** The real cueing height at the stylus (cm): the cue lift raises the arm about 9 mm there. */
export const RP_CUE_CM = 0.9
/** While held by hand the stylus stays at least this high (cm), so it only meets the record when released. */
const HELD_MIN_CM = 0.25
const SPIN_UP_S = 1.0
const SPIN_DOWN_S = 1.6
/** Put it back: the platter is braked to a stop sooner. */
const BRAKE_S = 0.8
const CUE_DOWN_S = 0.5
const LIFT_UP_S = 0.15
const RETURN_S = 0.6

export type ArmMode = "rest" | "held" | "lowering" | "playing" | "returning"
export type DeckEvent = "touchdown" | "liftoff" | "rested"

export class RpDeck {
  mode: ArmMode = "rest"
  /** Arm yaw from its rest (rad, ≤ 0 toward the record) and the stylus lift above the record (cm). */
  yaw = 0
  lift = 0
  /** Platter angle (rad, unwrapped) and speed (rad/s). */
  platterAngle = 0
  omega = 0
  readonly yawOuter: number
  readonly yawInner: number
  /** Stylus tip at rest, lift 0 (model space). */
  readonly tip0: vec3
  private tipLocalZ: number
  private arm: Transform
  private armLift: Transform
  private spinParts: {tr: Transform; base: quat; ratio: number; drive: boolean}[] = []
  /**
   * Taken apart, the motor runs on its own: the pulley drives the belt, which turns the sub-platter
   * (at 33⅓ rpm) while the platter is lifted off. Extra angle of the drive over the platter's (rad).
   */
  driveAngle = 0
  driveOmega = 0
  private driveOn = false
  private anim: {from: {yaw: number; lift: number}; to: {yaw: number; lift: number}; t: number; dur: number} | null = null
  private spinT = 0
  private spinFrom = 0
  private spinTarget = 0
  private spinDownS = SPIN_DOWN_S
  private events: DeckEvent[] = []

  constructor(private model: RecordPlayerModel) {
    const P = G.pivot
    // The model is built unrotated at scale 1: its stylus tip in world space is its model-space tip.
    const inv = model.root.getTransform().getInvertedWorldTransform()
    this.tip0 = inv.multiplyPoint(model.stylusTip())
    this.arm = model.parts["RpTonearm"].getTransform()
    this.armLift = model.parts["RpTonearmLift"].getTransform()
    // The tip in the lift frame: its distance along the arm sets the pitch for a given lift.
    const rel = this.tip0.sub(P)
    this.tipLocalZ = rel.z
    this.yawOuter = this.yawForRadius(G.grooveOuter)
    this.yawInner = this.yawForRadius(G.grooveInner)
    const sub = G.subPlatterR / G.pulleyR
    for (const [name, ratio, drive] of [
      ["RpPlatter", 1, false],
      ["RpRecord", 1, false],
      ["RpSubPlatter", 1, true],
      ["RpMotorPulley", sub, true]
    ] as [string, number, boolean][]) {
      const so = model.parts[name]
      if (so) this.spinParts.push({tr: so.getTransform(), base: so.getTransform().getLocalRotation(), ratio, drive})
    }
    this.apply()
  }

  // ---------------- Geometry ----------------

  /** Stylus tip (model space) at a yaw and lift. */
  tipAt(yaw: number, lift: number): vec3 {
    const P = G.pivot
    const r = this.tip0.sub(P)
    const q = quat.angleAxis(yaw, vec3.up())
    return P.add(q.multiplyVec3(r)).add(new vec3(0, lift, 0))
  }

  /** Distance (cm, flat) from the platter axis to the stylus tip at a yaw. */
  radiusAt(yaw: number): number {
    const t = this.tipAt(yaw, 0)
    return new vec2(t.x - G.axis.x, t.z - G.axis.y).length
  }

  /** The current stylus tip (model space). */
  tip(): vec3 {
    return this.tipAt(this.yaw, this.lift)
  }

  /** Whether a yaw puts the stylus over the record's grooves. */
  overGrooves(yaw: number): boolean {
    const r = this.radiusAt(yaw)
    return r <= G.grooveOuter + 1e-3 && r >= G.grooveInner - 1e-3
  }

  get playing(): boolean {
    return this.mode === "playing"
  }

  get atRest(): boolean {
    return this.mode === "rest"
  }

  /** On its rest with the platter still (Put it back waits for this). */
  get stopped(): boolean {
    return this.mode === "rest" && this.omega === 0
  }

  /** Platter speed in rpm. */
  get rpm(): number {
    return (this.omega * 60) / (2 * Math.PI)
  }

  /** The ratio of the platter's speed to 33⅓ rpm (the groove's speed under the stylus follows it). */
  get speedRatio(): number {
    return this.omega / RP_OMEGA
  }

  private yawForRadius(r: number): number {
    // Bisection over the arm's swing toward the platter: the radius falls as the yaw goes negative.
    let a = -80 * DEG
    let b = 0
    for (let i = 0; i < 60; i++) {
      const m = (a + b) / 2
      if (this.radiusAt(m) > r) b = m
      else a = m
    }
    return (a + b) / 2
  }

  // ---------------- Hand ----------------

  /** Picked up by the finger lift: it rises to the cueing height (from the record, it lifts off). */
  grab(): void {
    if (this.mode === "playing" || this.mode === "lowering") this.stopPlatter()
    const wasPlaying = this.mode === "playing"
    this.mode = "held"
    this.anim = {from: {yaw: this.yaw, lift: this.lift}, to: {yaw: this.yaw, lift: RP_CUE_CM}, t: 0, dur: LIFT_UP_S}
    if (wasPlaying) this.events.push("liftoff")
  }

  /** While held: the hand sets the yaw (clamped to the swing) and the lift (within the cueing height). */
  hold(yaw: number, lift: number): void {
    if (this.mode !== "held") return
    const y = Math.max(this.yawInner, Math.min(0, yaw))
    const l = Math.max(HELD_MIN_CM, Math.min(RP_CUE_CM, lift))
    if (this.anim) {
      // Still rising to the cueing height: follow the yaw at once, keep the rise.
      this.anim.to = {yaw: y, lift: Math.max(l, this.anim.to.lift)}
      this.anim.from.yaw = y
      this.yaw = y
      return
    }
    this.yaw = y
    this.lift = l
    this.apply()
  }

  /** Let go: over the grooves it lowers onto the record; anywhere else it swings back to its rest. */
  release(): "drop" | "rest" {
    if (this.mode !== "held") return "rest"
    if (this.anim) {
      this.yaw = this.anim.to.yaw
      this.anim = null
    }
    if (this.overGrooves(this.yaw)) {
      this.mode = "lowering"
      this.anim = {from: {yaw: this.yaw, lift: this.lift}, to: {yaw: this.yaw, lift: 0}, t: 0, dur: CUE_DOWN_S}
      return "drop"
    }
    this.toRest()
    return "rest"
  }

  /** Back to its rest from anywhere (a release off the record; Put it back with `brake`). */
  toRest(brake: boolean = false): void {
    if (this.mode === "playing" || this.mode === "lowering") {
      const was = this.mode === "playing"
      this.stopPlatter()
      if (was) this.events.push("liftoff")
    }
    if (brake && this.omega > 0) this.stopPlatter(BRAKE_S)
    if (this.mode === "rest") return
    this.mode = "returning"
    const lift = Math.max(this.lift, this.yaw < -1e-4 ? RP_CUE_CM * 0.6 : 0)
    this.anim = {from: {yaw: this.yaw, lift: lift}, to: {yaw: 0, lift: 0}, t: 0, dur: this.yaw < -1e-4 || this.lift > 1e-4 ? RETURN_S : 0.01}
  }

  /** Reset to rest at once (no motion). */
  snapRest(): void {
    this.mode = "rest"
    this.anim = null
    this.yaw = 0
    this.lift = 0
    this.omega = 0
    this.spinTarget = 0
    this.driveOn = false
    this.driveOmega = 0
    this.apply()
  }

  /** Run the motor on its own (taken apart) or let it run down. */
  setDrive(on: boolean): void {
    this.driveOn = on
  }

  /** The belt's speed (cm/s at 1x): the sub-platter's groove speed. */
  get beltSpeed(): number {
    return (this.omega + this.driveOmega) * (G.subPlatterR + 0.045)
  }

  /** Events since the last call (touchdown, liftoff, rested). */
  takeEvents(): DeckEvent[] {
    const e = this.events
    this.events = []
    return e
  }

  // ---------------- Per frame ----------------

  update(dt: number): void {
    const a = this.anim
    if (a) {
      a.t += dt
      const k = easeInOutCubic(a.t / a.dur)
      if (this.mode === "returning") {
        // Swing back while still raised, then set down on the rest.
        const ky = easeInOutCubic(a.t / (a.dur * 0.8))
        this.yaw = a.from.yaw + (a.to.yaw - a.from.yaw) * ky
        const kl = easeInOutCubic((a.t - a.dur * 0.6) / (a.dur * 0.4))
        this.lift = a.from.lift * (1 - kl)
      } else {
        this.yaw = a.from.yaw + (a.to.yaw - a.from.yaw) * k
        this.lift = a.from.lift + (a.to.lift - a.from.lift) * k
      }
      if (a.t >= a.dur) {
        this.yaw = a.to.yaw
        this.lift = a.to.lift
        this.anim = null
        if (this.mode === "lowering") {
          this.mode = "playing"
          this.startPlatter()
          this.events.push("touchdown")
        } else if (this.mode === "returning") {
          this.mode = "rest"
          this.events.push("rested")
        }
      }
    }
    // Platter: spin up over 1 s (ease out to exactly 33⅓ rpm), run down within 2 s.
    if (this.spinT >= 0) {
      this.spinT += dt
      if (this.spinTarget > 0) {
        const k = Math.min(1, this.spinT / SPIN_UP_S)
        this.omega = this.spinFrom + (this.spinTarget - this.spinFrom) * (1 - Math.pow(1 - k, 3))
      } else {
        const k = Math.min(1, this.spinT / this.spinDownS)
        this.omega = this.spinFrom * Math.pow(1 - k, 2)
      }
    }
    this.platterAngle += this.omega * dt
    // The motor on its own: up to speed in about 0.5 s, down in about 0.5 s.
    const target = this.driveOn ? RP_OMEGA : 0
    this.driveOmega += (target - this.driveOmega) * (1 - Math.exp(-dt / 0.15))
    if (Math.abs(target - this.driveOmega) < 1e-4) this.driveOmega = target
    this.driveAngle += this.driveOmega * dt
    this.apply()
  }

  private startPlatter(): void {
    this.spinFrom = this.omega
    this.spinTarget = RP_OMEGA
    this.spinT = 0
  }

  private stopPlatter(dur: number = SPIN_DOWN_S): void {
    this.spinFrom = this.omega
    this.spinTarget = 0
    this.spinT = 0
    this.spinDownS = dur
  }

  private apply(): void {
    this.arm.setLocalRotation(quat.angleAxis(this.yaw, vec3.up()))
    // Pitch about the bearing (the lift frame's X): the tip rises by `lift` at its distance along the arm.
    const pitch = -Math.asin(Math.max(-1, Math.min(1, this.lift / this.tipLocalZ)))
    this.armLift.setLocalRotation(quat.angleAxis(pitch, new vec3(1, 0, 0)))
    // Records turn clockwise seen from above.
    for (const s of this.spinParts) {
      const a = this.platterAngle + (s.drive ? this.driveAngle : 0)
      s.tr.setLocalRotation(quat.angleAxis(-a * s.ratio, vec3.up()).multiply(s.base))
    }
  }
}
