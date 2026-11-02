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
  /** Mirror flip + shutter click, played from the camera body. */
  playClick?: () => void
  /** Soft rising power-up tone, played from the lamp as its light comes on. */
  playPowerUp?: () => void
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
  protected beats(starts: number[], captions: (string | null)[], end: number): void {
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

  /** Flat glow drawing (MeshKit XY primitives), visible from both sides. */
  protected flat(parent: SceneObject, name: string, kit: MeshKit, localPos?: vec3): Spawned {
    const s = this.glow(parent, name, kit, localPos)
    s.mat.mainPass.twoSided = true
    return s
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
   * `axes` orients the box to the object (unit vectors for size.x / size.y / size.z); default world axes.
   */
  protected ghostShell(name: string, center: vec3, size: vec3, beat: number, at: number, axes?: {x: vec3; y: vec3; z: vec3}): SceneObject {
    const shell = this.node(name, center)
    const h = size.uniformScale(0.5)
    const r = this.hairAt(center)
    const X = axes ? axes.x.normalize() : new vec3(1, 0, 0)
    const Y = axes ? axes.y.normalize() : new vec3(0, 1, 0)
    const Z = axes ? axes.z.normalize() : new vec3(0, 0, 1)
    const ax = X.uniformScale(h.x)
    const ay = Y.uniformScale(h.y)
    const az = Z.uniformScale(h.z)
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
          const p = ax.uniformScale(sx).add(ay.uniformScale(sy)).add(az.uniformScale(sz))
          ck.addTube([p, p.add(X.uniformScale(-sx * arm(h.x)))], r * 0.85, c, 4, 50)
          ck.addTube([p, p.add(Y.uniformScale(-sy * arm(h.y)))], r * 0.85, c, 4, 50)
          ck.addTube([p, p.add(Z.uniformScale(-sz * arm(h.z)))], r * 0.85, c, 4, 50)
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
// Camera — "How does it take a picture?" Five beats on the DSLR. The x-ray window is a side
// section through the lens axis, turned to face the viewer: lens elements, mirror and sensor drawn
// as thin lines. Light is warm white; cyan appears only on the sensor, in beat 5.
// =====================================================================================
export class CameraExplanation extends Explanation {
  static readonly BEATS = [0.05, 3.4, 7.0, 10.6, 14.2]
  static readonly END = 17.6
  readonly duration = CameraExplanation.END + 0.25

  /**
   * @param facing direction the real lens points (into the room); only its horizontal part is used
   * @param body the real DSLR body in cm: x = depth along the lens axis, y = height, z = width.
   *             It is centred on the station's bounds centre.
   */
  constructor(ctx: ExplainContext, facing: vec3, body: vec3) {
    super(ctx)
    this.energies = [ENERGY.light, ENERGY.signal]
    const B = CameraExplanation.BEATS
    const END = CameraExplanation.END
    const LIGHT = ENERGY.light
    const SIGNAL = ENERGY.signal
    const cam = ctx.camPos()
    const up = vec3.up()
    const f = flat(facing)
    const grip = f.cross(up).normalize() // the camera's right-hand side
    const D = body.x
    const H = body.y
    const Wb = body.z
    const center = ctx.bounds.center
    // Section coordinates are laid out for an 11.5 x 11.3 cm body and stretch with the real one.
    const kx = D / 11.5
    const ky = H / 11.3
    const X = (v: number) => v * kx
    const Y = (v: number) => v * ky
    const hair = this.hairAt(center)
    const LW = hair * 1.5 // part lines
    const LWF = hair * 1.25 // faint context lines

    this.beats(
      B,
      [
        null,
        "Light from the scene enters the lens.",
        "The lens bends the light so the rays cross.",
        "On the sensor, the image lands upside down.",
        "Each pixel turns light into signal."
      ],
      END
    )

    // ---------------- Beat 1: ghost shell on the body, then the x-ray window opens ----------------
    this.cue(B[0], () => ctx.log("shell"))
    this.ghostShell("GhostShell", center, new vec3(D, H, Wb), 0, B[0], {x: f, y: up, z: grip})

    // The section plane holds the lens axis and turns toward the viewer (every plane through the
    // axis is a true section; this one reads best). Local x runs along the axis toward the lens,
    // local y is the section's "up". The mount sits 42% up the body, a little off the grip.
    const axisO = center.add(up.uniformScale(-0.08 * H)).add(grip.uniformScale(-0.136 * Wb))
    const toCam = cam.sub(axisO).normalize()
    let n = toCam.sub(f.uniformScale(toCam.dot(f)))
    n = n.length > 1e-3 ? n.normalize() : grip
    let w = n.cross(f).normalize()
    if (w.dot(up) < 0) {
      w = w.uniformScale(-1)
      n = n.uniformScale(-1)
    }
    const sec = this.node("CameraSection", axisO)
    const secT = sec.getTransform()
    secT.setWorldRotation(quat.lookAt(n, w))
    const toWorld = (x: number, y: number) => secT.getWorldTransform().multiplyPoint(new vec3(x, y, 0))

    // Layout along the axis (cm from the body centre): back, sensor, mirror hinge, mount, lens.
    const xSensor = X(-1.25)
    const xMount = X(4.75)
    const xLens = X(7.25) // where the rays bend (middle of the lens group)
    const xFront = X(9.75)
    const yBottom = Y(-4.75)
    const barrelR = Y(3.0)
    const hinge = new vec3(X(-0.25), Y(1.8), 0)
    const mirrorLen = 4.8 * kx
    const sensorH = Y(2.0)

    // X-ray window: thin rim, faint inner glow (fill under 10%). It grows out of the dot.
    const winC = new vec3(X(2.0), Y(0.9), 0)
    const RW = 9.8 * Math.max(kx, ky)
    const dotLocal = secT.getInvertedWorldTransform().multiplyPoint(this.origin)
    const win = this.node("XrayWindow", winC, sec)
    win.getTransform().setLocalScale(vec3.one().uniformScale(1e-4))
    const winOpen = () => easeOutCubic(phase(this.t, B[0] + 0.15, B[0] + 0.5))
    this.tick(() => {
      const k = winOpen()
      win.getTransform().setLocalPosition(vec3.lerp(dotLocal, winC, k))
      win.getTransform().setLocalScale(vec3.one().uniformScale(Math.max(1e-4, k)))
    })
    this.cue(B[0] + 0.15, () => ctx.log("cutaway"))
    const rk = new MeshKit()
    rk.addArcXY(0, 0, RW, hair * 1.4, 0, Math.PI * 2, ink(UI_WHITE, 0.6), 128)
    rk.addFanXY(0, 0, RW * 0.72, 0, Math.PI * 2, ink(UI_WHITE, 0.02), ink(UI_WHITE, 0.03), 64)
    rk.addSoftRingXY(0, 0, RW * 0.72, RW - hair, ink(UI_WHITE, 0.03), ink(UI_WHITE, 0.09), 96)
    const rim = this.flat(win, "XrayRim", rk)
    this.inkBeat(rim.mat, 0, winOpen)

    // Parts are drawn in window-local coordinates.
    const wx = (x: number) => x - winC.x
    const wy = (y: number) => y - winC.y
    const seg = (k: MeshKit, x0: number, y0: number, x1: number, y1: number, width: number, c: vec4) =>
      k.addLineXY(wx(x0), wy(y0), wx(x1), wy(y1), width, c)
    const poly = (k: MeshKit, pts: number[][], width: number, c: vec4) => k.addPolylineXY(pts.map((p) => new vec2(wx(p[0]), wy(p[1]))), width, c)
    const partsIn = (delay: number) => () => winOpen() * easeOutCubic((this.t - B[0] - 0.35 - delay) / 0.3)

    // Context (faint): lens barrel, focusing screen and pentaprism (the viewfinder path).
    const faint = ink(UI_WHITE, 0.45)
    const ck = new MeshKit()
    poly(ck, [[xMount, -barrelR], [xFront, -barrelR], [xFront, barrelR], [xMount, barrelR]], LWF, faint)
    seg(ck, xMount, -barrelR - Y(0.4), xMount, barrelR + Y(0.4), LWF, faint)
    seg(ck, X(-0.4), Y(2.05), X(4.5), Y(2.05), LWF, faint)
    poly(ck, [[X(-0.4), Y(2.35)], [X(4.4), Y(2.35)], [X(2.8), Y(5.2)], [X(0.0), Y(5.2)], [X(-0.4), Y(4.4)], [X(-0.4), Y(2.35)]], LWF, faint)
    const ctxMesh = this.flat(win, "SectionContext", ck)
    this.inkBeat(ctxMesh.mat, 2, partsIn(0))

    // Lens elements (they handle light: warm white).
    const lensInk = ink(LIGHT, 0.8)
    const lensKit = new MeshKit()
    const lensEl = (cx: number, h: number, tc: number, te: number) => {
      const N = 14
      const L: number[][] = []
      const R: number[][] = []
      for (let i = 0; i <= N; i++) {
        const y = -h + (2 * h * i) / N
        const q = (y / h) * (y / h)
        const half = tc >= te ? te / 2 + ((tc - te) / 2) * (1 - q) : tc / 2 + ((te - tc) / 2) * q
        L.push([cx - half, y])
        R.push([cx + half, y])
      }
      poly(lensKit, L, LW, lensInk)
      poly(lensKit, R, LW, lensInk)
      seg(lensKit, L[0][0], -h, R[0][0], -h, LW, lensInk)
      seg(lensKit, L[N][0], h, R[N][0], h, LW, lensInk)
    }
    lensEl(X(8.9), Y(2.6), X(1.0), X(0.25))
    lensEl(X(7.25), Y(2.0), X(0.25), X(0.8))
    lensEl(X(5.7), Y(2.3), X(0.85), X(0.25))
    const lens = this.flat(win, "Lens", lensKit)
    this.inkBeat(lens.mat, 2, partsIn(0))

    // Mirror: hinged at its top-back edge, down at 45° (it sends light up to the viewfinder).
    const mirror = this.node("Mirror", new vec3(wx(hinge.x), wy(hinge.y), 0.02), win)
    const mk = new MeshKit()
    mk.addLineXY(0, 0, mirrorLen, 0, LW * 1.3, ink(LIGHT, 0.95))
    mk.addLineXY(0, -0.18, mirrorLen, -0.18, LWF, ink(LIGHT, 0.35))
    const mirrorMesh = this.flat(mirror, "MirrorMesh", mk)
    this.inkBeat(mirrorMesh.mat, 3, partsIn(0.07))
    const DOWN = -Math.PI / 4
    let mirrorAngle = DOWN
    mirror.getTransform().setLocalRotation(quat.angleAxis(DOWN, vec3.forward()))

    // Sensor: a pixel grid seen at an angle (oblique), its front edge where the image lands.
    const ROWS = 8
    const COLS = 3
    const dv = new vec3(X(-1.1), Y(0.65), 0)
    const cell = (x: number, y: number, d: number) => new vec3(x + dv.x * d, y + dv.y * d, 0)
    const sk = new MeshKit()
    const sensorInk = ink(LIGHT, 0.55)
    for (let r = 0; r <= ROWS; r++) {
      const y = -sensorH + (2 * sensorH * r) / ROWS
      const a = cell(xSensor, y, 0)
      const b = cell(xSensor, y, 1)
      seg(sk, a.x, a.y, b.x, b.y, LWF, sensorInk)
    }
    for (let c = 0; c <= COLS; c++) {
      const a = cell(xSensor, -sensorH, c / COLS)
      const b = cell(xSensor, sensorH, c / COLS)
      seg(sk, a.x, a.y, b.x, b.y, c === 0 ? LW : LWF, c === 0 ? ink(LIGHT, 0.85) : sensorInk)
    }
    const sensor = this.flat(win, "Sensor", sk)
    this.inkBeat(sensor.mat, 4, partsIn(0.14))

    // Labels: each anchored on its part, with a short leader to just outside the rim.
    const outside = (ax: number, ay: number, dx: number, dy: number, margin: number) => {
      const d = new vec2(dx, dy).normalize()
      const px = ax - winC.x
      const py = ay - winC.y
      const b = px * d.x + py * d.y
      const c = px * px + py * py - (RW + margin) * (RW + margin)
      const t = -b + Math.sqrt(Math.max(0, b * b - c))
      return toWorld(ax + d.x * t, ay + d.y * t)
    }
    const mirrorMid = hinge.add(new vec3(Math.cos(DOWN), Math.sin(DOWN), 0).uniformScale(mirrorLen / 2))
    this.cue(B[0] + 0.9, () => this.label("lens", "Lens", outside(X(8.9), Y(2.75), 0.6, 0.8, 1.4), toWorld(X(8.9), Y(2.75))))
    this.cue(B[0] + 1.0, () => this.label("mirror", "Mirror", outside(mirrorMid.x, mirrorMid.y, 0.35, -0.94, 1.0), toWorld(mirrorMid.x, mirrorMid.y)))
    this.cue(B[0] + 1.1, () => this.label("sensor", "Sensor", outside(xSensor, -sensorH, -0.6, -0.8, 1.6), toWorld(xSensor, -sensorH)))

    // ---------------- Beat 2: the subject, and light from it entering the lens ----------------
    const DIST = 36 // subject in front of the lens (cm)
    const xObj = xLens + DIST
    const yBase = yBottom + Y(0.6)
    const yTip = yBase + 11
    const mag = (xLens - xSensor) / DIST
    const imgTip = -mag * yTip
    const imgBase = -mag * yBase
    const subject = this.node("SubjectArrow", new vec3(xObj, yBase, 0), sec)
    const ak = new MeshKit()
    const AH = yTip - yBase
    ak.addLineXY(0, 0, 0, AH, LW * 1.4, ink(LIGHT, 1), hair * 2.5, ink(LIGHT, 0.18))
    ak.addLineXY(0, AH, -0.95, AH - 1.4, LW * 1.4, ink(LIGHT, 1))
    ak.addLineXY(0, AH, 0.95, AH - 1.4, LW * 1.4, ink(LIGHT, 1))
    for (const y of [0, AH]) {
      ak.addFanXY(0, y, 0.35, 0, Math.PI * 2, ink(LIGHT, 1), ink(LIGHT, 0.6), 16)
      ak.addSoftRingXY(0, y, 0.35, 1.3, ink(LIGHT, 0.22), ZERO, 24)
    }
    const arrowMesh = this.flat(subject, "SubjectMesh", ak)
    const arrowIn = () => easeOutCubic((this.t - B[1] - 0.1) / 0.3)
    // Stays bright through beat 4, so the upright subject and the upside-down image can be compared.
    this.inkBeat(arrowMesh.mat, 3, arrowIn)
    subject.getTransform().setLocalScale(vec3.one().uniformScale(1e-4))
    this.tick(() => subject.getTransform().setLocalScale(vec3.one().uniformScale(Math.max(1e-4, arrowIn()))))
    this.cue(B[1] + 0.1, () => ctx.log("arrow"))
    this.cue(B[1] + 0.7, () => this.label("subject", "Subject", toWorld(xObj + 2.6, yBase - 3.4), toWorld(xObj, yBase)))

    // Rays: from the tip and the base to three points on the lens; one clean bend there; then
    // down to the mirror (beat 3) or, once it flips up, on to the sensor (beat 4).
    const mU = new vec3(Math.cos(DOWN), Math.sin(DOWN), 0)
    const mN = new vec3(-mU.y, mU.x, 0) // faces the lens and the viewfinder
    const cross2 = (a: vec3, b: vec3) => a.x * b.y - a.y * b.x
    const yScreen = Y(4.4)
    const FLIP = B[3] + 0.35
    const rays: {pin: GlowPath; pout: GlowPath; pb: GlowPath; pf: GlowPath; hitF: number; head: SceneObject; st: number}[] = []
    const rayOpts = (c: vec4) => ({radius: hair * 0.55, color: c, halo: hair * 2.2, haloAlpha: 0.16, sides: 5, step: 0.6})
    const bounceA = () => 1 - clamp01((this.t - FLIP) / 0.15)
    let ri = 0
    for (const [ySrc, yImg] of [[yTip, imgTip], [yBase, imgBase]]) {
      for (const h of [Y(1.4), 0, Y(-1.4)]) {
        const src = new vec3(xObj, ySrc, 0)
        const lp = new vec3(xLens, h, 0)
        const img = new vec3(xSensor, yImg, 0)
        const d = img.sub(lp)
        const t = cross2(hinge.sub(lp), mU) / cross2(d, mU)
        const hit = lp.add(d.uniformScale(t))
        const dn = d.normalize()
        const refl = dn.sub(mN.uniformScale(2 * dn.dot(mN)))
        const bEnd = hit.add(refl.uniformScale((yScreen - hit.y) / Math.max(0.2, refl.y)))
        const c = ink(LIGHT, 0.9)
        const pin = new GlowPath(sec, "Ray" + ri, ctx.glowMat, [src, lp], rayOpts(c))
        const pout = new GlowPath(sec, "RayBent" + ri, ctx.glowMat, [lp, hit], rayOpts(c))
        const pb = new GlowPath(sec, "RayViewfinder" + ri, ctx.glowMat, [hit, bEnd], rayOpts(ink(LIGHT, 0.7)))
        // Beat 4 lights the whole path from the lens to the sensor; it grows on from the mirror point.
        const pf = new GlowPath(sec, "RayToSensor" + ri, ctx.glowMat, [lp, hit, img], rayOpts(c))
        const hitF = lp.distance(hit) / (lp.distance(hit) + hit.distance(img))
        this.inkBeat(pin.mat, 1)
        this.inkBeat(pout.mat, 2, () => (this.t < FLIP + 0.15 ? 1 : 0))
        this.inkBeat(pb.mat, 2, bounceA)
        this.inkBeat(pf.mat, 3)
        const hk = new MeshKit()
        hk.addFanXY(0, 0, hair * 2.2, 0, Math.PI * 2, ink(LIGHT, 1), ink(LIGHT, 0.7), 16)
        hk.addSoftRingXY(0, 0, hair * 2.2, hair * 6, ink(LIGHT, 0.3), ZERO, 20)
        const head = this.flat(sec, "RayHead" + ri, hk)
        head.so.enabled = false
        this.inkBeat(head.mat, 4)
        rays.push({pin, pout, pb, pf, hitF, head: head.so, st: ri * 0.07})
        ri++
      }
    }
    this.cue(B[1] + 0.5, () => ctx.log("rays"))
    this.cue(B[2] + 0.3, () => ctx.log("bend"))
    this.tick((t) => {
      for (const r of rays) {
        const kin = easeInOutCubic(phase(t, B[1] + 0.5 + r.st, B[1] + 1.6 + r.st))
        const kout = easeInOutCubic(phase(t, B[2] + 0.3 + r.st, B[2] + 0.75 + r.st))
        const kb = easeOutCubic(phase(t, B[2] + 0.75 + r.st, B[2] + 1.1 + r.st))
        const kf = easeInOutCubic(phase(t, FLIP + 0.15 + r.st, FLIP + 0.5 + r.st))
        if (kin > 0) r.pin.setRange(0, kin)
        if (kout > 0) r.pout.setRange(0, kout)
        if (kb > 0 && t < FLIP + 0.2) r.pb.setRange(0, kb)
        else if (t >= FLIP + 0.2) r.pb.setRange(0, 0)
        if (kf > 0) r.pf.setRange(0, r.hitF + (1 - r.hitF) * kf)
        let head: vec3 | null = null
        if (kin > 0 && kin < 1) head = r.pin.pointAt(kin)
        else if (kout > 0 && kout < 1) head = r.pout.pointAt(kout)
        else if (kb > 0 && kb < 1) head = r.pb.pointAt(kb)
        else if (kf > 0 && kf < 1) head = r.pf.pointAt(r.hitF + (1 - r.hitF) * kf)
        r.head.enabled = head !== null
        if (head) r.head.getTransform().setLocalPosition(head.add(new vec3(0, 0, 0.05)))
      }
    })

    // ---------------- Beat 4: the mirror flips up (click); the image lands upside down ----------------
    this.cue(FLIP, () => {
      ctx.log("mirror")
      if (ctx.playClick) ctx.playClick()
      ctx.log("click")
    })
    this.tick((t) => {
      // A fast mechanical flip (130 ms), then it stays up against the focusing screen.
      const a = DOWN * (1 - easeOutCubic(phase(t, FLIP, FLIP + 0.13)))
      if (a !== mirrorAngle) {
        mirrorAngle = a
        mirror.getTransform().setLocalRotation(quat.angleAxis(a, vec3.forward()))
      }
    })
    const image = this.node("SensorImage", vec3.zero(), sec)
    const ik = new MeshKit()
    const xi = xSensor + 0.05
    ik.addLineXY(xi, imgBase, xi, imgTip, LW * 1.7, ink(LIGHT, 1), hair * 2.5, ink(LIGHT, 0.25))
    ik.addLineXY(xi, imgTip, xi - 0.5, imgTip + 0.65, LW * 1.6, ink(LIGHT, 1))
    ik.addLineXY(xi, imgTip, xi + 0.5, imgTip + 0.65, LW * 1.6, ink(LIGHT, 1))
    const imageMesh = this.flat(image, "SensorImageMesh", ik)
    this.inkBeat(imageMesh.mat, 3, this.ramp(FLIP + 0.5, 0.3))
    image.enabled = false
    this.cue(FLIP + 0.5, () => {
      ctx.log("sensor")
      image.enabled = true
    })

    // ---------------- Beat 5: the pixels it lands on flash cyan, row by row ----------------
    const PIX = B[4] + 0.3
    const lo = Math.min(imgTip, imgBase)
    const hi = Math.max(imgTip, imgBase)
    let row = 0
    for (let r = ROWS - 1; r >= 0; r--) {
      const y0 = -sensorH + (2 * sensorH * r) / ROWS
      const y1 = y0 + (2 * sensorH) / ROWS
      if (y1 < lo || y0 > hi) continue
      const fk = new MeshKit()
      for (let c = 0; c < COLS; c++) {
        const ctr = cell(xSensor, (y0 + y1) / 2, (c + 0.5) / COLS)
        const half = 0.43
        const du = new vec3((dv.x / COLS) * half, (dv.y / COLS) * half, 0)
        const dy = new vec3(0, ((y1 - y0) / 2) * 0.86, 0)
        fk.addQuad(new vec3(wx(ctr.x), wy(ctr.y), 0.01), dy, du, ink(SIGNAL, 1))
      }
      const fm = this.flat(win, "Pixels" + r, fk)
      const t0 = PIX + 0.05 * row
      this.inkBeat(fm.mat, 4, () => {
        const tt = this.t - t0
        if (tt < 0) return 0
        if (tt < 0.07) return tt / 0.07
        return 0.6 + 0.4 * Math.exp(-(tt - 0.07) / 0.35)
      })
      row++
    }
    this.cue(PIX, () => ctx.log("pixels"))

    // Text and controls: the question (with the caption under it) above the window, Stop below.
    const v = center.sub(cam).normalize()
    const vR = v.cross(up).normalize()
    const vU = vR.cross(v).normalize()
    const ui = ctx.uiScale
    const wc = toWorld(winC.x, winC.y)
    const overBody = vR.uniformScale(center.sub(wc).dot(vR))
    this.captionHint = wc.add(overBody).add(vU.uniformScale(RW + 0.8 * ui + 1.3 * ui + 0.9 * ui + 1.6 * ui))
    this.stopHint = wc.add(overBody).add(vU.uniformScale(-(RW + 3.1 * ui))).add(v.uniformScale(-2))

    this.cue(END, () => {
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
