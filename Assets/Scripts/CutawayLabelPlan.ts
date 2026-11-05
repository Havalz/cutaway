/**
 * Where a stage's part labels go (performance pass): no label overlaps another label, a part, the
 * caption or the rail, as the user sees them.
 *
 * Working that out is the costly part, so it does not run every frame. The plan stands until something
 * it was made from has moved: a label coming or going at once, otherwise checked a few times a second
 * (the eye, the slider, the copy, the rail, the caption), by less than the plan's margin can matter.
 * A search that finds nothing is not repeated until one of those moves. Every frame the labels only
 * follow their parts.
 */
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {FastPoly, toView, viewFrame, ViewFrame, worldHull} from "./CutawayLayout"

/** The gap kept round a label, and round its leader (view units). */
const MARGIN = 0.8
const LEADER_MARGIN = 0.3
/** Inputs are looked at this often; the plan is re-checked regardless this often. */
const CHECK_S = 0.125
const FORCE_S = 1
/** How far things may move before the plan is looked at again: a good deal less than MARGIN. */
const EYE_EPS = 0.5
const MOVE_EPS = 0.3
const SLIDER_EPS = 0.002
/** How far the eye moves before the view the labels are offset in is refreshed (between plans). */
const FRAME_EPS = 0.05
const LAT = [0, 2.5, 5, 8, 11, 14]
/** Tried only after everything nearer has failed, so no label ever has to sit on another. */
const FAR_RISE = [26, 30, 35, 40, 46, 52, 60]
const FAR_LAT = [18, 22, 26, 30, 36, 42, 50]

export interface LabelItem {
  key: string
  /** Its id in CutawayLabelsUI. */
  id: string
  text: string
  /** Where it points (world), set each frame by the stage. */
  anchor: vec3
  /** The side (+1 the user's right) and the direction (+1 up) it prefers, set when it is planned. */
  sh: number
  sv: number
}

export interface LabelPlanHost {
  labels: CutawayLabelsUI
  camPos: () => vec3
  stageCenter: () => vec3
  /** Where the copy is (world). */
  pivot: () => vec3
  /** The copy's parts as they stand, solid ones in `hard` and outlines in `soft`. */
  addObstacles: (F: ViewFrame, hard: FastPoly[], soft: FastPoly[]) => void
  railBoxes: () => vec3[][]
  /** Set the item's sh and sv, from its anchor in view units. */
  prefer: (item: LabelItem, F: ViewFrame, ax: number) => void
}

interface LabelState {
  ox: number
  oy: number
  side: number
  soft: boolean
  planned: boolean
  /** The offset showing now (it glides to the plan), and where it last was. */
  sx: number
  sy: number
  shown: boolean
  ax: number
  ay: number
  az: number
}

export class LabelPlanner {
  /** Plans made (tests: none while nothing moves). */
  plans = 0
  private states = new Map<string, LabelState>()
  private F: ViewFrame | null = null
  private items: LabelItem[] = []
  private itemCount = 0
  private hard: FastPoly[] = []
  private soft: FastPoly[] = []
  private placed: FastPoly[] = []
  private nextCheck = 0
  private nextForce = 0
  private planS = 0
  private planEye = vec3.zero()
  private planPivot = vec3.zero()
  private planText: string | null = null
  private planRail: FastPoly | null = null
  private frameEye = vec3.zero()
  private scratch = vec3.zero()
  // The label being placed.
  private ax = 0
  private ay = 0
  private g = 0
  private w = 0
  private h = 0

  constructor(
    private host: LabelPlanHost,
    private rises: number[]
  ) {}

  get size(): number {
    return this.states.size
  }

  /** A label is no longer wanted. */
  drop(key: string): void {
    this.states.delete(key)
  }

  clear(): void {
    this.states.clear()
    this.itemCount = 0
    this.F = null
  }

  /** Per frame: the labels wanted now (the first n of items), with their anchors set; s = the slider. */
  update(items: LabelItem[], n: number, s: number): void {
    const now = getTime()
    const eye = this.host.camPos()
    let need = !this.F || n !== this.itemCount
    for (let i = 0; !need && i < n; i++) if (items[i] !== this.items[i]) need = true
    if (!need && now >= this.nextCheck) {
      this.nextCheck = now + CHECK_S
      need = now >= this.nextForce || this.moved(eye, s)
    }
    if (need) this.plan(items, n, s, eye, now)
    else if (eye.distance(this.frameEye) > FRAME_EPS) this.setFrame(eye)
    this.follow(items, n, eye)
  }

  private setFrame(eye: vec3): void {
    this.F = viewFrame(eye, this.host.stageCenter())
    this.frameEye = eye
  }

  /** Has anything the plan was made from moved enough to matter? */
  private moved(eye: vec3, s: number): boolean {
    if (Math.abs(s - this.planS) > SLIDER_EPS) return true
    if (eye.distance(this.planEye) > EYE_EPS) return true
    if (this.host.pivot().distance(this.planPivot) > MOVE_EPS) return true
    if (this.host.labels.captionText() !== this.planText) return true
    const rail = this.railPoly()
    const was = this.planRail
    if (!rail !== !was) return true
    if (rail && was && (Math.abs(rail.x0 - was.x0) > MOVE_EPS || Math.abs(rail.x1 - was.x1) > MOVE_EPS || Math.abs(rail.y0 - was.y0) > MOVE_EPS || Math.abs(rail.y1 - was.y1) > MOVE_EPS)) return true
    return false
  }

  private railPoly(): FastPoly | null {
    const boxes = this.host.railBoxes()
    return boxes.length ? worldHull(this.F, boxes[0]) : null
  }

  private plan(items: LabelItem[], n: number, s: number, eye: vec3, now: number): void {
    this.plans++
    this.setFrame(eye)
    const F = this.F
    const hard = this.hard
    hard.length = 0
    this.soft.length = 0
    this.placed.length = 0
    this.host.addObstacles(F, hard, this.soft)
    const labels = this.host.labels
    const cap = labels.getCaptionQuad()
    if (cap) hard.push(worldHull(F, cap))
    const boxes = this.host.railBoxes()
    this.planRail = null
    for (let i = 0; i < boxes.length; i++) {
      const h = worldHull(F, boxes[i])
      hard.push(h)
      if (i === 0) this.planRail = h
    }
    this.planText = labels.captionText()
    this.planS = s
    this.planEye = eye
    this.planPivot = this.host.pivot()
    this.nextCheck = now + CHECK_S
    this.nextForce = now + FORCE_S
    const dd = labels.getDesignDistance()
    this.g = (0.6 * F.D) / dd
    for (let i = 0; i < n; i++) {
      const it = items[i]
      this.items[i] = it
      const A = toView(F, it.anchor)
      this.ax = A.x
      this.ay = A.y
      const size = labels.measure(it.text)
      this.w = (size.x * F.D) / dd
      this.h = (size.y * F.D) / dd
      this.host.prefer(it, F, A.x)
      let st = this.states.get(it.key)
      if (!st) {
        st = {ox: 0, oy: 0, side: 1, soft: false, planned: false, sx: 0, sy: 0, shown: false, ax: 0, ay: 0, az: 0}
        this.states.set(it.key, st)
      }
      if (!st.planned || !this.isClear(st.ox, st.oy, st.side, st.soft)) {
        if (!this.search(st, it.sh, it.sv)) {
          st.ox = it.sh * 3
          st.oy = it.sv * 6
          st.side = it.sh
          st.soft = false
        }
        st.planned = true
      }
      const ex = A.x + st.ox
      const ey = A.y + st.oy
      const x0 = st.side > 0 ? ex + this.g : ex - this.g - this.w
      const x1 = st.side > 0 ? ex + this.g + this.w : ex - this.g
      this.placed.push(new FastPoly([x0, x1, x1, x0], [ey - this.h / 2, ey - this.h / 2, ey + this.h / 2, ey + this.h / 2]))
      this.placed.push(new FastPoly([A.x, ex], [A.y, ey]))
    }
    this.items.length = n
    this.itemCount = n
  }

  /** The label at offset (ox, oy) on `side`: clear of everything so far? */
  private isClear(ox: number, oy: number, side: number, useSoft: boolean): boolean {
    const ex = this.ax + ox
    const ey = this.ay + oy
    const x0 = side > 0 ? ex + this.g : ex - this.g - this.w
    const x1 = side > 0 ? ex + this.g + this.w : ex - this.g
    const y0 = ey - this.h / 2
    const y1 = ey + this.h / 2
    const hard = this.hard
    for (let i = 0; i < hard.length; i++) if (!hard[i].rectClear(x0, x1, y0, y1, MARGIN)) return false
    const placed = this.placed
    for (let i = 0; i < placed.length; i++) if (!placed[i].rectClear(x0, x1, y0, y1, MARGIN)) return false
    for (let i = 0; i < placed.length; i++) if (!placed[i].segClear(this.ax, this.ay, ex, ey, LEADER_MARGIN)) return false
    if (useSoft) {
      const soft = this.soft
      for (let i = 0; i < soft.length; i++) if (!soft[i].rectClear(x0, x1, y0, y1, MARGIN)) return false
    }
    return true
  }

  private search(st: LabelState, sh: number, sv: number): boolean {
    if (this.searchIn(st, this.rises, LAT, sh, sv)) return true
    return this.searchIn(st, this.rises.concat(FAR_RISE), LAT.concat(FAR_LAT), sh, sv)
  }

  private searchIn(st: LabelState, rises: number[], lats: number[], sh: number, sv: number): boolean {
    for (let pass = 0; pass < 2; pass++) {
      const useSoft = pass === 0
      for (let vi = 0; vi < 2; vi++) {
        const v = vi === 0 ? sv : -sv
        for (let r = 0; r < rises.length; r++) {
          for (let l = 0; l < lats.length; l++) {
            for (let si = 0; si < 2; si++) {
              const side = si === 0 ? sh : -sh
              const ox = side * lats[l]
              const oy = v * rises[r]
              if (this.isClear(ox, oy, side, useSoft)) {
                st.ox = ox
                st.oy = oy
                st.side = side
                st.soft = useSoft
                return true
              }
            }
          }
        }
      }
    }
    return false
  }

  /** Per frame: each label follows its part and glides to its plan. */
  private follow(items: LabelItem[], n: number, eye: vec3): void {
    const labels = this.host.labels
    const F = this.F
    const dt = getDeltaTime()
    const glide = 1 - Math.exp(-dt / 0.07)
    const p = this.scratch
    for (let i = 0; i < n; i++) {
      const it = items[i]
      const st = this.states.get(it.key)
      const a = it.anchor
      const fresh = !labels.isShown(it.id) || !st.shown
      if (fresh) {
        st.sx = st.ox
        st.sy = st.oy
      } else {
        st.sx += (st.ox - st.sx) * glide
        st.sy += (st.oy - st.sy) * glide
      }
      st.shown = true
      const k = Math.max(1, (a.x - eye.x) * F.f.x + (a.y - eye.y) * F.f.y + (a.z - eye.z) * F.f.z) / F.D
      const tx = st.sx * k
      const ty = st.sy * k
      p.x = a.x + F.r.x * tx + F.u.x * ty
      p.y = a.y + F.r.y * tx + F.u.y * ty
      p.z = a.z + F.r.z * tx + F.u.z * ty
      if (fresh) labels.show(it.id, it.text, p, a, st.side)
      else labels.move(it.id, p, a, st.side)
    }
  }
}
