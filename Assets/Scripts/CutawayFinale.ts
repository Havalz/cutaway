import {MeshKit, setLevel, spawnMesh, TrailRibbon} from "./CutawayGeometry"
import {ENERGY, FINALE, INK, keyWord, lit, NO_LIGHT, wave} from "./CutawayStyle"
import {clamp01, easeInOutCubic, faceToward} from "./CutawayTween"

/** "Sound, light, signal": each word in its energy's colour. */
export const FINALE_CAPTION = keyWord(keyWord(keyWord("*Sound*, *light*, *signal*. You've seen inside all three.", ENERGY.motion), ENERGY.light), ENERGY.signal)

export interface FinaleThread {
  key: string
  from: vec3
  color: vec4
  /** Only the record player's carries the wave. */
  waved: boolean
}

export interface FinaleHost {
  parent: SceneObject
  glowMat: Material
  camera: () => Transform | null
  meet: vec3
  threads: FinaleThread[]
  setCaption: (text: string | null, at?: vec3) => void
  chord: () => void
  glowSlots: () => void
}

export interface FinaleInfo {
  playing: boolean
  plays: number
  t: number
  /** How far along each thread its light has reached (0..1), and where that is. */
  threads: {key: string; color: vec4; reveal: number; start: vec3; head: vec3}[]
  pointLevel: number
  log: {event: string; time: number}[]
}

interface Strand {
  spec: FinaleThread
  ribbon: TrailRibbon
  count: number
  /** Where the strand starts, and its two curve handles. */
  p0: vec3
  p1: vec3
  p2: vec3
  /** Its angle around the braid. */
  phase: number
  length: number
  pts: vec3[]
  alphas: number[]
}

const UP = new vec3(0, 1, 0)

/**
 * "Now you've seen inside": once all three are found, a thread leaves each object, they braid
 * above the coffee table into one point of light that pulses once, a caption names all three, and
 * the threads retract. About 8 s, world-anchored, and nothing is blocked while it plays.
 */
export class Finale {
  private root: SceneObject
  private strands: Strand[] = []
  private point: SceneObject
  private pointMat: Material
  private pointLevel = 0
  private t = -1
  private leaving = 0
  private plays = 0
  private flags: {[key: string]: boolean} = {}
  private log: {event: string; time: number}[] = []
  /** Test hook: freeze the timeline once it reaches this moment (screenshots). */
  holdAt: number | null = null

  constructor(private host: FinaleHost) {
    this.root = global.scene.createSceneObject("Finale")
    this.root.setParent(host.parent)
    this.root.getTransform().setWorldPosition(vec3.zero())
    const base = host.meet.sub(UP.uniformScale(FINALE.braidHeight))
    host.threads.forEach((spec, i) => {
      const count = spec.waved ? FINALE.wavedPoints : FINALE.plainPoints
      const ribbon = new TrailRibbon(this.root, "FinaleThread_" + spec.key, host.glowMat, count, FINALE.threadWidth, spec.color)
      const reach = base.sub(spec.from)
      this.strands.push({
        spec,
        ribbon,
        count,
        p0: spec.from,
        p1: spec.from.add(reach.uniformScale(0.35)).add(UP.uniformScale(FINALE.liftOut)),
        p2: base.sub(UP.uniformScale(FINALE.liftIn)),
        phase: (i * 2 * Math.PI) / host.threads.length,
        length: reach.length + FINALE.liftOut,
        pts: [],
        alphas: []
      })
    })
    const k = new MeshKit()
    k.addFanXY(0, 0, FINALE.pointRadius, 0, Math.PI * 2, lit(INK, 1), NO_LIGHT, 48)
    this.point = global.scene.createSceneObject("FinalePoint")
    this.point.setParent(this.root)
    this.point.getTransform().setWorldPosition(host.meet)
    this.pointMat = spawnMesh(this.point, "FinalePointMesh", k.build(), host.glowMat).mat
    setLevel(this.pointMat, 0)
    this.root.enabled = false
  }

  get isPlaying(): boolean {
    return this.t >= 0
  }

  start(): void {
    this.t = 0
    this.leaving = 0
    this.flags = {}
    this.plays++
    this.root.enabled = true
    this.note("start")
    this.draw(0)
  }

  /** Something else started, or Reset: the light clears (at once for Reset). */
  stop(instant: boolean): void {
    if (this.t < 0 && !this.root.enabled) return
    if (this.t >= 0) {
      this.note("stop")
      this.host.setCaption(null)
    }
    this.t = -1
    if (instant) {
      this.root.enabled = false
      this.leaving = 0
    } else this.leaving = FINALE.stopS
  }

  update(dt: number): void {
    if (this.leaving > 0) {
      this.leaving = Math.max(0, this.leaving - dt)
      const k = this.leaving / FINALE.stopS
      this.strands.forEach((s) => setLevel(s.ribbon.mat, FINALE.threadLevel * k))
      setLevel(this.pointMat, this.pointLevel * k)
      if (this.leaving <= 0) this.root.enabled = false
      return
    }
    if (this.t < 0) return
    if (this.holdAt === null || this.t < this.holdAt) this.t += Math.min(dt, 0.05)
    const t = this.t
    this.once("met", t >= FINALE.growS)
    if (this.once("pulse", t >= FINALE.pulseS)) this.host.chord()
    if (this.once("caption", t >= FINALE.captionS)) this.host.setCaption(FINALE_CAPTION, this.host.meet.add(UP.uniformScale(FINALE.captionAbove)))
    if (this.once("captionOut", t >= FINALE.captionEndS)) this.host.setCaption(null)
    this.once("retract", t >= FINALE.retractS)
    if (this.once("slots", t >= FINALE.slotsS)) this.host.glowSlots()
    if (t >= FINALE.durationS) {
      this.t = -1
      this.root.enabled = false
      this.note("end")
      return
    }
    this.draw(t)
  }

  info(): FinaleInfo {
    const t = Math.max(0, this.t)
    const r = this.t >= 0 ? this.reveal(t) : 0
    return {
      playing: this.t >= 0,
      plays: this.plays,
      t: this.t,
      threads: this.strands.map((s) => {
        const i = Math.round(r * (s.count - 1))
        return {key: s.spec.key, color: s.spec.color, reveal: r, start: s.p0, head: s.pts.length ? s.pts[i] : s.p0}
      }),
      pointLevel: this.t >= 0 ? this.pointLevel : 0,
      log: this.log.slice()
    }
  }

  private once(flag: string, when: boolean): boolean {
    if (!when || this.flags[flag]) return false
    this.flags[flag] = true
    this.note(flag)
    return true
  }

  private note(event: string): void {
    this.log.push({event, time: getTime()})
  }

  private reveal(t: number): number {
    if (t <= FINALE.growS) return easeInOutCubic(t / FINALE.growS)
    if (t <= FINALE.retractS) return 1
    return 1 - easeInOutCubic(clamp01((t - FINALE.retractS) / (FINALE.retractEndS - FINALE.retractS)))
  }

  private draw(t: number): void {
    const cam = this.host.camera()
    const eye = cam ? cam.getWorldPosition() : this.host.meet.add(new vec3(0, 0, 100))
    const toViewer = eye.sub(this.host.meet).normalize()
    const r = this.reveal(t)
    const swirl = t * FINALE.braidSpin
    this.strands.forEach((s) => this.drawStrand(s, r, swirl, t, toViewer))
    const level = FINALE.threadLevel
    this.strands.forEach((s) => setLevel(s.ribbon.mat, level))
    this.drawPoint(t, toViewer)
  }

  /** A curve from the object to the foot of the braid, then a tightening helix up into the point. */
  private drawStrand(s: Strand, r: number, swirl: number, t: number, toViewer: vec3): void {
    const n = s.count
    const curveShare = 1 - FINALE.braidShare
    const foot = this.braid(s, 0, swirl)
    if (s.pts.length !== n) {
      s.pts = new Array(n)
      s.alphas = new Array(n)
    }
    let lastBase = s.p0
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1)
      let p: vec3
      if (f <= curveShare) {
        const u = f / curveShare
        const v = 1 - u
        p = s.p0.uniformScale(v * v * v).add(s.p1.uniformScale(3 * v * v * u)).add(s.p2.uniformScale(3 * v * u * u)).add(foot.uniformScale(u * u * u))
        if (s.spec.waved) {
          const tan = p.sub(lastBase)
          lastBase = p
          let side = tan.cross(toViewer)
          side = side.length > 1e-5 ? side.normalize() : UP
          if (side.dot(UP) < 0) side = side.uniformScale(-1)
          const env = Math.pow(Math.sin(Math.PI * u), 0.7)
          p = p.add(side.uniformScale(FINALE.waveHeight * env * wave((2 * Math.PI * (u * s.length)) / FINALE.waveLength - t * FINALE.waveSpeed)))
        }
      } else p = this.braid(s, (f - curveShare) / FINALE.braidShare, swirl)
      s.pts[i] = p
      // Brightest at its head while it travels, with a soft leading edge.
      const behind = r - f
      const edge = r >= 1 ? 1 : clamp01(behind / 0.03)
      s.alphas[i] = edge * (0.6 + 0.4 * Math.exp(-Math.max(0, behind) / 0.08)) * clamp01(f / 0.02)
    }
    s.ribbon.update(s.pts, toViewer, s.alphas)
  }

  private braid(s: Strand, u: number, swirl: number): vec3 {
    const a = s.phase + swirl + u * FINALE.braidTurns * 2 * Math.PI
    const radius = FINALE.braidRadius * Math.pow(1 - u, 0.8)
    const base = this.host.meet.sub(UP.uniformScale(FINALE.braidHeight * (1 - u)))
    return base.add(new vec3(Math.cos(a) * radius, 0, Math.sin(a) * radius))
  }

  private drawPoint(t: number, toViewer: vec3): void {
    const rise = clamp01((t - (FINALE.growS - FINALE.pointLeadS)) / FINALE.pointRiseS)
    const fall = 1 - clamp01((t - FINALE.retractS) / FINALE.pointFallS)
    const k = clamp01((t - FINALE.pulseS) / FINALE.pulseLenS)
    const pulse = t >= FINALE.pulseS ? Math.sin(Math.PI * k) : 0
    this.pointLevel = (FINALE.pointLevel + (FINALE.pulseLevel - FINALE.pointLevel) * pulse) * rise * fall
    setLevel(this.pointMat, this.pointLevel)
    const tr = this.point.getTransform()
    tr.setWorldRotation(faceToward(toViewer))
    tr.setWorldScale(vec3.one().uniformScale(Math.max(0.001, (0.6 + 0.4 * rise) * (1 + FINALE.pulseGrow * pulse))))
  }
}
