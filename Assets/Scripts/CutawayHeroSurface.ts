/**
 * Camera hero, pass 2: finds the real coffee-table top (devpost/camera-hero-pass2.md §1).
 *
 * World Query hit testing (WorldQueryModule / HitTestSession, built in): rays straight down over a
 * 9 x 9 grid covering 1.2 m x 1.2 m centred on the table marker. Hits whose normal is within 10° of
 * up and whose height is within 3 cm of the median are the table top (the median is its height).
 * A circle fitted to the outermost kept hits gives the centre and radius; the grid is 15 cm coarse,
 * so the edge is then refined along 32 directions by bisection (to ~2.5 mm) and the circle refitted.
 * A ray with no answer (out of view) is unknown, never "off the table". The fit must pass quality
 * gates (10+ directions, no gap over 120°, rms under 2.5 cm), or the fallback is used.
 *
 * If hit testing returns nothing (or too little), the fallback is a table top defined by inspector
 * inputs (height and radius) at the marker. Which method is in use is always reported.
 */

export type SurfaceMethod = "hitTest" | "fallback"

export interface TableSurface {
  method: SurfaceMethod
  /** World Y of the table top (cm). */
  height: number
  /** Centre of the top surface (world, at `height`). */
  center: vec3
  /** Radius of the round top (cm): the fitted circle. */
  radius: number
  /** Radius the replica may use (cm): the nearest measured edge, for a top that is not quite round. */
  safeRadius: number
  /** Grid hits kept as table top (hit test), 0 for the fallback. */
  kept: number
  /** Horizontal distance from the table marker to the found centre (cm). */
  offCenter: number
  /** Found height minus the marker's height (cm). */
  offHeight: number
  /** Why the fallback is in use (empty for the hit test). */
  note: string
}

const GRID = 9
const SPAN = 120
/** Rays start this far above the marker and end this far below it (far enough to reach the floor:
 *  a hit on the floor is what marks the table's edge). */
const RAY_UP = 40
const RAY_DOWN = 100
/** Only hits this close to the marker's height (cm) vote for the table top's height. */
const NEAR_MARKER = 20
const NORMAL_COS = Math.cos((10 * Math.PI) / 180)
const BAND = 3
const DIRS = 32
/** Edge bisection stops at this width (cm), or after MAX_ROUNDS batches. */
const EDGE_TOL = 0.25
const MAX_ROUNDS = 14
/** Give up on a batch of rays after this long (s): the preview may never answer. */
const BATCH_TIMEOUT = 1.2
/** Quality gates for the edge fit (else the fallback is used). */
const MIN_DIRS = 10
const MAX_GAP_DEG = 120
const MAX_RMS = 2.5

interface Ray {
  x: number
  z: number
  hit: {p: vec3; n: vec3} | null
  done: boolean
}

export class TableSurveyor {
  private session: HitTestSession | null = null
  private sessionError = ""
  private pending: {rays: Ray[]; started: number; onDone: () => void} | null = null
  private busy = false

  constructor(private log: (s: string) => void) {
    try {
      const wq = require("LensStudio:WorldQueryModule") as WorldQueryModule
      const opts = HitTestSessionOptions.create()
      opts.filter = false
      this.session = wq.createHitTestSessionWithOptions(opts)
      this.session.start()
    } catch (e) {
      this.session = null
      this.sessionError = "" + e
    }
  }

  get isBusy(): boolean {
    return this.busy
  }

  /**
   * Survey the table around `marker`. `done` is called once (possibly a few frames later) with the
   * hit-test surface, or with `fallback` (and the reason) if hit testing found no table top.
   */
  survey(marker: vec3, fallback: TableSurface, done: (s: TableSurface) => void): void {
    const fail = (why: string) => {
      this.busy = false
      const s = {...fallback, note: why}
      this.report(s, marker)
      done(s)
    }
    if (!this.session) {
      fail("no hit test session (" + this.sessionError + ")")
      return
    }
    this.busy = true
    const rays: Ray[] = []
    const step = SPAN / (GRID - 1)
    for (let i = 0; i < GRID; i++)
      for (let j = 0; j < GRID; j++) rays.push({x: marker.x - SPAN / 2 + i * step, z: marker.z - SPAN / 2 + j * step, hit: null, done: false})
    this.cast(rays, marker, () => {
      const any = rays.filter((r) => r.hit)
      if (any.length > 0) {
        const bins: {[k: string]: number} = {}
        for (const r of any) {
          const k = (Math.round(r.hit.p.y / 2) * 2).toFixed(0) + (r.hit.n.y >= NORMAL_COS ? "" : "~")
          bins[k] = (bins[k] ?? 0) + 1
        }
        this.log(`surface: ${any.length}/${rays.length} grid hits; heights ${JSON.stringify(bins)}`)
      }
      const hits = rays.filter((r) => r.hit && r.hit.n.y >= NORMAL_COS)
      if (hits.length < 4) {
        fail(`hit test returned ${rays.filter((r) => r.hit).length}/${rays.length} hits, ${hits.length} facing up`)
        return
      }
      // The median is taken near the marker's height (the hand-placed marker is on the top, give
      // or take), so a floor that fills most of the grid around a small table never wins it.
      const near = hits.filter((r) => Math.abs(r.hit.p.y - marker.y) <= NEAR_MARKER)
      const ys = (near.length >= 4 ? near : hits).map((r) => r.hit.p.y).sort((a, b) => a - b)
      const median = ys[Math.floor(ys.length / 2)]
      const kept = rays.filter((r) => !!r.hit && r.hit.n.y >= NORMAL_COS && Math.abs(r.hit.p.y - median) <= BAND)
      const keptYs = kept.map((r) => r.hit.p.y).sort((a, b) => a - b)
      const height = keptYs.length % 2 ? keptYs[(keptYs.length - 1) / 2] : (keptYs[keptYs.length / 2 - 1] + keptYs[keptYs.length / 2]) / 2
      // A ray with no answer is out of view: unknown, never "off the table". Only a real hit
      // somewhere else (the floor, a rug) marks the table's edge.
      const isOn = (r: Ray) => !!r.hit && r.hit.n.y >= NORMAL_COS && Math.abs(r.hit.p.y - height) <= BAND
      const isOff = (r: Ray) => !!r.hit && !isOn(r)
      // Outermost kept hits: kept cells next to a cell that is definitely not table top.
      const at = (i: number, j: number) => (i < 0 || j < 0 || i >= GRID || j >= GRID ? null : rays[i * GRID + j])
      const edge: vec2[] = []
      for (let i = 0; i < GRID; i++)
        for (let j = 0; j < GRID; j++) {
          const r = at(i, j)
          if (!isOn(r)) continue
          const nb = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)]
          if (nb.some((n) => !!n && isOff(n))) edge.push(new vec2(r.x, r.z))
        }
      const cx = kept.reduce((a, r) => a + r.x, 0) / kept.length
      const cz = kept.reduce((a, r) => a + r.z, 0) / kept.length
      let coarse = edge.length >= 5 ? fitCircle(edge) : null
      if (!coarse || coarse.r > SPAN) {
        const far = kept.reduce((a, r) => Math.max(a, new vec2(r.x - cx, r.z - cz).length), 0)
        coarse = {c: new vec2(cx, cz), r: far + step / 2}
      }
      const c0 = coarse.c
      const r0 = coarse.r
      // The outermost kept hits sit up to a grid step inside the real edge: along each of the
      // directions, check a point inside (on the top) and one outside (off it), then bisect.
      interface Dir {
        lo: number
        hi: number
        ok: boolean
        loOk: boolean
        hiOk: boolean
        ext: number
      }
      const dirs: Dir[] = []
      for (let k = 0; k < DIRS; k++) dirs.push({lo: r0 * 0.5, hi: r0 + step * 1.5, ok: true, loOk: false, hiOk: false, ext: 0})
      const dir = (k: number) => new vec2(Math.cos((k / DIRS) * Math.PI * 2), Math.sin((k / DIRS) * Math.PI * 2))
      let round = 0
      const finish = () => {
        const pts: vec2[] = []
        dirs.forEach((d, k) => {
          if (d.ok && d.loOk && d.hiOk) pts.push(c0.add(dir(k).uniformScale((d.lo + d.hi) / 2)))
        })
        let fit = pts.length >= 6 ? fitCircle(pts) : null
        let used = pts
        if (fit) {
          // Drop directions that ran into something (a cup, a book) and refit.
          const good = pts.filter((p) => Math.abs(p.distance(fit.c) - fit.r) < 2)
          if (good.length >= 6) {
            fit = fitCircle(good) ?? fit
            used = good
          }
        }
        if (!fit) {
          fail(`table edge not in view (${pts.length}/${DIRS} edge directions measured)`)
          return
        }
        // Quality gates: enough directions, all the way round, and a round enough edge.
        const rms = Math.sqrt(used.reduce((a, p) => a + Math.pow(p.distance(fit.c) - fit.r, 2), 0) / used.length)
        const angs = used.map((p) => Math.atan2(p.y - fit.c.y, p.x - fit.c.x)).sort((a, b) => a - b)
        let gap = angs.length ? angs[0] + Math.PI * 2 - angs[angs.length - 1] : Math.PI * 2
        for (let i = 1; i < angs.length; i++) gap = Math.max(gap, angs[i] - angs[i - 1])
        const gapDeg = (gap * 180) / Math.PI
        const quality = `${used.length}/${DIRS} edge directions, widest gap ${gapDeg.toFixed(0)}°, rms ${rms.toFixed(2)} cm`
        if (used.length < MIN_DIRS || gapDeg > MAX_GAP_DEG || rms > MAX_RMS) {
          fail(`edge fit too weak: ${quality}`)
          return
        }
        // The nearest measured edge (not the circle) bounds where the replica may go.
        const nearest = used.reduce((a, p) => Math.min(a, p.distance(fit.c)), 1e9)
        this.busy = false
        const s: TableSurface = {
          method: "hitTest",
          height,
          center: new vec3(fit.c.x, height, fit.c.y),
          radius: fit.r,
          safeRadius: Math.min(fit.r, nearest) - 0.5,
          kept: kept.length,
          offCenter: 0,
          offHeight: 0,
          note: quality
        }
        this.report(s, marker)
        done(s)
      }
      const next = () => {
        const active = dirs.filter((d) => d.ok && !(d.loOk && d.hiOk && d.hi - d.lo <= EDGE_TOL))
        if (active.length === 0 || round >= MAX_ROUNDS) {
          finish()
          return
        }
        round++
        const probes: {d: Dir; kind: "lo" | "hi" | "mid"; ray: Ray}[] = []
        dirs.forEach((d, k) => {
          if (active.indexOf(d) < 0) return
          const add = (kind: "lo" | "hi" | "mid", r: number) => {
            const p = c0.add(dir(k).uniformScale(r))
            probes.push({d, kind, ray: {x: p.x, z: p.y, hit: null, done: false}})
          }
          if (!d.loOk) add("lo", d.lo)
          if (!d.hiOk) add("hi", d.hi)
          if (d.loOk && d.hiOk) add("mid", (d.lo + d.hi) / 2)
        })
        this.cast(
          probes.map((p) => p.ray),
          new vec3(marker.x, height, marker.z),
          () => {
            for (const p of probes) {
              const d = p.d
              if (!d.ok) continue
              if (!p.ray.hit) {
                d.ok = false
                continue
              }
              const on = isOn(p.ray)
              if (p.kind === "lo") {
                if (on) d.loOk = true
                else d.ok = false
              } else if (p.kind === "hi") {
                if (!on) d.hiOk = true
                else if (++d.ext > 3) d.ok = false
                else {
                  d.lo = d.hi
                  d.loOk = true
                  d.hi *= 1.3
                }
              } else if (on) d.lo = (d.lo + d.hi) / 2
              else d.hi = (d.lo + d.hi) / 2
            }
            next()
          }
        )
      }
      this.log(`surface: grid ${kept.length}/${rays.length} kept at y ${height.toFixed(2)} (${edge.length} edge cells); coarse centre (${c0.x.toFixed(1)}, ${c0.y.toFixed(1)}) r ${r0.toFixed(1)}`)
      next()
    })
  }

  /** Call every frame: batches that never answer time out (the preview may not support hit tests). */
  update(): void {
    const p = this.pending
    if (!p) return
    if (p.rays.every((r) => r.done) || getTime() - p.started > BATCH_TIMEOUT) {
      this.pending = null
      p.onDone()
    }
  }

  private cast(rays: Ray[], ref: vec3, onDone: () => void): void {
    this.pending = {rays, started: getTime(), onDone}
    for (const r of rays) {
      const a = new vec3(r.x, ref.y + RAY_UP, r.z)
      const b = new vec3(r.x, ref.y - RAY_DOWN, r.z)
      try {
        this.session.hitTest(a, b, (hit) => {
          r.done = true
          r.hit = hit ? {p: hit.position, n: hit.normal.normalize()} : null
        })
      } catch (e) {
        r.done = true
        r.hit = null
      }
    }
  }

  private report(s: TableSurface, marker: vec3): void {
    s.offCenter = new vec3(s.center.x - marker.x, 0, s.center.z - marker.z).length
    s.offHeight = s.height - marker.y
    const how = s.method === "hitTest" ? "hit test (" + s.note + ")" : "FALLBACK (" + s.note + ")"
    this.log(
      `surface: ${how}: height ${s.height.toFixed(2)} cm, centre (${s.center.x.toFixed(2)}, ${s.center.z.toFixed(2)}), radius ${s.radius.toFixed(2)} cm (safe ${s.safeRadius.toFixed(2)}); ` +
        `vs tableMarker: centre ${s.offCenter.toFixed(2)} cm away, height ${s.offHeight >= 0 ? "+" : ""}${s.offHeight.toFixed(2)} cm`
    )
  }
}

/** Least-squares circle through points (Kåsa fit). Null if degenerate. */
export function fitCircle(pts: vec2[]): {c: vec2; r: number} | null {
  if (pts.length < 3) return null
  let mx = 0
  let my = 0
  for (const p of pts) {
    mx += p.x
    my += p.y
  }
  mx /= pts.length
  my /= pts.length
  let suu = 0
  let svv = 0
  let suv = 0
  let suuu = 0
  let svvv = 0
  let suvv = 0
  let svuu = 0
  for (const p of pts) {
    const u = p.x - mx
    const v = p.y - my
    suu += u * u
    svv += v * v
    suv += u * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-9) return null
  const bu = 0.5 * (suuu + suvv)
  const bv = 0.5 * (svvv + svuu)
  const uc = (bu * svv - bv * suv) / det
  const vc = (svv === 0 ? 0 : (suu * bv - suv * bu) / det)
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length)
  return {c: new vec2(uc + mx, vc + my), r}
}
