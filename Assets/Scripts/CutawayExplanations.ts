/**
 * Hard-coded "direction scripts" for the three objects. Each explanation is a short timeline
 * of cues built from a small effects library: ghost shell, magnify bubble, flow, rays, callout
 * labels, waves and cone motion.
 *
 * Every effect object lives under `ctx.root`, whose world position is the object's dot anchor,
 * so CutawayMain can collapse the whole explanation into that dot by scaling the root to zero.
 *
 * Explanations told in beats (the record player) show one caption per beat; only the current
 * beat is bright and earlier beats dim to 30% as context.
 */
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {DynamicRibbon, GlowPath, MeshKit, setFade, spawnMesh, Spawned, TrailRibbon, UnitLine} from "./CutawayGeometry"
import {ENERGY, ink, UI_WHITE, wave} from "./CutawayStyle"
import {clamp01, easeInOut, easeInOutCubic, easeOutCubic, faceToward, Pop} from "./CutawayTween"

export interface ExplainContext {
  root: SceneObject
  glowMat: Material
  modelMat: Material
  labels: CutawayLabelsUI
  camPos: () => vec3
  log: (phase: string) => void
  playChime: () => void
  coneOverride?: SceneObject | null
  /** Show this beat's caption under the question (null hides it). */
  caption: (text: string | null) => void
  /** The real object's bounds (world center, full size along world axes, cm). */
  bounds: {center: vec3; size: vec3}
  /** The station UI's current scale (design cm → world cm). */
  uiScale: number
}

const CYAN = new vec4(0.55, 0.9, 1.0, 1)
const WARM = new vec4(1.0, 0.8, 0.45, 1)
const WHITE = new vec4(0.92, 0.96, 1.0, 1)
const ZERO = new vec4(0, 0, 0, 0)

function rgba(c: vec4, k: number): vec4 {
  return new vec4(c.x * k, c.y * k, c.z * k, c.w * k)
}

function flat(v: vec3): vec3 {
  const f = new vec3(v.x, 0, v.z)
  return f.length > 1e-4 ? f.normalize() : new vec3(0, 0, 1)
}

function phase(t: number, a: number, b: number): number {
  return clamp01((t - a) / (b - a))
}

/** Earlier beats dim to this. */
const DIM = 0.3

export abstract class Explanation {
  t = 0
  abstract readonly duration: number
  /** Energy colors this explanation uses: the explained dot gets one ring per color. */
  energies: vec4[] = []
  protected origin: vec3
  private cues: {at: number; fn: () => void; done: boolean}[] = []
  private tickers: ((t: number, dt: number) => void)[] = []
  private labelIds: string[] = []
  private pops: Pop[] = []
  private beatStarts: number[] = []
  private inks: {mat: Material; beat: number; alpha: () => number}[] = []

  constructor(protected ctx: ExplainContext) {
    this.origin = ctx.root.getTransform().getWorldPosition()
  }

  get finished(): boolean {
    return this.t >= this.duration
  }

  update(dt: number): void {
    this.t += dt
    for (const c of this.cues) {
      if (!c.done && this.t >= c.at) {
        c.done = true
        c.fn()
      }
    }
    for (const f of this.tickers) f(this.t, dt)
    for (const p of this.pops) p.update(dt)
    for (const k of this.inks) setFade(k.mat, this.beatLevel(k.beat) * Math.max(0, k.alpha()))
  }

  /** Where this explanation wants the Stop pill (world), or null to keep the station's own spot. */
  stopHint: vec3 | null = null
  /** Where this explanation wants the question caption (world), or null to keep it above the dot. */
  captionHint: vec3 | null = null

  hideLabels(): void {
    for (const id of this.labelIds) this.ctx.labels.hide(id)
  }

  /** World → root-local (root has identity rotation and unit scale while building). */
  protected L(p: vec3): vec3 {
    return p.sub(this.origin)
  }

  protected cue(at: number, fn: () => void): void {
    this.cues.push({at, fn, done: false})
  }

  protected tick(fn: (t: number, dt: number) => void): void {
    this.tickers.push(fn)
  }

  protected label(id: string, text: string, worldPos: vec3, anchor?: vec3): void {
    if (this.labelIds.indexOf(id) < 0) this.labelIds.push(id)
    this.ctx.labels.show(id, text, worldPos, anchor)
  }

  protected unlabel(id: string): void {
    this.ctx.labels.hide(id)
  }

  // ---------------- Beats ----------------

  /**
   * Declare the beats: start times and one caption each (nine words or fewer). Each beat start
   * logs "beatN", clears the previous beat's labels and swaps the caption; the caption clears
   * at `end`.
   */
  protected beats(starts: number[], captions: string[], end: number): void {
    this.beatStarts = starts.slice()
    starts.forEach((at, i) =>
      this.cue(at, () => {
        this.ctx.log("beat" + (i + 1))
        this.hideLabels()
        this.ctx.caption(captions[i] ?? null)
      })
    )
    this.cue(end, () => this.ctx.caption(null))
  }

  /** Index of the beat playing now (-1 before the first). */
  protected currentBeat(): number {
    let b = -1
    for (let i = 0; i < this.beatStarts.length; i++) if (this.t >= this.beatStarts[i]) b = i
    return b
  }

  /** 1 while `beat` is current (or still to come), easing to 30% over 300 ms once the next beat starts. */
  private beatLevel(beat: number): number {
    if (beat < 0 || beat + 1 >= this.beatStarts.length) return 1
    const next = this.beatStarts[beat + 1]
    if (this.t < next) return 1
    return 1 - (1 - DIM) * easeOutCubic((this.t - next) / 0.3)
  }

  /** Register a material as part of a beat: its brightness follows the beat (× `alpha`). */
  protected inkBeat(mat: Material, beat: number, alpha: () => number = () => 1): void {
    this.inks.push({mat, beat, alpha})
    setFade(mat, 0)
  }

  /** Fade-in ramp: 0 before `at`, ease-out cubic to 1 over `dur` seconds. */
  protected ramp(at: number, dur: number = 0.3): () => number {
    return () => easeOutCubic((this.t - at) / dur)
  }

  /** Hairline stroke radius that reads at the viewer's distance from `p` (world cm). */
  protected hairAt(p: vec3): number {
    return 0.085 * Math.max(0.5, p.distance(this.ctx.camPos()) / 110)
  }

  // ---------------- Building blocks ----------------

  protected node(name: string, worldPos: vec3, parent?: SceneObject): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent ?? this.ctx.root)
    if (parent) so.getTransform().setLocalPosition(worldPos)
    else so.getTransform().setLocalPosition(this.L(worldPos))
    return so
  }

  protected glow(parent: SceneObject, name: string, kit: MeshKit, localPos?: vec3): Spawned {
    return spawnMesh(parent, name, kit.build(), this.ctx.glowMat, localPos)
  }

  protected model(parent: SceneObject, name: string, kit: MeshKit, alpha: number = 1, localPos?: vec3): Spawned {
    const s = spawnMesh(parent, name, kit.build(), this.ctx.modelMat, localPos)
    s.mat.mainPass.twoSided = true
    if (alpha < 1) setFade(s.mat, alpha, true)
    return s
  }

  protected pop(so: SceneObject): Pop {
    const p = new Pop(so, vec3.one(), false)
    this.pops.push(p)
    return p
  }

  /** Glow path from world points (converted to root-local). */
  protected path(name: string, worldPts: vec3[], radius: number, color: vec4, halo: number = radius * 3): GlowPath {
    return new GlowPath(this.ctx.root, name, this.ctx.glowMat, worldPts.map((p) => this.L(p)), {radius, color, halo, haloAlpha: 0.22, sides: 6, step: 3})
  }

  protected headSphere(name: string, r: number, color: vec4): SceneObject {
    const kit = new MeshKit()
    kit.addSphere(vec3.zero(), r, color, 6, 10)
    kit.addSphere(vec3.zero(), r * 2.2, rgba(color, 0.18), 6, 10)
    const s = this.glow(this.ctx.root, name, kit)
    s.so.enabled = false
    return s.so
  }

  /**
   * Ghost shell: the object's bounds as thin edges with brighter corner brackets, never a filled
   * box. The brackets lock on first (150 ms, like the scan), then the edges fade in (300 ms).
   */
  protected ghostShell(name: string, center: vec3, size: vec3, beat: number, at: number): SceneObject {
    const shell = this.node(name, center)
    const h = size.uniformScale(0.5)
    const r = this.hairAt(center)
    const ax = new vec3(h.x, 0, 0)
    const ay = new vec3(0, h.y, 0)
    const az = new vec3(0, 0, h.z)
    const edges = new MeshKit()
    edges.addBoxEdges(vec3.zero(), ax, ay, az, r, ink(UI_WHITE, 0.2))
    const e = this.glow(shell, "ShellEdges", edges)
    this.inkBeat(e.mat, beat, this.ramp(at + 0.15, 0.3))
    const corners = this.node("ShellCorners", vec3.zero(), shell)
    const ck = new MeshKit()
    const arm = (v: number) => Math.max(1.2, v * 0.3)
    const c = ink(UI_WHITE, 0.6)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const p = new vec3(sx * h.x, sy * h.y, sz * h.z)
          ck.addTube([p, p.add(new vec3(-sx * arm(h.x), 0, 0))], r * 0.85, c, 4, 50)
          ck.addTube([p, p.add(new vec3(0, -sy * arm(h.y), 0))], r * 0.85, c, 4, 50)
          ck.addTube([p, p.add(new vec3(0, 0, -sz * arm(h.z)))], r * 0.85, c, 4, 50)
        }
    const cm = this.glow(corners, "ShellBrackets", ck)
    this.inkBeat(cm.mat, beat, this.ramp(at, 0.15))
    this.tick((t) => corners.getTransform().setLocalScale(vec3.one().uniformScale(1.08 - 0.08 * easeOutCubic((t - at) / 0.15))))
    return shell
  }
}

// =====================================================================================
// Record player — "How does it make sound?" Five beats; the same wave shape shows at every
// stage: carved in the groove (amber), as the signal (cyan), and as rings in the air (amber).
// =====================================================================================
export class RecordPlayerExplanation extends Explanation {
  static readonly BEATS = [0.05, 3.4, 6.8, 10.2, 13.4]
  static readonly END = 17.0
  readonly duration = RecordPlayerExplanation.END + 0.25

  /**
   * @param needle stylus tip on the record (needle marker)
   * @param speaker nearest speaker (speaker marker)
   * @param shelfY height of the shelf the line of light runs along
   * @param platter centre of the platter (record player marker)
   */
  constructor(ctx: ExplainContext, needle: vec3, speaker: vec3, shelfY: number, platter: vec3) {
    super(ctx)
    this.energies = [ENERGY.motion, ENERGY.signal]
    const B = RecordPlayerExplanation.BEATS
    const END = RecordPlayerExplanation.END
    const AMBER = ENERGY.motion
    const SIGNAL = ENERGY.signal
    const cam = ctx.camPos()
    const toUser = flat(cam.sub(needle))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    const up = vec3.up()
    const hair = this.hairAt(needle)
    const bounds = ctx.bounds
    const top = bounds.center.add(up.uniformScale(bounds.size.y / 2))

    this.beats(
      B,
      [
        "The groove is the sound, carved as a wiggle.",
        "The needle rides the wiggle and shakes.",
        "A magnet and coil turn shaking into signal.",
        "The signal is boosted and sent to the speaker.",
        "The cone pushes air. That's what you hear."
      ],
      END
    )
    // The question sits above the turntable with the caption hanging under it.
    this.captionHint = top.add(up.uniformScale(6.2 * ctx.uiScale))

    // ---------------- Beat 1: ghost shell + the platter spinning at 33⅓ rpm ----------------
    this.cue(B[0], () => ctx.log("shell"))
    this.ghostShell("GhostShell", bounds.center, bounds.size, 0, B[0])
    const P = new vec3(platter.x, needle.y + 0.3, platter.z)
    const toNeedle = new vec3(needle.x - P.x, 0, needle.z - P.z)
    const Rg = Math.max(6, toNeedle.length)
    const Rp = Rg + 1.8
    const spin = this.node("Platter", P)
    const disc = this.node("PlatterDisc", vec3.zero(), spin)
    const tilt = quat.angleAxis(-Math.PI / 2, vec3.right())
    const pk = new MeshKit()
    pk.addArcXY(0, 0, Rp, hair * 2, 0, Math.PI * 2, ink(UI_WHITE, 0.32), 96)
    pk.addArcXY(0, 0, Rp, hair * 2.6, 0, 0.75, ink(UI_WHITE, 0.95), 16)
    pk.addArcXY(0, 0, 4, hair * 1.6, 0, Math.PI * 2, ink(UI_WHITE, 0.22), 40)
    pk.addFanXY(0, 0, 0.6, 0, Math.PI * 2, ink(UI_WHITE, 0.7), ink(UI_WHITE, 0.3), 12)
    const pm = this.glow(disc, "PlatterRing", pk)
    this.inkBeat(pm.mat, 0, this.ramp(B[0] + 0.25))
    // The groove: one turn of the spiral, its wiggle exaggerated so it reads from the room.
    const gk = new MeshKit()
    const gpts: vec2[] = []
    for (let i = 0; i <= 240; i++) {
      const th = (i / 240) * Math.PI * 2
      const r = Rg + 0.9 * wave(14 * th)
      gpts.push(new vec2(Math.cos(th) * r, Math.sin(th) * r))
    }
    gk.addPolylineXY(gpts, hair * 2, ink(AMBER, 0.95))
    const gm = this.glow(disc, "GrooveRing", gk)
    this.inkBeat(gm.mat, 0, this.ramp(B[0] + 0.4))
    const RPM = (33.333 / 60) * Math.PI * 2
    this.tick((t) => disc.getTransform().setLocalRotation(tilt.multiply(quat.angleAxis(-RPM * t, vec3.forward()))))
    const grooveFront = P.add(toUser.uniformScale(Rg)).add(up.uniformScale(0.3))
    this.cue(B[0] + 0.9, () => this.label("groove", "Groove", grooveFront.add(right.uniformScale(-(Rp + 10))).add(toUser.uniformScale(4)), grooveFront))

    // ---------------- Beat 2: magnify bubble at the stylus ----------------
    const R = 12
    const S = Math.min(1.8, Math.max(1, cam.distance(needle) / 320))
    const RS = R * S
    const bubbleTarget = needle.add(right.uniformScale(Rp + RS + 6)).add(up.uniformScale(RS * 0.55)).add(toUser.uniformScale(14))
    const bubble = this.node("MagnifyBubble", needle)
    bubble.enabled = false
    const face = this.node("BubbleFace", vec3.zero(), bubble)
    face.getTransform().setLocalScale(vec3.one().uniformScale(S))
    const bubbleOpen = () => clamp01(bubble.getTransform().getLocalScale().x)
    // Frame: thin double rim and a faint inner glow (stays bright through beat 3).
    const fk = new MeshKit()
    fk.addArcXY(0, 0, R, 0.2, 0, Math.PI * 2, ink(UI_WHITE, 0.85), 96)
    fk.addArcXY(0, 0, R - 0.55, 0.1, 0, Math.PI * 2, ink(UI_WHITE, 0.4), 96)
    fk.addFanXY(0, 0, 8, 0, Math.PI * 2, ink(UI_WHITE, 0.02), ink(UI_WHITE, 0.03), 48)
    fk.addSoftRingXY(0, 0, 8, R - 0.6, ink(UI_WHITE, 0.03), ink(UI_WHITE, 0.1), 64)
    const frame = this.glow(face, "BubbleFrame", fk)
    this.inkBeat(frame.mat, 2, bubbleOpen)
    // Contents at 5x: the groove (seen from above) scrolling under the stylus tip, low in the
    // bubble so beat 3's cartridge has the upper half.
    const GY = -7
    const GA = 1.5
    const GK = 0.75
    const GW = 4
    const clipX = (y: number) => Math.sqrt(Math.max(0, (R - 0.9) * (R - 0.9) - y * y))
    const grooveY = (x: number, ph: number) => GY + GA * wave(GK * x - ph)
    const walls: DynamicRibbon[] = []
    for (const off of [0.75, -0.75]) {
      const w = new DynamicRibbon(face, "GrooveWall", ctx.glowMat, 48, 0.2, ink(AMBER, 0.95))
      this.inkBeat(w.mat, 1, bubbleOpen)
      walls.push(w)
    }
    const nextGroove = new DynamicRibbon(face, "GrooveNext", ctx.glowMat, 32, 0.16, ink(AMBER, 0.3))
    this.inkBeat(nextGroove.mat, 1, bubbleOpen)
    const TIP_X = -5
    const tip = this.node("StylusTip", vec3.zero(), face)
    const tk = new MeshKit()
    tk.addFanXY(0, 0, 0.45, 0, Math.PI * 2, ink(AMBER, 1), ink(AMBER, 0.7), 20)
    tk.addArcXY(0, 0, 0.85, 0.1, 0, Math.PI * 2, ink(AMBER, 0.6), 28)
    const tm = this.glow(tip, "TipMesh", tk)
    // The tip and cantilever drive beat 3's magnet, so they stay bright through beat 3.
    this.inkBeat(tm.mat, 2, bubbleOpen)
    // Cantilever: a thin rod drawn as two edge lines and a faint core.
    const rodKit = new MeshKit()
    rodKit.addLineXY(0, 0.17, 1, 0.17, 0.08, ink(AMBER, 0.9))
    rodKit.addLineXY(0, -0.17, 1, -0.17, 0.08, ink(AMBER, 0.9))
    rodKit.addRectXY(0, -0.13, 1, 0.13, ink(AMBER, 0.14))
    const rod = new UnitLine(face, "Cantilever", ctx.glowMat, 0, AMBER, 0, undefined, rodKit)
    this.inkBeat(rod.mat, 2, bubbleOpen)
    // The magnet sits at the cantilever's top end, inside the cartridge (upper half of the bubble).
    const MAG = new vec3(-3.2, 2.0, 0)
    const MW = 1.4
    const MH = 0.85
    const bubbleSpring = this.pop(bubble)
    // Beat 3's cartridge internals (built now; they fade in at beat 3).
    const internals = this.ramp(B[2] + 0.1, 0.35)
    const magnet = this.node("Magnet", MAG, face)
    const mk = new MeshKit()
    mk.addRectXY(-MW, -MH, MW, MH, ink(AMBER, 0.14))
    mk.addLineXY(-MW, -MH, MW, -MH, 0.14, ink(AMBER, 0.95))
    mk.addLineXY(MW, -MH, MW, MH, 0.14, ink(AMBER, 0.95))
    mk.addLineXY(MW, MH, -MW, MH, 0.14, ink(AMBER, 0.95))
    mk.addLineXY(-MW, MH, -MW, -MH, 0.14, ink(AMBER, 0.95))
    mk.addLineXY(0, -MH, 0, MH, 0.1, ink(AMBER, 0.5))
    const mm = this.glow(magnet, "MagnetMesh", mk)
    this.inkBeat(mm.mat, 2, internals)
    let groovePhase = 0

    this.cue(B[1], () => {
      ctx.log("bubble")
      bubble.enabled = true
      bubbleSpring.show(true)
    })
    this.cue(B[1] + 0.35, () => {
      // Hairline from the bubble's rim to the exact spot it magnifies.
      const leaderTo = bubbleTarget.add(bubbleTarget.sub(needle).normalize().uniformScale(-RS))
      const lp = this.path("BubbleLeaderLine", [needle, leaderTo], hair * 0.6, ink(UI_WHITE, 0.5), hair * 1.5)
      this.inkBeat(lp.mat, 2, () => clamp01((this.t - B[1] - 0.35) / 0.25))
      this.tick((t) => lp.setRange(0, easeOutCubic((t - B[1] - 0.35) / 0.25)))
    })
    const faceLocal = (x: number, y: number) => face.getTransform().getWorldTransform().multiplyPoint(new vec3(x, y, 0))
    // Below the bubble: the left side would sit on the tonearm, the top on the caption.
    this.cue(B[1] + 0.9, () => this.label("stylus", "Stylus", faceLocal(TIP_X, -R - 3.5), faceLocal(TIP_X, GY - 0.9)))
    this.tick((t, dt) => {
      if (!bubble.enabled) return
      const k = bubbleOpen()
      bubble.getTransform().setLocalPosition(vec3.lerp(this.L(needle), this.L(bubbleTarget), k))
      face.getTransform().setWorldRotation(faceToward(cam.sub(bubble.getTransform().getWorldPosition())))
      groovePhase += dt * GW
      walls.forEach((w, i) => {
        const off = i === 0 ? 0.75 : -0.75
        const hc = clipX(GY + off)
        w.update((j) => {
          const x = -hc + (2 * hc * j) / 47
          return new vec3(x, grooveY(x, groovePhase) + off, 0.05)
        })
      })
      const hn = clipX(GY - 3.6)
      nextGroove.update((j) => {
        const x = -hn + (2 * hn * j) / 31
        return new vec3(x, GY - 3.6 + GA * wave(GK * x - groovePhase + 2.1), 0.05)
      })
      const tipY = grooveY(TIP_X, groovePhase)
      const tipP = new vec3(TIP_X, tipY, 0.1)
      tip.getTransform().setLocalPosition(tipP)
      const magP = MAG.add(new vec3(0, 0.45 * (tipY - GY), 0.1))
      rod.set(tipP, magP)
      magnet.getTransform().setLocalPosition(magP)
    })

    // ---------------- Beat 3: inside the cartridge, a magnet and coil ----------------
    // Cartridge outline around magnet and coil; the cantilever enters through its floor and the
    // signal leaves through its right wall.
    const body = new MeshKit()
    const bx0 = -5.4
    const bx1 = 4.6
    const by0 = -0.9
    const by1 = 5.0
    const bodyInk = ink(UI_WHITE, 0.45)
    body.addLineXY(bx0, by0, bx1, by0, 0.1, bodyInk)
    body.addLineXY(bx1, by0, bx1, by1, 0.1, bodyInk)
    body.addLineXY(bx1, by1, bx0, by1, 0.1, bodyInk)
    body.addLineXY(bx0, by1, bx0, by0, 0.1, bodyInk)
    const bm = this.glow(face, "CartridgeBody", body)
    this.inkBeat(bm.mat, 2, internals)
    const coil = new MeshKit()
    const COIL_X0 = -0.6
    const COIL_DX = 0.85
    const COIL_N = 6
    const COIL_RX = 0.38
    const COIL_RY = 2.3
    for (let i = 0; i < COIL_N; i++) {
      const cx = COIL_X0 + i * COIL_DX
      const pts: vec2[] = []
      for (let j = 0; j <= 24; j++) {
        const a = (j / 24) * Math.PI * 2
        const y = MAG.y + COIL_RY * Math.sin(a)
        pts.push(new vec2(cx + COIL_RX * Math.cos(a) + 0.12 * (y - MAG.y), y))
      }
      coil.addPolylineXY(pts, 0.12, ink(SIGNAL, 0.9))
    }
    const cm = this.glow(face, "Coil", coil)
    this.inkBeat(cm.mat, 2, internals)
    // The signal leaves the coil with exactly the groove's shape (same wave, same speed).
    const COIL_X1 = COIL_X0 + (COIL_N - 1) * COIL_DX + COIL_RX
    const SIG_X0 = bx1 + 0.3
    const signal = new DynamicRibbon(face, "SignalWave", ctx.glowMat, 40, 0.24, ink(SIGNAL, 1))
    this.inkBeat(signal.mat, 2, internals)
    this.cue(B[2], () => ctx.log("coil"))
    this.cue(B[2] + 0.8, () => {
      // Magnet: lower left, outside the bubble (leader stays left of the cantilever).
      // Coil: right, above the signal. The caption sits up and left, so neither touches it.
      this.label("magnet", "Magnet", faceLocal(-R + 1, -R - 3.5), faceLocal(MAG.x - MW, MAG.y - 0.3))
      this.label("coil", "Coil", faceLocal(R + 2, MAG.y + 6), faceLocal((COIL_X0 + COIL_X1) / 2, MAG.y + COIL_RY))
    })
    this.tick((t) => {
      if (t < B[2]) return
      const xe = clipX(MAG.y) - 0.2
      const emerge = clamp01((t - B[2]) / 1.2)
      signal.update((j) => {
        const x = SIG_X0 + ((xe - SIG_X0) * j) / 39
        const lead = clamp01((x - SIG_X0) / 1.2)
        const shown = x <= SIG_X0 + (xe - SIG_X0) * emerge ? 1 : 0
        return new vec3(x, MAG.y + shown * lead * GA * 0.8 * wave(GK * (x - SIG_X0 + TIP_X) - groovePhase), 0.05)
      })
    })

    // ---------------- Beat 4: the signal travels along the line of light ----------------
    const spToUser = flat(cam.sub(speaker))
    const spFront = speaker.add(spToUser.uniformScale(4))
    // Route it like a cable, never through the turntable: forward over the top to just past the
    // front edge, down the front, along the shelf, then up into the speaker.
    const bh = bounds.size.uniformScale(0.5)
    const frontD = bounds.center.dot(toUser) + Math.abs(bh.x * toUser.x) + Math.abs(bh.z * toUser.z) + 2
    const overTop = needle.add(toUser.uniformScale(frontD - needle.dot(toUser))).add(up.uniformScale(0.6))
    const downFront = new vec3(overTop.x, shelfY + 0.4, overTop.z)
    const underSpeaker = new vec3(spFront.x, shelfY + 0.4, spFront.z)
    const linePts = [needle, overTop, downFront]
    // If the speaker sits deeper than the turntable's front, run sideways first, then back.
    if (underSpeaker.sub(downFront).dot(toUser) < -1) linePts.push(downFront.add(right.uniformScale(underSpeaker.sub(downFront).dot(right))))
    linePts.push(underSpeaker, spFront)
    const ARRIVE = B[4]
    let line: GlowPath | null = null
    const lineHair = this.hairAt(spFront)
    const N = 64
    const core = new TrailRibbon(ctx.root, "SignalPacket", ctx.glowMat, N, lineHair * 2.4, ink(SIGNAL, 1))
    const halo = new TrailRibbon(ctx.root, "SignalPacketGlow", ctx.glowMat, N, lineHair * 8, ink(SIGNAL, 0.2))
    core.setVisible(false)
    halo.setVisible(false)
    const packetA = () => (this.t < ARRIVE ? 1 : 1 - clamp01((this.t - ARRIVE) / 0.45))
    this.inkBeat(core.mat, 3, packetA)
    this.inkBeat(halo.mat, 3, packetA)
    this.cue(B[3], () => {
      ctx.log("line")
      this.unlabel("magnet")
      this.unlabel("coil")
      line = this.path("LineOfLight", linePts, lineHair * 1.1, ink(SIGNAL, 0.85), lineHair * 4)
      this.inkBeat(line.mat, 3)
      core.setVisible(true)
      halo.setVisible(true)
    })
    const toViewerL = (p: vec3) => cam.sub(this.origin.add(p)).normalize()
    this.tick((t) => {
      if (!line || t > ARRIVE + 0.5) return
      const Ltot = line.length
      const LP = 34
      const k = (2 * Math.PI) / 9
      const head = (Ltot + 6) * easeInOutCubic(phase(t, B[3], ARRIVE - 0.05))
      line.setRange(0, clamp01(head / Ltot))
      const pts: vec3[] = []
      const alphas: number[] = []
      for (let j = 0; j < N; j++) {
        const u = j / (N - 1)
        const sRaw = head - LP * u
        const s = Math.max(0, Math.min(Ltot, sRaw))
        const f = s / Ltot
        const base = line.pointAt(f)
        const ahead = line.pointAt(Math.min(1, f + 0.01))
        const behind = line.pointAt(Math.max(0, f - 0.01))
        const tan = ahead.sub(behind)
        const view = toViewerL(base)
        let n = tan.cross(view)
        n = n.length > 1e-5 ? n.normalize() : up
        if (n.dot(up) < 0) n = n.uniformScale(-1)
        // Boosted: small as it leaves the record player, full size once out on the shelf.
        const boost = 0.45 + 0.55 * clamp01(s / 22)
        const env = Math.pow(Math.sin(Math.PI * u), 0.7)
        const inside = sRaw >= 0 && sRaw <= Ltot ? 1 : 0
        pts.push(base.add(n.uniformScale(2.4 * boost * env * wave(k * (head - sRaw)))))
        alphas.push(inside * env)
      }
      const view = toViewerL(line.pointAt(0.5))
      core.update(pts, view, alphas)
      halo.update(pts, view, alphas)
    })

    // ---------------- Beat 5: the cone pushes air, rings spread into the room ----------------
    const axis = spToUser
    let coneNode: SceneObject
    let coneBase: vec3
    const coneHair = this.hairAt(spFront)
    if (ctx.coneOverride) {
      coneNode = ctx.coneOverride
      coneBase = coneNode.getTransform().getLocalPosition()
    } else {
      coneNode = this.node("SpeakerCone", spFront)
      coneNode.enabled = false
      const shape = this.node("ConeShape", vec3.zero(), coneNode)
      shape.getTransform().setLocalRotation(quat.lookAt(axis, up))
      const RC = 5.6
      const DC = 1.7
      const ck = new MeshKit()
      ck.addArcXY(0, 0, RC, coneHair * 2, 0, Math.PI * 2, ink(AMBER, 0.95), 64)
      ck.addSoftRingXY(0, 0, RC, RC + 1.6, ink(AMBER, 0.28), ZERO, 64)
      ck.addArcXY(0, 0, DC, coneHair * 1.8, 0, Math.PI * 2, ink(AMBER, 0.9), 32)
      ck.addFanXY(0, 0, DC, 0, Math.PI * 2, ink(AMBER, 0.12), ink(AMBER, 0.12), 24)
      const conemesh = this.glow(shape, "ConeRims", ck)
      const pk2 = new MeshKit()
      pk2.addRing(new vec3(0, 0, -0.9), vec3.forward(), 3.7, coneHair * 1.2, ink(AMBER, 0.35), 48)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        const c = Math.cos(a)
        const d = Math.sin(a)
        pk2.addTube([new vec3(c * DC, d * DC, -1.8), new vec3(c * RC, d * RC, 0)], coneHair * 0.7, ink(AMBER, 0.35), 4, 20)
      }
      const profile = this.glow(shape, "ConeProfile", pk2)
      this.inkBeat(conemesh.mat, 4)
      this.inkBeat(profile.mat, 4)
      coneBase = this.L(spFront)
    }
    const conePop = ctx.coneOverride ? null : this.pop(coneNode)
    const rings: Spawned[] = []
    const RING_T = 1 / 3.4
    for (let i = 0; i < 6; i++) {
      const kit = new MeshKit()
      kit.addRing(vec3.zero(), axis, 1, 0.035, ink(AMBER, 0.9), 72)
      const r = this.glow(ctx.root, "SoundRing" + i, kit)
      r.so.enabled = false
      rings.push(r)
    }
    const CONE_END = END - 0.3
    let coneOn = false
    this.cue(ARRIVE, () => {
      ctx.log("lineArrived")
      ctx.playChime()
      ctx.log("cone")
      coneOn = true
      if (conePop) conePop.show(true)
    })
    this.cue(ARRIVE + 0.7, () => {
      // Lower-right rim of the cone, label down and to the right (toward the turntable, on screen).
      const anchor = spFront.add(right.uniformScale(0.7 * 5.6)).add(up.uniformScale(-0.7 * 5.6))
      this.label("cone", "Speaker cone", spFront.add(right.uniformScale(11)).add(up.uniformScale(-10)), anchor)
    })
    this.tick((t) => {
      if (!coneOn) return
      const tt = t - ARRIVE
      const env = clamp01(tt / 0.25) * (t < CONE_END ? 1 : clamp01(1 - (t - CONE_END) / 0.4))
      // The cone moves with the same wave shape, in time.
      coneNode.getTransform().setLocalPosition(coneBase.add(axis.uniformScale(0.9 * env * wave(2 * Math.PI * 3.4 * tt))))
      const life = rings.length * RING_T
      for (let i = 0; i < rings.length; i++) {
        const spawnAt = i * RING_T
        const ring = rings[i]
        if (tt < spawnAt) continue
        const age = (tt - spawnAt) % life
        const born = t - age
        if (born > CONE_END - 0.2) {
          ring.so.enabled = false
          continue
        }
        ring.so.enabled = true
        const radius = 5.6 + age * 24
        ring.so.getTransform().setLocalScale(vec3.one().uniformScale(radius))
        ring.so.getTransform().setLocalPosition(this.L(spFront.add(axis.uniformScale(age * 16))))
        setFade(ring.mat, Math.pow(1 - age / life, 1.5) * env)
      }
    })
    this.cue(END, () => {
      ctx.log("done")
      this.hideLabels()
    })
  }
}

// =====================================================================================
// Camera: cutaway shell opens → light rays travel from the room through the lens and land
// (upside-down) on the sensor.
// =====================================================================================
export class CameraExplanation extends Explanation {
  readonly duration = 15.5

  /**
   * @param camCenter centre of the real camera (body + lens) — the DSLR on the shelf
   * @param facing direction the real lens points (into the room)
   * @param freeSide world direction with empty space beside the camera (labels go there, clear of the book)
   */
  constructor(ctx: ExplainContext, camCenter: vec3, facing: vec3, freeSide: vec3 = new vec3(-1, 0, 0)) {
    super(ctx)
    this.energies = [ENERGY.light, ENERGY.signal]
    // The shell is drawn at the real DSLR's size (body ~14 x 10 cm, body + lens ~18 cm long).
    const K = 0.65
    const f = flat(facing)
    const up = vec3.up()
    const s = up.cross(f).normalize()
    const cam = ctx.camPos()
    const m = camCenter
    const hx = 11 * K
    const hy = 8 * K
    const hz = 14 * K
    const edge = 0.2

    // Viewer frame at start: labels sit to the viewer's left of the shell and face them.
    const view = m.sub(cam).normalize()
    const vRraw = view.cross(up)
    const vR = vRraw.length > 1e-3 ? vRraw.normalize() : s
    const vU = vR.cross(view).normalize()
    const toCam = view.uniformScale(-1)
    const sideDot = vR.dot(freeSide)
    const side = Math.abs(sideDot) > 0.2 && sideDot > 0 ? vR : vR.uniformScale(-1)
    // Rays spread across the lens along the axis the viewer sees best (vertical from the side,
    // sideways from above), so the crossing and the flipped image stay readable.
    const vp = view.sub(f.uniformScale(view.dot(f)))
    let w = vp.length > 1e-3 ? f.cross(vp).normalize() : up
    if (w.dot(vU) < 0) w = w.uniformScale(-1)
    const p = f.cross(w).normalize()
    const flipWord = Math.abs(w.dot(up)) > 0.7 ? "upside-down" : "flipped"
    const ls = Math.min(1, Math.max(0.3, cam.distance(m) / 110)) // label scale (matches CutawayLabelsUI)
    const extent = (v: vec3) => Math.abs(s.dot(v)) * hx + Math.abs(up.dot(v)) * hy + Math.abs(f.dot(v)) * hz

    // Faces of the shell (the front, +f, holds the lens). The one the viewer sees best slides off.
    const faces = [
      {n: up, hn: hy, a: s, ha: hx, b: f, hb: hz},
      {n: up.uniformScale(-1), hn: hy, a: s, ha: hx, b: f, hb: hz},
      {n: s, hn: hx, a: f, ha: hz, b: up, hb: hy},
      {n: s.uniformScale(-1), hn: hx, a: f, ha: hz, b: up, hb: hy},
      {n: f.uniformScale(-1), hn: hz, a: s, ha: hx, b: up, hb: hy}
    ]
    let coverIdx = 0
    for (const i of [2, 3]) if (faces[i].n.dot(toCam) > faces[coverIdx].n.dot(toCam)) coverIdx = i
    const cf = faces[coverIdx]

    const shell = this.node("CutawayShell", m)
    shell.enabled = false
    const edges = new MeshKit()
    edges.addBoxEdges(vec3.zero(), s.uniformScale(hx), up.uniformScale(hy), f.uniformScale(hz), edge, CYAN)
    this.glow(shell, "ShellEdges", edges)
    const panels = new MeshKit()
    const pc = new vec4(0.6, 0.8, 1.0, 1)
    faces.forEach((fc, i) => {
      if (i !== coverIdx) panels.addQuad(fc.n.uniformScale(fc.hn), fc.a.uniformScale(fc.ha), fc.b.uniformScale(fc.hb), pc)
    })
    this.model(shell, "ShellPanels", panels, 0.16)
    const coverKit = new MeshKit()
    coverKit.addQuad(vec3.zero(), cf.a.uniformScale(cf.ha), cf.b.uniformScale(cf.hb), new vec4(0.7, 0.88, 1.0, 1))
    const cover = this.model(shell, "ShellCover", coverKit, 0.55, cf.n.uniformScale(cf.hn))

    const lensC = f.uniformScale(hz - 4 * K)
    const lensKit = new MeshKit()
    lensKit.addLathe(
      lensC,
      f,
      [
        [0, -1.4 * K],
        [2.5 * K, -1.1 * K],
        [4.5 * K, -0.5 * K],
        [5.2 * K, 0],
        [4.5 * K, 0.5 * K],
        [2.5 * K, 1.1 * K],
        [0, 1.4 * K]
      ],
      [new vec4(0.75, 0.92, 1, 1)],
      36
    )
    this.model(shell, "Lens", lensKit, 0.8)
    const lensRim = new MeshKit()
    lensRim.addRing(lensC, f, 5.3 * K, edge, CYAN, 64)
    this.glow(shell, "LensRim", lensRim)

    const sensorC = f.uniformScale(-hz + 3 * K)
    const sensorKit = new MeshKit()
    sensorKit.addQuad(sensorC, s.uniformScale(4 * K), up.uniformScale(3 * K), new vec4(0.45, 1.0, 0.6, 1))
    const sensor = this.glow(shell, "Sensor", sensorKit)
    setFade(sensor.mat, 0.35)

    const shellPop = this.pop(shell)
    const lensW = m.add(lensC)
    const sensorW = m.add(sensorC)

    // Label anchors: beside the shell on the free side, at the lens / sensor screen height
    // (spread apart when the two overlap on screen, e.g. when looking down the lens axis).
    const eR = extent(side)
    let lensY = lensC.dot(vU)
    let sensY = sensorC.dot(vU)
    if (Math.abs(lensY - sensY) < 7) {
      const mid = (lensY + sensY) / 2
      const sign = lensY >= sensY ? 1 : -1
      lensY = mid + 3.5 * sign
      sensY = mid - 3.5 * sign
    }
    const beside = (y: number, halfW: number) =>
      m.add(vU.uniformScale(y)).add(side.uniformScale(eR + 2 + halfW * ls)).add(toCam.uniformScale(3))
    const lensLabelW = beside(lensY, 2.5)
    // Stop pill: beside the shell on the other side from the labels, at mid height.
    this.stopHint = m.add(side.uniformScale(-(eR + 3 + 3.5 * ls))).add(toCam.uniformScale(3))
    const sensorLabelW = beside(sensY, 5.5)
    // Question caption: just behind the camera body, i.e. on the opposite side from the rays.
    this.captionHint = m.add(f.uniformScale(-(hz + 5))).add(up.uniformScale(hy)).add(toCam.uniformScale(4))

    this.cue(0.2, () => {
      ctx.log("shell")
      shellPop.show(true)
    })
    this.cue(1.2, () => {
      ctx.log("cutaway")
      this.label("lens", "Lens", lensLabelW)
      this.label("sensor", "Sensor", sensorLabelW)
    })
    this.tick((t) => {
      const c = easeInOut(phase(t, 1.2, 1.8))
      cover.so.getTransform().setLocalPosition(cf.n.uniformScale(cf.hn + 10 * c))
      setFade(cover.mat, 0.55 * (1 - c), true)
      if (c >= 1) cover.so.enabled = false
    })

    // ---- rays from the room, through the lens, onto the sensor (inverted) ----
    const D = 22
    const H = 7
    const srcMid = m.add(f.uniformScale(D))
    const srcTop = srcMid.add(w.uniformScale(H))
    const srcBot = srcMid.add(w.uniformScale(-H))
    const imgTop = sensorW.add(w.uniformScale(-2.4 * K))
    const imgBot = sensorW.add(w.uniformScale(2.4 * K))
    const rayDefs = [
      {src: srcTop, hit: 3.5, img: imgTop, col: WARM},
      {src: srcTop, hit: 0, img: imgTop, col: WARM},
      {src: srcTop, hit: -3.5, img: imgTop, col: WARM},
      {src: srcBot, hit: 2, img: imgBot, col: CYAN},
      {src: srcBot, hit: -2, img: imgBot, col: CYAN}
    ]
    const RAYS = 3.2
    const rays: {p: GlowPath; h: SceneObject; start: number}[] = []
    const srcKit = new MeshKit()
    srcKit.addSphere(this.L(srcTop), 0.9, WARM, 6, 10)
    srcKit.addSphere(this.L(srcBot), 0.9, CYAN, 6, 10)
    const srcs = this.glow(ctx.root, "RaySources", srcKit)
    srcs.so.enabled = false
    // Just beyond the two sources (away from the lens), so no ray crosses the text.
    const lightLabelW = srcMid.add(f.uniformScale(4)).add(toCam.uniformScale(2))
    this.cue(RAYS - 0.2, () => {
      srcs.so.enabled = true
      this.label("light", "Light from the room", lightLabelW)
    })
    this.cue(RAYS, () => {
      ctx.log("rays")
      rayDefs.forEach((d, i) => {
        const hitW = lensW.add(w.uniformScale(d.hit * K))
        const p = this.path("Ray" + i, [d.src, hitW, d.img], 0.2, d.col, 0.6)
        rays.push({p, h: this.headSphere("RayHead" + i, 0.6, d.col), start: RAYS + i * 0.35})
      })
    })
    this.tick((t) => {
      for (const r of rays) {
        const k = easeInOut(phase(t, r.start, r.start + 3.0))
        r.p.setRange(0, k)
        r.h.enabled = k > 0 && k < 1
        r.h.getTransform().setLocalPosition(r.p.pointAt(k))
      }
    })

    // ---- the picture forms on the sensor ----
    const SENSOR = 8.4
    const arrowKit = new MeshKit()
    const ac = sensorC.add(f.uniformScale(0.3))
    // The picture of the (warm) top of the scene lands at the far side: an arrow pointing the "wrong" way.
    arrowKit.addTube([ac.add(w.uniformScale(2.2 * K)), ac.add(w.uniformScale(-2.2 * K))], 0.15, WARM, 5, 1)
    arrowKit.addTube([ac.add(w.uniformScale(-2.2 * K)), ac.add(w.uniformScale(-1.2 * K)).add(p.uniformScale(1.0 * K))], 0.15, WARM, 5, 1)
    arrowKit.addTube([ac.add(w.uniformScale(-2.2 * K)), ac.add(w.uniformScale(-1.2 * K)).add(p.uniformScale(-1.0 * K))], 0.15, WARM, 5, 1)
    const arrow = this.glow(shell, "SensorImage", arrowKit)
    arrow.so.enabled = false
    this.cue(SENSOR, () => {
      ctx.log("sensor")
      arrow.so.enabled = true
      this.unlabel("light")
      this.label("sensor", "Light lands " + flipWord + "\non the sensor: a photo", sensorLabelW)
    })
    this.tick((t) => {
      if (t < SENSOR) return
      setFade(sensor.mat, 0.6 + 0.4 * Math.sin((t - SENSOR) * 5))
      setFade(arrow.mat, clamp01((t - SENSOR) / 0.4))
    })
    this.cue(14.6, () => {
      ctx.log("done")
      this.hideLabels()
    })
  }
}

// =====================================================================================
// Lamp: current flows along the cord (beads), reaches the bulb, the filament glows and
// light rays stream out.
// =====================================================================================
export class LampExplanation extends Explanation {
  readonly duration = 15.5

  constructor(ctx: ExplainContext, shade: vec3, base: vec3, cordStart: vec3) {
    super(ctx)
    this.energies = [ENERGY.signal, ENERGY.light]
    const up = vec3.up()
    const floorY = base.y - 1
    const bulb = shade.add(up.uniformScale(-4))
    // Screen-right as seen by the user: labels go beside the lamp, clear of the pole and the question caption.
    const right = flat(ctx.camPos().sub(base)).uniformScale(-1).cross(up).normalize()
    const cordPts = [
      cordStart,
      new vec3(cordStart.x, floorY, cordStart.z),
      new vec3(base.x, floorY, base.z),
      new vec3(base.x, shade.y - 14, base.z),
      bulb
    ]
    const cord = this.path("Cord", cordPts, 0.7, new vec4(0.95, 0.62, 0.26, 1), 2.0)
    const N_BEADS = 9
    const beads: SceneObject[] = []
    for (let i = 0; i < N_BEADS; i++) beads.push(this.headSphere("Current" + i, 1.5, new vec4(1, 0.92, 0.6, 1)))
    const SPEED = 55
    const CORD = 0.2

    this.cue(CORD, () => {
      ctx.log("cord")
      ctx.log("flow")
      this.label("cord", "Current flows through the cord", base.add(right.uniformScale(42)).add(up.uniformScale(14)))
    })
    this.tick((t) => {
      if (t < CORD) return
      cord.setRange(0, easeInOut(phase(t, CORD, CORD + 0.8)))
      cord.setOpacity(0.5)
      const run = t - CORD - 0.6
      for (let i = 0; i < N_BEADS; i++) {
        if (run < 0) {
          beads[i].enabled = false
          continue
        }
        const fr = (((run * SPEED) / cord.length + i / N_BEADS) % 1 + 1) % 1
        beads[i].enabled = true
        beads[i].getTransform().setLocalPosition(cord.pointAt(fr))
      }
    })

    // ---- bulb + filament glow ----
    const BULB = 6.8
    const bulbNode = this.node("Bulb", bulb)
    bulbNode.enabled = false
    const coreKit = new MeshKit()
    coreKit.addSphere(vec3.zero(), 4.5, new vec4(0.6, 0.45, 0.25, 1), 8, 12)
    coreKit.addSphere(vec3.zero(), 10, new vec4(0.2, 0.15, 0.08, 0.2), 8, 12)
    const core = this.glow(bulbNode, "BulbGlow", coreKit)
    const filKit = new MeshKit()
    const zig: vec3[] = []
    for (let i = 0; i <= 8; i++) zig.push(new vec3(-2 + i * 0.5, i % 2 === 0 ? -0.6 : 0.6, 0))
    filKit.addTube(zig, 0.22, new vec4(1, 0.95, 0.8, 1), 5, 1)
    this.glow(bulbNode, "Filament", filKit)
    const bulbPop = this.pop(bulbNode)
    this.cue(BULB, () => {
      ctx.log("bulb")
      bulbPop.show(true)
      this.unlabel("cord")
      this.label("bulb", "The hot filament glows: that's light", bulb.add(right.uniformScale(56)))
    })
    this.tick((t) => {
      if (t < BULB) return
      setFade(core.mat, 0.85 + 0.15 * Math.sin(t * 9))
    })

    // ---- rays stream out of the shade ----
    const RAYS = 7.6
    const rays: {p: GlowPath; offset: number}[] = []
    this.cue(RAYS, () => {
      ctx.log("rays")
      const n = 14
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2
        const el = -0.25 - 0.5 * ((i * 7) % 5) / 4
        const dir = new vec3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize()
        const p = this.path("LightRay" + i, [bulb.add(dir.uniformScale(8)), bulb.add(dir.uniformScale(48))], 0.3, new vec4(1, 0.86, 0.55, 1), 1.0)
        rays.push({p, offset: ((i * 5) % n) / n})
      }
    })
    this.tick((t) => {
      if (t < RAYS) return
      for (const r of rays) {
        const h = ((t - RAYS) * 0.9 + r.offset) % 1.3
        r.p.setRange(Math.max(0, h - 0.35), Math.min(1, h))
      }
    })
    this.cue(14.4, () => {
      ctx.log("done")
      this.hideLabels()
    })
  }
}
