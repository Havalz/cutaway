/**
 * Small animation helpers shared by Cutaway scripts.
 * - Spring: a damped spring for press feedback and the dot-to-chip stretch (the one overshoot).
 * - Fader / Pop: enter 300 ms ease-out cubic, exit 220 ms ease-in, no bounce (visual direction).
 * Only transforms and opacity are animated (no width/height/layout changes).
 */
import {ENTER_S, EXIT_S, HOVER, PRESS} from "./CutawayStyle"

export class Spring {
  value: number
  target: number
  velocity: number = 0

  constructor(
    public stiffness: number = 420,
    public dampingRatio: number = 0.78,
    initial: number = 0
  ) {
    this.value = initial
    this.target = initial
  }

  update(dt: number): number {
    const k = this.stiffness
    const c = 2 * this.dampingRatio * Math.sqrt(k)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      const a = -k * (this.value - this.target) - c * this.velocity
      this.velocity += a * h
      this.value += this.velocity * h
    }
    return this.value
  }

  snap(v: number): void {
    this.value = v
    this.target = v
    this.velocity = 0
  }

  isSettled(eps: number = 0.002): boolean {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps * 10
  }
}

/**
 * A 0..1 visibility value driven by the Cutaway motion rules: enter 300 ms ease-out cubic,
 * exit 220 ms ease-in. `delay` (seconds) staggers an enter.
 */
export class Fader {
  value: number
  private shown: boolean
  private from = 0
  private to = 0
  private t = 0
  private dur = 0
  private delay = 0
  private running = false

  constructor(
    startShown: boolean = false,
    public enterS: number = ENTER_S,
    public exitS: number = EXIT_S
  ) {
    this.shown = startShown
    this.value = startShown ? 1 : 0
  }

  get isShown(): boolean {
    return this.shown
  }

  get isAnimating(): boolean {
    return this.running
  }

  show(v: boolean, instant: boolean = false, delay: number = 0): void {
    this.shown = v
    if (instant) {
      this.value = v ? 1 : 0
      this.running = false
      return
    }
    this.from = this.value
    this.to = v ? 1 : 0
    this.t = 0
    this.dur = v ? this.enterS : this.exitS
    this.delay = v ? delay : 0
    this.running = true
  }

  update(dt: number): number {
    if (!this.running) return this.value
    if (this.delay > 0) {
      this.delay -= dt
      return this.value
    }
    this.t += dt
    const k = clamp01(this.t / Math.max(1e-4, this.dur))
    const e = this.to >= this.from ? easeOutCubic(k) : easeIn(k)
    this.value = this.from + (this.to - this.from) * e
    if (k >= 1) {
      this.value = this.to
      this.running = false
    }
    return this.value
  }
}

export interface PopOptions {
  /** Scale at 0 visibility (0 = grows from a point). */
  minScale?: number
  /** Called every frame with the 0..1 visibility (for opacity). */
  onAmount?: (a: number) => void
}

/**
 * Shows / hides a SceneObject: scale (and optional opacity via onAmount) follow a Fader, with a
 * critically damped spring for the 0.97 press feedback and another for the 1.04 hover. Disabled
 * once fully hidden.
 */
export class Pop {
  private fader: Fader
  private press: Spring
  private hover: Spring
  private minScale: number
  private onAmount: ((a: number) => void) | null

  constructor(
    public readonly so: SceneObject,
    private baseScale: vec3 = vec3.one(),
    startShown: boolean = false,
    opts: PopOptions = {}
  ) {
    this.fader = new Fader(startShown)
    this.press = new Spring(900, 1.0, 1)
    this.hover = new Spring(HOVER.stiffness, 1.0, 1)
    this.minScale = opts.minScale ?? 0
    this.onAmount = opts.onAmount ?? null
    this.apply()
  }

  get isShown(): boolean {
    return this.fader.isShown
  }

  /** 0..1 visibility after easing. */
  get amount(): number {
    return this.fader.value
  }

  /** Show or hide. `delay` (seconds) staggers the start; `instant` skips the animation. */
  show(v: boolean, instant: boolean = false, delay: number = 0): void {
    if (v === this.fader.isShown && !instant && (this.fader.isAnimating || this.fader.value === (v ? 1 : 0))) return
    this.press.snap(1)
    this.hover.snap(1)
    if (v) this.so.enabled = true
    this.fader.show(v, instant, delay)
    this.apply()
    if (instant && !v) this.so.enabled = false
  }

  setPressed(p: boolean): void {
    this.press.target = p ? PRESS.scale : 1
  }

  /** Aimed at: 1.04 over 120 ms. */
  setHovered(h: boolean): void {
    this.hover.target = h ? HOVER.scale : 1
  }

  setBaseScale(s: vec3): void {
    this.baseScale = s
    this.apply()
  }

  update(dt: number): void {
    if (!this.so.enabled) return
    this.fader.update(dt)
    this.press.update(dt)
    this.hover.update(dt)
    this.apply()
    if (!this.fader.isShown && !this.fader.isAnimating) this.so.enabled = false
  }

  private apply(): void {
    const a = this.fader.value
    const s = Math.max(0.0001, (this.minScale + (1 - this.minScale) * a) * this.press.value * this.hover.value)
    this.so.getTransform().setLocalScale(this.baseScale.uniformScale(s))
    if (this.onAmount) this.onAmount(a)
  }
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

export function easeInOut(x: number): number {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}

export function easeIn(x: number): number {
  const t = clamp01(x)
  return t * t * t
}

export function easeOutCubic(x: number): number {
  const t = 1 - clamp01(x)
  return 1 - t * t * t
}

export function easeInOutCubic(x: number): number {
  const t = clamp01(x)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Rotation that turns +Z straight at `dir` (pitches to face a viewer above or below) while
 * keeping the panel's x axis level. Falls back to `fallbackUp` when `dir` is nearly vertical.
 */
export function faceToward(dir: vec3, fallbackUp: vec3 = vec3.up()): quat {
  if (dir.length < 1e-4) return quat.quatIdentity()
  const n = dir.normalize()
  // Level panels for normal viewing; on steep looks (down at a shelf) blend toward the head's
  // up so text near the edge of view does not appear rolled.
  const k = clamp01((Math.abs(n.y) - 0.35) / 0.4)
  const t = k * k * (3 - 2 * k)
  let up = vec3.up().uniformScale(1 - t).add(fallbackUp.uniformScale(t))
  if (up.length < 1e-3 || Math.abs(up.normalize().dot(n)) > 0.98) up = fallbackUp
  return quat.lookAt(n, up.normalize())
}

/** Rotation that turns +Z toward `dir`, yaw only (keeps panels upright). */
export function yawToward(dir: vec3): quat {
  const flat = new vec3(dir.x, 0, dir.z)
  if (flat.length < 1e-4) return quat.quatIdentity()
  return quat.lookAt(flat.normalize(), vec3.up())
}
