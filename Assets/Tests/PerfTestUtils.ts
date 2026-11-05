/**
 * Test-only performance tools (performance pass). Nothing in the Lens itself reads these.
 *
 * - FrameLogger: average and worst getDeltaTime over a window (plus wall clock and the time CutawayMain's
 *   own update takes, from getRealTimeNanos), read every frame after all the updates have run.
 * - Switches: turn one subsystem off while a state runs, by replacing an instance's method or
 *   disabling a scene object from here, so the Lens has no measuring code in it.
 * - Counts: scene objects, visuals, reachable materials and clones, for the leak checks.
 */
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"

export interface FrameStats {
  frames: number
  /** getDeltaTime, ms. */
  avg: number
  worst: number
  p95: number
  /** Time between frames by the wall clock, ms. */
  wall: number
  /** CutawayMain's own update, ms per frame. */
  script: number
  scriptWorst: number
  /** MeshBuilder calls per frame (only with counting on). */
  updates: number
  writes: number
}

const noop = (): void => {}

type Undo = () => void

export function patch(obj: any, key: string, fn: unknown): Undo {
  const own = Object.prototype.hasOwnProperty.call(obj, key)
  const old = obj[key]
  obj[key] = fn
  return () => {
    if (own) obj[key] = old
    else delete obj[key]
  }
}

/** Counts every MeshBuilder rebuild and vertex write while on. */
export class MeshCounter {
  updates = 0
  writes = 0
  /** Rebuilds of each mesh. */
  perMesh = new Map<MeshBuilder, number>()
  private undo: Undo[] = []

  on(): boolean {
    try {
      const proto = (MeshBuilder as any).prototype
      const update = proto.updateMesh
      const write = proto.setVertexInterleaved
      const append = proto.appendVerticesInterleaved
      const self = this
      this.undo.push(
        patch(proto, "updateMesh", function (this: MeshBuilder) {
          self.updates++
          self.perMesh.set(this, (self.perMesh.get(this) ?? 0) + 1)
          return update.call(this)
        })
      )
      this.undo.push(
        patch(proto, "setVertexInterleaved", function (this: MeshBuilder, i: number, v: number[]) {
          self.writes++
          return write.call(this, i, v)
        })
      )
      // Rewriting a whole mesh at once: one call, but every vertex counts.
      this.undo.push(
        patch(proto, "appendVerticesInterleaved", function (this: MeshBuilder, v: number[]) {
          self.writes += v.length / 10
          return append.call(this, v)
        })
      )
      return true
    } catch (e) {
      print("PERF: cannot count MeshBuilder calls: " + e)
      return false
    }
  }

  off(): void {
    this.undo.reverse().forEach((u) => u())
    this.undo = []
  }

  reset(): void {
    this.updates = 0
    this.writes = 0
    this.perMesh.clear()
  }

  /** The most rebuilds any one mesh has had since the reset. */
  mostForOneMesh(): number {
    let most = 0
    this.perMesh.forEach((n) => {
      if (n > most) most = n
    })
    return most
  }
}

export class FrameLogger {
  private ev: SceneEvent
  private buf = new Float32Array(4096)
  private n = 0
  private sum = 0
  private worst = 0
  private lastWall = 0
  private wallSum = 0
  private wallN = 0
  private on = false
  private scriptSum = 0
  private scriptWorst = 0
  private undoMain: Undo

  constructor(
    owner: BaseScriptComponent,
    main: CutawayMain,
    private counter: MeshCounter | null = null
  ) {
    this.ev = owner.createEvent("LateUpdateEvent")
    this.ev.bind(() => this.tick())
    const update = (main as any).onUpdate
    const self = this
    this.undoMain = patch(main, "onUpdate", function (this: CutawayMain) {
      if (!self.on) return update.call(this)
      const a = getRealTimeNanos()
      update.call(this)
      const ms = (getRealTimeNanos() - a) / 1e6
      self.scriptSum += ms
      if (ms > self.scriptWorst) self.scriptWorst = ms
    })
  }

  private tick(): void {
    if (!this.on) return
    const dt = getDeltaTime() * 1000
    if (this.n < this.buf.length) this.buf[this.n] = dt
    this.n++
    this.sum += dt
    if (dt > this.worst) this.worst = dt
    const w = getRealTimeNanos()
    if (this.lastWall > 0) {
      this.wallSum += (w - this.lastWall) / 1e6
      this.wallN++
    }
    this.lastWall = w
  }

  /** Average and worst frame over `seconds` (of frame time). */
  async measure(seconds: number): Promise<FrameStats> {
    this.n = 0
    this.sum = 0
    this.worst = 0
    this.lastWall = 0
    this.wallSum = 0
    this.wallN = 0
    this.scriptSum = 0
    this.scriptWorst = 0
    if (this.counter) this.counter.reset()
    this.on = true
    const t0 = getTime()
    while (getTime() - t0 < seconds) await sleep(100)
    this.on = false
    const m = Math.min(this.n, this.buf.length)
    const sorted = Array.prototype.slice.call(this.buf.subarray(0, m)).sort((a: number, b: number) => a - b)
    return {
      frames: this.n,
      avg: this.sum / Math.max(1, this.n),
      worst: this.worst,
      p95: m ? sorted[Math.min(m - 1, Math.floor(m * 0.95))] : 0,
      wall: this.wallSum / Math.max(1, this.wallN),
      script: this.scriptSum / Math.max(1, this.n),
      scriptWorst: this.scriptWorst,
      updates: this.counter ? this.counter.updates / Math.max(1, this.n) : 0,
      writes: this.counter ? this.counter.writes / Math.max(1, this.n) : 0
    }
  }

  dispose(): void {
    this.on = false
    this.ev.enabled = false
    this.undoMain()
  }
}

export function perfLine(state: string, off: string, s: FrameStats): string {
  const f = (v: number) => v.toFixed(2)
  return `PERF|${state}|${off}|avg ${f(s.avg)}|worst ${f(s.worst)}|p95 ${f(s.p95)}|frames ${s.frames}|wall ${f(s.wall)}|script ${f(s.script)}|scriptWorst ${f(s.scriptWorst)}|updates ${s.updates.toFixed(1)}|writes ${s.writes.toFixed(0)}`
}

// =====================================================================================
// Switches: one subsystem off at a time
// =====================================================================================

function hideNames(names: string[]): Undo {
  const undo: Undo[] = []
  for (const n of names) {
    const so = findSceneObjectByName(n)
    if (!so) {
      print(`PERF: ${n} is not in the scene`)
      continue
    }
    const was = so.enabled
    so.enabled = false
    undo.push(() => {
      so.enabled = was
    })
  }
  return () => undo.forEach((u) => u())
}

function noopUpdates(list: any[]): Undo {
  const undo: Undo[] = []
  for (const o of list.filter((x) => !!x)) for (const m of ["update", "commit", "writeXY", "writeFlat", "writeCircle"]) if (typeof o[m] === "function") undo.push(patch(o, m, noop))
  return () => undo.forEach((u) => u())
}

function haloOff(main: CutawayMain): Undo {
  const m = main as any
  const undoMain = patch(m, "updateHalos", noop)
  const was: {root: SceneObject; on: boolean}[] = []
  if (m.halos)
    m.halos.sets.forEach((s: {root: SceneObject}) => {
      was.push({root: s.root, on: s.root.enabled})
      s.root.enabled = false
    })
  return () => {
    undoMain()
    for (const w of was) w.root.enabled = w.on
  }
}

const plates = (rail: string) => [rail + "PlateTop", rail + "PlateMid", rail + "PlateBottom"]

/** Every switch for a stage, by name. */
export function switchesFor(main: CutawayMain, stage: "lamp" | "rp"): {[name: string]: () => Undo} {
  if (stage === "lamp") {
    const h = main.getLampHero() as any
    const l = h.light
    const g = l.g
    const a = h.apart
    return {
      rb_current: () => noopUpdates([g.core, g.halo]),
      rb_thread: () => noopUpdates([g.threadCore, g.threadHalo]),
      rb_bubble: () => noopUpdates(l.bubble ? [l.bubble.cloud] : []),
      rb_driver: () => noopUpdates([a.wave, a.flat]),
      rb_pools: () => noopUpdates([g.tablePool, g.floorPool]),
      rb_shade: () => noopUpdates([g.shadeMesh]),
      rb_rays: () => noopUpdates([g.rays]),
      glow_real: () => hideNames(["LampRealGlow"]),
      bloom_real: () => hideNames(["LampRealBloom"]),
      pool_floor: () => hideNames(["LampFloorPool"]),
      pool_table: () => hideNames(["LampTablePool"]),
      glow_shade: () => hideNames(["LampShadeGlow"]),
      bulb_point: () => hideNames(["LampBulbPoint"]),
      draw_current: () => hideNames(["LampCurrent", "LampCurrentGlow"]),
      draw_thread: () => hideNames(["LampThread", "LampThreadGlow"]),
      draw_bubble: () => hideNames(["LampBubble", "LampBubbleLeader"]),
      rail_glass: () => hideNames(plates("LampRailPanel")),
      halos: () => haloOff(main),
      labels: () => patch(a, "updateLabels", noop),
      looks: () => patch(h, "applyLooks", noop),
      rail_shift: () => patch(h, "updateRailShift", noop),
      light_cpu: () => patch(l, "update", noop)
    }
  }
  const h = main.getRpHero() as any
  const s = h.sound
  const a = h.apart
  const ringNames: string[] = []
  for (let i = 0; i < 14; i++) ringNames.push("RpRing" + i)
  return {
    tone: () => patch(main.getRpTone(), "update", noop),
    rb_rings: () => noopUpdates(s ? s.rings : []),
    rb_wave: () => noopUpdates(s ? [s.wave, s.waveHalo] : []),
    rb_groove: () => noopUpdates(s && s.bubble ? [...s.bubble.walls, s.bubble.next] : []),
    draw_rings: () => hideNames(s ? ringNames : []),
    draw_wave: () => hideNames(s ? ["RpSignalWave", "RpSignalWaveGlow"] : []),
    draw_thread: () => hideNames(s ? ["RpThread"] : []),
    draw_cone: () => hideNames(s ? ["RpCone"] : []),
    draw_bubble: () => hideNames(s ? ["RpBubble", "RpBubbleLeader"] : []),
    rail_glass: () => hideNames(plates("RpRailPanel")),
    halos: () => haloOff(main),
    labels: () => patch(a, "updateLabels", noop),
    looks: () => patch(h, "applyLooks", noop),
    rail_shift: () => patch(h, "updateRailShift", noop),
    live: () => patch(a, "updateLive", noop),
    sound_cpu: () => patch(s ?? {}, "update", noop)
  }
}

// =====================================================================================
// Counts
// =====================================================================================

export interface SceneCounts {
  objects: number
  visuals: number
  materials: number
  byName: Map<string, number>
}

function anyMaterial(): Material {
  let found: Material | null = null
  const walk = (so: SceneObject) => {
    if (found) return
    const rmv = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
    if (rmv && rmv.getMaterialsCount() > 0) found = rmv.getMaterial(0)
    for (let i = 0; i < so.getChildrenCount() && !found; i++) walk(so.getChild(i))
  }
  for (let i = 0; i < global.scene.getRootObjectsCount() && !found; i++) walk(global.scene.getRootObject(i))
  if (!found) throw new Error("no material in the scene")
  return found
}

/** Clones made since the patch went on (Material.clone is wrapped for the leak checks). */
export class CloneCounter {
  made = 0
  private undo: Undo | null = null

  on(): boolean {
    try {
      // Material is not a global at runtime: reach its prototype through a material in the scene.
      const proto = Object.getPrototypeOf(anyMaterial())
      const clone = proto.clone
      const self = this
      this.undo = patch(proto, "clone", function (this: Material) {
        self.made++
        return clone.call(this)
      })
      return true
    } catch (e) {
      print("PERF: cannot count clones: " + e)
      return false
    }
  }

  off(): void {
    if (this.undo) this.undo()
    this.undo = null
  }
}

/** Scene objects, visuals and the materials they draw with, from the scene's roots down. */
export function countScene(): SceneCounts {
  const byName = new Map<string, number>()
  const mats = new Set<string>()
  let objects = 0
  let visuals = 0
  const walk = (so: SceneObject) => {
    // The test driver's own interactors (LEAF makes two per press or drag): not the Lens's.
    if (so.name === "DefaultLeafInteractor") return
    objects++
    byName.set(so.name, (byName.get(so.name) ?? 0) + 1)
    for (const c of so.getComponents("Component.RenderMeshVisual") as RenderMeshVisual[]) {
      visuals++
      for (let i = 0; i < c.getMaterialsCount(); i++) {
        const m = c.getMaterial(i)
        if (m) mats.add((m as unknown as {uniqueIdentifier: string}).uniqueIdentifier)
      }
    }
    for (let i = 0; i < so.getChildrenCount(); i++) walk(so.getChild(i))
  }
  for (let i = 0; i < global.scene.getRootObjectsCount(); i++) walk(global.scene.getRootObject(i))
  return {objects, visuals, materials: mats.size, byName}
}

/** What grew or shrank since `a`, by object name. */
export function countsDiff(a: SceneCounts, b: SceneCounts): string {
  const out: string[] = []
  b.byName.forEach((n, k) => {
    const d = n - (a.byName.get(k) ?? 0)
    if (d !== 0) out.push(`${k} ${d > 0 ? "+" : ""}${d}`)
  })
  a.byName.forEach((n, k) => {
    if (!b.byName.has(k)) out.push(`${k} -${n}`)
  })
  return out.slice(0, 40).join(", ")
}

export function countsLine(what: string, c: SceneCounts, clones: number): string {
  return `LEAK|${what}|objects ${c.objects}|visuals ${c.visuals}|materials ${c.materials}|clones made ${clones}`
}

export {check, waitForPhase, waitUntil}
