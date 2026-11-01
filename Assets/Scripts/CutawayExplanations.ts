/**
 * Hard-coded "direction scripts" for the three objects. Each explanation is a short timeline
 * of cues built from a small effects library: magnify bubble, line of light, flow (beads),
 * rays, cutaway shell, labels, pulse rings and cone motion.
 *
 * Every effect object lives under `ctx.root`, whose world position is the object's dot anchor,
 * so CutawayMain can collapse the whole explanation into that dot by scaling the root to zero.
 */
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {DynamicRibbon, GlowPath, MeshKit, setFade, spawnMesh, Spawned} from "./CutawayGeometry"
import {clamp01, easeInOut, Pop, yawToward} from "./CutawayTween"

export interface ExplainContext {
  root: SceneObject
  glowMat: Material
  modelMat: Material
  labels: CutawayLabelsUI
  camPos: () => vec3
  log: (phase: string) => void
  playChime: () => void
  coneOverride?: SceneObject | null
}

const CYAN = new vec4(0.55, 0.9, 1.0, 1)
const WARM = new vec4(1.0, 0.8, 0.45, 1)
const WHITE = new vec4(0.92, 0.96, 1.0, 1)

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

export abstract class Explanation {
  t = 0
  abstract readonly duration: number
  protected origin: vec3
  private cues: {at: number; fn: () => void; done: boolean}[] = []
  private tickers: ((t: number, dt: number) => void)[] = []
  private labelIds: string[] = []
  private pops: Pop[] = []

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
  }

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

  protected label(id: string, text: string, worldPos: vec3): void {
    if (this.labelIds.indexOf(id) < 0) this.labelIds.push(id)
    this.ctx.labels.show(id, text, worldPos)
  }

  protected unlabel(id: string): void {
    this.ctx.labels.hide(id)
  }

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
}

// =====================================================================================
// Record player: magnify bubble at the needle → line of light along the shelf → speaker
// cone moves → chime from the speaker.
// =====================================================================================
export class RecordPlayerExplanation extends Explanation {
  readonly duration = 16.5

  constructor(ctx: ExplainContext, needle: vec3, speaker: vec3, shelfY: number) {
    super(ctx)
    const cam = ctx.camPos()
    const toUser = flat(cam.sub(needle))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    const up = vec3.up()

    // ---- 1. Magnify bubble opens at the needle ----
    const bubbleTarget = needle.add(right.uniformScale(46)).add(up.uniformScale(8)).add(toUser.uniformScale(18))
    const R = 12
    // Grow the bubble with viewing distance so it stays readable from ~3-5 m (1x at 3.2 m).
    const S = Math.min(1.8, Math.max(1, cam.sub(needle).length / 320))
    const RS = R * S
    const bubble = this.node("MagnifyBubble", needle)
    bubble.enabled = false
    const face = this.node("BubbleFace", vec3.zero(), bubble)
    face.getTransform().setLocalScale(vec3.one().uniformScale(S))
    const backKit = new MeshKit()
    backKit.addDisc(vec3.zero(), vec3.forward(), R, new vec4(0.05, 0.13, 0.2, 1), 48, new vec4(0.1, 0.26, 0.36, 1))
    backKit.addRing(new vec3(0, 0, 0.05), vec3.forward(), R, 0.5, CYAN, 64)
    this.glow(face, "BubbleBack", backKit)
    const grooves: DynamicRibbon[] = []
    const grooveY = [3.6, 0, -3.6]
    for (let i = 0; i < 3; i++) grooves.push(new DynamicRibbon(face, "Groove" + i, ctx.glowMat, 40, 0.45, new vec4(1.0, 0.7, 0.3, 1)))
    const stylusKit = new MeshKit()
    stylusKit.addTube([new vec3(7, 8.5, 0.6), new vec3(0.25, 1.3, 0.6)], 0.35, WHITE, 6, 2)
    stylusKit.addSphere(new vec3(0, 0.65, 0.6), 0.55, WHITE, 6, 10)
    const stylus = this.model(face, "Stylus", stylusKit)
    const bubbleSpring = this.pop(bubble)
    let leader: GlowPath | null = null
    let groovePhase = 0

    this.cue(0.2, () => {
      ctx.log("bubble")
      bubble.enabled = true
      bubbleSpring.show(true)
      leader = this.path("BubbleLeader", [needle, bubbleTarget.sub(right.uniformScale(RS))], 0.25, CYAN, 0.8)
      // Below the bubble: above it would graze the question caption.
      this.label("needle", "The needle rides a wiggly groove", bubbleTarget.sub(up.uniformScale(RS + 5)))
    })
    this.tick((t, dt) => {
      if (!bubble.enabled) return
      const k = clamp01(bubble.getTransform().getLocalScale().x)
      bubble.getTransform().setLocalPosition(vec3.lerp(this.L(needle), this.L(bubbleTarget), k))
      face.getTransform().setWorldRotation(yawToward(cam.sub(bubble.getTransform().getWorldPosition())))
      groovePhase += dt * 5
      for (let i = 0; i < 3; i++) {
        const y0 = grooveY[i]
        const hc = Math.sqrt(Math.max(0, (R - 1) * (R - 1) - y0 * y0))
        grooves[i].update((j) => {
          const x = -hc + (2 * hc * j) / 39
          return new vec3(x, y0 + 0.8 * Math.sin(0.85 * x - groovePhase + i * 1.3), 0.3)
        })
      }
      stylus.so.getTransform().setLocalPosition(new vec3(0, 0.8 * Math.sin(-groovePhase + 1.3), 0))
      if (leader) leader.setRange(0, phase(t, 0.2, 0.6))
    })

    // ---- 2. Line of light travels along the shelf to the speaker ----
    const spToUser = flat(cam.sub(speaker))
    const spFront = speaker.add(spToUser.uniformScale(4))
    const linePts = [
      needle,
      new vec3(needle.x, shelfY, needle.z).add(toUser.uniformScale(4)),
      new vec3(spFront.x, shelfY, spFront.z),
      spFront
    ]
    const LINE_START = 5.2
    const LINE_END = 9.2
    let line: GlowPath | null = null
    const head = this.headSphere("LightHead", 2.0, new vec4(0.85, 0.97, 1, 1))
    this.cue(LINE_START, () => {
      ctx.log("line")
      this.unlabel("needle")
      line = this.path("LineOfLight", linePts, 0.9, CYAN, 2.6)
      head.enabled = true
      this.label("signal", "Groove wiggles become an electric signal", line.pointAt(0.5).add(this.origin).add(up.uniformScale(16)))
    })
    this.tick((t) => {
      if (!line) return
      const f = easeInOut(phase(t, LINE_START, LINE_END))
      line.setRange(0, f)
      head.getTransform().setLocalPosition(line.pointAt(f))
      if (t > LINE_END) {
        line.setOpacity(0.75 + 0.25 * Math.sin((t - LINE_END) * 6))
        head.enabled = false
      }
    })

    // ---- 3. Light reaches the speaker: chime + cone motion + pulse rings ----
    const axis = spToUser
    let coneNode: SceneObject
    let coneBase: vec3
    if (ctx.coneOverride) {
      coneNode = ctx.coneOverride
      coneBase = coneNode.getTransform().getLocalPosition()
    } else {
      coneNode = this.node("SpeakerCone", spFront)
      coneNode.enabled = false
      const coneKit = new MeshKit()
      coneKit.addLathe(
        vec3.zero(),
        axis,
        [
          [0, -1.2],
          [1.2, -1.5],
          [2.2, -2.6],
          [2.3, -2.6],
          [5.2, -1.4],
          [8.0, 0],
          [8.6, 0.5],
          [9.4, 0.4],
          [9.8, 0]
        ],
        [
          new vec4(0.86, 0.9, 0.97, 1),
          new vec4(0.86, 0.9, 0.97, 1),
          new vec4(0.86, 0.9, 0.97, 1),
          new vec4(0.62, 0.68, 0.8, 1),
          new vec4(0.66, 0.72, 0.84, 1),
          new vec4(0.7, 0.76, 0.88, 1),
          new vec4(0.92, 0.95, 1, 1),
          new vec4(0.92, 0.95, 1, 1),
          new vec4(0.92, 0.95, 1, 1)
        ],
        40
      )
      this.model(coneNode, "ConeModel", coneKit)
      const rimKit = new MeshKit()
      rimKit.addRing(axis.uniformScale(0.3), axis, 9.9, 0.35, CYAN, 64)
      this.glow(coneNode, "ConeRim", rimKit)
      coneBase = this.L(spFront)
    }
    const conePop = ctx.coneOverride ? null : this.pop(coneNode)
    const rings: Spawned[] = []
    for (let i = 0; i < 4; i++) {
      const kit = new MeshKit()
      kit.addRing(vec3.zero(), axis, 1, 0.05, CYAN, 64)
      const r = this.glow(ctx.root, "SoundRing" + i, kit)
      r.so.enabled = false
      rings.push(r)
    }
    const ARRIVE = LINE_END
    const CONE_END = 15.2
    let coneOn = false
    this.cue(ARRIVE, () => {
      ctx.log("lineArrived")
      ctx.playChime()
      ctx.log("cone")
      coneOn = true
      if (conePop) conePop.show(true)
      this.unlabel("signal")
      // Below the speaker, so it never collides with the question caption above the record player.
      this.label("cone", "The cone pushes air: that's the sound", spFront.add(up.uniformScale(-24)).add(right.uniformScale(-14)))
    })
    this.tick((t) => {
      if (!coneOn) return
      const tt = t - ARRIVE
      const env = clamp01(tt / 0.25) * (t < CONE_END ? 1 : clamp01(1 - (t - CONE_END) / 0.4))
      coneNode.getTransform().setLocalPosition(coneBase.add(axis.uniformScale(1.4 * env * Math.sin(2 * Math.PI * 3.4 * tt))))
      for (let i = 0; i < rings.length; i++) {
        const spawnAt = i * 0.45
        if (tt < spawnAt) continue
        const life = 1.8
        const age = (tt - spawnAt) % life
        const born = t - age
        const ring = rings[i]
        if (born > CONE_END - 0.2) {
          ring.so.enabled = false
          continue
        }
        ring.so.enabled = true
        const radius = 10 + age * 22
        ring.so.getTransform().setLocalScale(vec3.one().uniformScale(radius))
        ring.so.getTransform().setLocalPosition(this.L(spFront.add(axis.uniformScale(age * 14))))
        setFade(ring.mat, 1 - age / life)
      }
    })
    this.cue(CONE_END + 0.4, () => {
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

  constructor(ctx: ExplainContext, camMarker: vec3, facing: vec3) {
    super(ctx)
    const K = 1.5 // schematic is drawn 1.5x bigger than a typical wall camera
    const f = flat(facing)
    const up = vec3.up()
    const s = up.cross(f).normalize()
    const cam = ctx.camPos()
    const m = camMarker.add(f.uniformScale(16))
    const sideSign = s.dot(cam.sub(m)) >= 0 ? 1 : -1
    const hx = 11 * K
    const hy = 8 * K
    const hz = 14 * K
    const sensorLabelW = m.sub(f.uniformScale(hz + 36))

    const shell = this.node("CutawayShell", m)
    shell.enabled = false
    const edges = new MeshKit()
    edges.addBoxEdges(vec3.zero(), s.uniformScale(hx), up.uniformScale(hy), f.uniformScale(hz), 0.35, CYAN)
    this.glow(shell, "ShellEdges", edges)
    const panels = new MeshKit()
    const pc = new vec4(0.6, 0.8, 1.0, 1)
    panels.addQuad(up.uniformScale(hy), s.uniformScale(hx), f.uniformScale(hz), pc)
    panels.addQuad(up.uniformScale(-hy), s.uniformScale(hx), f.uniformScale(hz), pc)
    panels.addQuad(s.uniformScale(-hx * sideSign), f.uniformScale(hz), up.uniformScale(hy), pc)
    panels.addQuad(f.uniformScale(-hz), s.uniformScale(hx), up.uniformScale(hy), pc)
    this.model(shell, "ShellPanels", panels, 0.16)
    const coverKit = new MeshKit()
    coverKit.addQuad(vec3.zero(), f.uniformScale(hz), up.uniformScale(hy), new vec4(0.7, 0.88, 1.0, 1))
    const cover = this.model(shell, "ShellCover", coverKit, 0.55, s.uniformScale(hx * sideSign))

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
    lensRim.addRing(lensC, f, 5.3 * K, 0.3, CYAN, 64)
    this.glow(shell, "LensRim", lensRim)

    const sensorC = f.uniformScale(-hz + 3 * K)
    const sensorKit = new MeshKit()
    sensorKit.addQuad(sensorC, s.uniformScale(4 * K), up.uniformScale(3 * K), new vec4(0.45, 1.0, 0.6, 1))
    const sensor = this.glow(shell, "Sensor", sensorKit)
    setFade(sensor.mat, 0.35)

    const shellPop = this.pop(shell)
    const lensW = m.add(lensC)
    const sensorW = m.add(sensorC)

    this.cue(0.2, () => {
      ctx.log("shell")
      shellPop.show(true)
    })
    this.cue(1.2, () => {
      ctx.log("cutaway")
      // Labels sit below / behind the shell so they never stack under the question caption above it.
      this.label("lens", "Lens", lensW.sub(up.uniformScale(hy + 6)))
      this.label("sensor", "Sensor", sensorLabelW)
    })
    this.tick((t) => {
      const c = easeInOut(phase(t, 1.2, 1.8))
      cover.so.getTransform().setLocalPosition(s.uniformScale(hx * sideSign + 30 * c * sideSign))
      setFade(cover.mat, 0.55 * (1 - c), true)
      if (c >= 1) cover.so.enabled = false
    })

    // ---- rays from the room, through the lens, onto the sensor (inverted) ----
    const srcTop = m.add(f.uniformScale(75)).add(up.uniformScale(14))
    const srcBot = m.add(f.uniformScale(75)).add(up.uniformScale(-14))
    const imgTop = sensorW.add(up.uniformScale(-2.4 * K))
    const imgBot = sensorW.add(up.uniformScale(2.4 * K))
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
    srcKit.addSphere(this.L(srcTop), 1.4, WARM, 6, 10)
    srcKit.addSphere(this.L(srcBot), 1.4, CYAN, 6, 10)
    const srcs = this.glow(ctx.root, "RaySources", srcKit)
    srcs.so.enabled = false
    this.cue(RAYS - 0.2, () => {
      srcs.so.enabled = true
      this.label("light", "Light from the room", m.add(f.uniformScale(75)).add(up.uniformScale(26)))
    })
    this.cue(RAYS, () => {
      ctx.log("rays")
      rayDefs.forEach((d, i) => {
        const hitW = lensW.add(up.uniformScale(d.hit * K))
        const p = this.path("Ray" + i, [d.src, hitW, d.img], 0.35, d.col, 1.1)
        rays.push({p, h: this.headSphere("RayHead" + i, 1.0, d.col), start: RAYS + i * 0.35})
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
    arrowKit.addTube([ac.add(up.uniformScale(2.2 * K)), ac.add(up.uniformScale(-2.2 * K))], 0.25, WARM, 5, 1)
    arrowKit.addTube([ac.add(up.uniformScale(-2.2 * K)), ac.add(up.uniformScale(-1.2 * K)).add(s.uniformScale(1.0 * K))], 0.25, WARM, 5, 1)
    arrowKit.addTube([ac.add(up.uniformScale(-2.2 * K)), ac.add(up.uniformScale(-1.2 * K)).add(s.uniformScale(-1.0 * K))], 0.25, WARM, 5, 1)
    const arrow = this.glow(shell, "SensorImage", arrowKit)
    arrow.so.enabled = false
    this.cue(SENSOR, () => {
      ctx.log("sensor")
      arrow.so.enabled = true
      this.unlabel("light")
      this.label("sensor", "Light lands upside-down\non the sensor: a photo", sensorLabelW)
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
