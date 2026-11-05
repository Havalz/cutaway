import {MeshKit, setLevel, spawnMesh} from "./CutawayGeometry"
import {INK, lit, OPENING} from "./CutawayStyle"
import {clamp01} from "./CutawayTween"

export interface OpeningHost {
  parent: SceneObject
  glowMat: Material
  camera: () => Transform | null
  /** How many dots there are, in the order they appear. */
  dots: number
  /** Mask every dot, ready to reveal them one at a time. */
  hideDots: () => void
  /** Reveal one dot. `tick` says it arrived on the timeline, not because of a skip. */
  revealDot: (i: number, tick: boolean) => void
  /** Is any object past its dot (a chip, questions, a stage)? */
  chipUp: () => boolean
  /** Is a caption from the story already on? */
  storyCaption: () => boolean
  setCaption: (text: string | null, at?: vec3) => void
}

export interface OpeningInfo {
  playing: boolean
  /** Times it has started and been skipped, this session. */
  plays: number
  skips: number
  t: number
  sweepLevel: number
  caption: string | null
  captionAt: vec3 | null
  log: {event: string; time: number}[]
}

const DEG = Math.PI / 180

/**
 * "Look at something": one soft sweep of light across the room at eye level, then the three dots
 * one at a time, then a single caption low in view. Plays at the start of a session and after
 * Reset, never blocks input, and any pinch skips it.
 */
export class Opening {
  private root: SceneObject
  private mat: Material
  private t = -1
  private anchorYaw = 0
  private sweepK = 0
  private sweepLevel = 0
  private nextDot = 0
  private captionOn = false
  private captionDone = false
  private captionT = 0
  private at: vec3 | null = null
  private plays = 0
  private skips = 0
  private log: {event: string; time: number}[] = []
  /** Test hook: freeze the timeline once it reaches this moment (screenshots). */
  holdAt: number | null = null

  constructor(private host: OpeningHost) {
    this.root = global.scene.createSceneObject("OpeningSweep")
    this.root.setParent(host.parent)
    const spawned = spawnMesh(this.root, "SweepMesh", this.buildStreak(), host.glowMat)
    this.mat = spawned.mat
    setLevel(this.mat, 0)
    this.root.enabled = false
  }

  start(): void {
    const cam = this.host.camera()
    if (cam) {
      const look = cam.forward.uniformScale(-1)
      this.anchorYaw = Math.atan2(-look.x, -look.z)
    }
    this.t = 0
    this.nextDot = 0
    this.sweepK = 0
    this.sweepLevel = 0
    this.captionOn = false
    this.captionDone = false
    this.captionT = 0
    this.at = null
    this.plays++
    this.host.setCaption(null)
    this.host.hideDots()
    this.root.enabled = true
    this.note("start")
  }

  /** Any pinch: the dots come up at once, and the light and the words go. */
  skip(): void {
    if (this.t < 0) return
    this.t = -1
    while (this.nextDot < this.host.dots) this.host.revealDot(this.nextDot++, false)
    this.endCaption()
    this.skips++
    this.note("skip")
  }

  update(dt: number): void {
    // A long frame while the Lens is loading mustn't eat the opening.
    const d = this.holdAt !== null && this.t >= this.holdAt ? 0 : Math.min(dt, 0.05)
    if (this.t >= 0) {
      this.t += d
      this.updateSweep()
      this.updateDots()
      this.updateCaption(d)
      if (this.t >= OPENING.sweepS && this.nextDot >= this.host.dots && this.captionDone) {
        this.t = -1
        this.note("end")
      }
    } else if (this.root.enabled) {
      this.sweepLevel = Math.max(0, this.sweepLevel - (OPENING.sweepLevel / OPENING.fadeS) * d)
      setLevel(this.mat, this.sweepLevel)
      if (this.sweepLevel <= 0) this.root.enabled = false
    }
    if (this.root.enabled) this.placeSweep()
  }

  info(): OpeningInfo {
    return {
      playing: this.t >= 0,
      plays: this.plays,
      skips: this.skips,
      t: this.t,
      sweepLevel: this.root.enabled ? this.sweepLevel : 0,
      caption: this.captionOn ? OPENING.caption : null,
      captionAt: this.captionOn ? this.at : null,
      log: this.log.slice()
    }
  }

  private note(event: string): void {
    this.log.push({event, time: getTime()})
  }

  private updateSweep(): void {
    const k = clamp01(this.t / OPENING.sweepS)
    this.sweepK = k
    this.sweepLevel = OPENING.sweepLevel * Math.min(1, k / 0.12) * Math.min(1, (1 - k) / 0.2)
    setLevel(this.mat, this.sweepLevel)
    if (k >= 1) this.root.enabled = false
  }

  private placeSweep(): void {
    const cam = this.host.camera()
    if (!cam) return
    const k = this.sweepK
    const e = k * k * (3 - 2 * k)
    // From off to the left of the view until its tail has cleared the right.
    const az = (OPENING.sweepFromDeg + (OPENING.sweepToDeg + OPENING.tailDeg - OPENING.sweepFromDeg) * e) * DEG
    const tr = this.root.getTransform()
    tr.setWorldPosition(cam.getWorldPosition())
    tr.setWorldRotation(quat.angleAxis(this.anchorYaw - az, vec3.up()))
  }

  private updateDots(): void {
    while (this.nextDot < this.host.dots && this.t >= OPENING.sweepS + this.nextDot * OPENING.dotGapS) {
      this.host.revealDot(this.nextDot, true)
      this.note("dot" + this.nextDot)
      this.nextDot++
    }
  }

  private updateCaption(d: number): void {
    if (this.captionDone) return
    // The first chip, or a story caption, ends the line, even if it hasn't appeared yet.
    if (this.host.chipUp() || this.host.storyCaption()) {
      this.endCaption()
      return
    }
    if (!this.captionOn) {
      if (this.t < OPENING.sweepS + this.host.dots * OPENING.dotGapS) return
      this.captionOn = true
      this.note("caption")
    }
    this.captionT += d
    if (this.captionT >= OPENING.captionS) {
      this.endCaption()
      return
    }
    const cam = this.host.camera()
    if (!cam) return
    const look = cam.forward.uniformScale(-1)
    const want = cam.getWorldPosition().add(look.uniformScale(OPENING.captionAt)).sub(cam.up.uniformScale(OPENING.captionDown))
    // It trails the head a little, so it floats rather than sticks.
    this.at = this.at ? vec3.lerp(this.at, want, 1 - Math.exp(-d / OPENING.captionFollowS)) : want
    this.host.setCaption(OPENING.caption, this.at)
  }

  private endCaption(): void {
    if (this.captionOn) this.note("captionOut")
    this.captionOn = false
    this.captionDone = true
    this.host.setCaption(null)
  }

  /** A soft comet on a circle around the head: its bright head at azimuth 0, its tail trailing left. */
  private buildStreak(): RenderMesh {
    const k = new MeshKit()
    const ROWS = [-1, -0.35, 0, 0.35, 1]
    const PROFILE = [0, 0.22, 1, 0.22, 0]
    const SEG = 40
    let first = 0
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG
      const a = -OPENING.tailDeg * (1 - s) * DEG
      const along = Math.pow(s, 2.2) * Math.min(1, (1 - s) / 0.05)
      const p = new vec3(OPENING.sweepRadius * Math.sin(a), 0, -OPENING.sweepRadius * Math.cos(a))
      const n = p.uniformScale(-1).normalize()
      ROWS.forEach((row, r) => {
        const v = k.vert(p.add(new vec3(0, row * OPENING.bandHalf, 0)), n, lit(INK, along * PROFILE[r]))
        if (i === 0 && r === 0) first = v
      })
    }
    const R = ROWS.length
    for (let i = 0; i < SEG; i++)
      for (let r = 0; r < R - 1; r++) {
        const a = first + i * R + r
        k.tri(a, a + R, a + R + 1)
        k.tri(a, a + R + 1, a + 1)
      }
    return k.build()
  }
}
