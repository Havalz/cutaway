/**
 * Small animation helpers shared by Cutaway scripts.
 * - Spring: a damped spring (settles in ~250 ms with the defaults) for snappy, physical motion.
 * - Pop: shows / hides a SceneObject by springing its scale, with 0.97 press feedback.
 * Only transforms are animated (no width/height/layout changes).
 */

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

/** Springs a SceneObject's local scale between 0 (hidden, then disabled) and its base scale. */
export class Pop {
  private spring: Spring
  private press: Spring
  private shown: boolean
  private delay: number = 0

  constructor(
    public readonly so: SceneObject,
    private baseScale: vec3 = vec3.one(),
    startShown: boolean = false
  ) {
    this.shown = startShown
    this.spring = new Spring(420, 0.7, startShown ? 1 : 0)
    this.press = new Spring(900, 1.0, 1)
    this.apply()
  }

  get isShown(): boolean {
    return this.shown
  }

  /** Show or hide. `delay` (seconds) staggers the start; `instant` skips the animation. */
  show(v: boolean, instant: boolean = false, delay: number = 0): void {
    this.shown = v
    this.delay = v ? delay : 0
    this.press.snap(1)
    if (v) this.so.enabled = true
    if (instant) {
      this.spring.snap(v ? 1 : 0)
      this.apply()
      if (!v) this.so.enabled = false
      return
    }
    if (this.delay <= 0) this.spring.target = v ? 1 : 0
  }

  setPressed(p: boolean): void {
    this.press.target = p ? 0.97 : 1
  }

  setBaseScale(s: vec3): void {
    this.baseScale = s
    this.apply()
  }

  update(dt: number): void {
    if (!this.so.enabled) return
    if (this.delay > 0) {
      this.delay -= dt
      if (this.delay <= 0) this.spring.target = this.shown ? 1 : 0
    }
    this.spring.update(dt)
    this.press.update(dt)
    this.apply()
    if (!this.shown && this.spring.value < 0.02 && this.spring.velocity <= 0.05) {
      this.spring.snap(0)
      this.apply()
      this.so.enabled = false
    }
  }

  private apply(): void {
    const s = Math.max(0.0001, Math.max(0, this.spring.value) * this.press.value)
    this.so.getTransform().setLocalScale(this.baseScale.uniformScale(s))
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
