/**
 * Shared helpers for the record player hero stage scenarios (R1–R8, recordplayer-hero.md Phase B).
 * The stage is driven through the real UI (the record player's second question / its "Bring it
 * closer" pill, the rail's pill) and RecordPlayerHero's test hooks in place of dragging UI Kit sliders.
 */
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {RecordPlayerHero} from "../Scripts/CutawayRpHero"
import {cleanStart, drag, press, SETTLE_MS, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"

export function getRp(main: CutawayMain): RecordPlayerHero {
  const h = main.getRpHero()
  if (!h) throw new Error("record player hero stage is not wired")
  return h
}

/** cleanStart, and the record player stage's own hold flag off. */
export async function rpCleanStart(main: CutawayMain): Promise<void> {
  main.setHoldRp(false)
  await cleanStart(main)
}

/** Open the record player's questions and pinch the second one ("Bring it closer"). */
export async function launchRpViaQuestion(main: CutawayMain): Promise<void> {
  main.lookAt("recordPlayer")
  await sleep(SETTLE_MS)
  await press("RecordPlayerChip")
  await sleep(300)
  await press("RecordPlayerQ1")
  main.setGazeOverride(null)
}

/** Launch via the second question and wait until the copy is at rest on the table. */
export async function landRp(main: CutawayMain): Promise<RecordPlayerHero> {
  await launchRpViaQuestion(main)
  await waitForPhase(main, "rp:landed", 4000)
  await sleep(500)
  return getRp(main)
}

/**
 * P2 contact accuracy: still (under 0.5 cm/s), level, its lowest point within 2 mm of the table top
 * and no part below it, and the whole footprint on the table.
 */
export function checkRpContact(rp: RecordPlayerHero, what: string): void {
  const i = rp.getInfo()
  const gap = i.lowestY - i.tableY
  check(i.pose === "rest", () => `${what}: pose is ${i.pose}, not rest`)
  check(i.speed < 0.5, () => `${what}: still moving at ${i.speed.toFixed(3)} cm/s`)
  check(gap >= -0.005, () => `${what}: a part is ${(-gap * 10).toFixed(2)} mm below the table top`)
  check(gap <= 0.2, () => `${what}: lowest point ${(gap * 10).toFixed(2)} mm above the table top`)
  check(i.up.dot(vec3.up()) > 0.99996, () => `${what}: not level, up = ${i.up}`)
  check(i.footReach <= i.tableRadius + 0.01, () => `${what}: the footprint reaches ${i.footReach.toFixed(2)} cm from the table centre (radius ${i.tableRadius.toFixed(2)})`)
}

/** Flat distance from the footprint centre to the table centre (cm). */
export function rpFootOffCenter(rp: RecordPlayerHero): number {
  const i = rp.getInfo()
  return new vec3(i.foot.x - i.tableCenter.x, 0, i.foot.z - i.tableCenter.z).length
}

/** Wait until the copy rests (pose "rest", still, not held) on the table, at most `ms`. */
export async function waitRpRest(rp: RecordPlayerHero, ms: number, what: string): Promise<void> {
  await waitUntil(
    () => {
      const i = rp.getInfo()
      return i.pose === "rest" && i.speed < 0.5 && !i.held
    },
    ms,
    () => `${what}: not at rest after ${ms} ms: ${JSON.stringify({pose: rp.getInfo().pose, speed: rp.getInfo().speed, gap: rp.getInfo().lowestY - rp.getInfo().tableY})}`
  )
}

/** Wait for "Put it back" to finish (the stage clears itself). */
export async function waitRpHome(main: CutawayMain): Promise<void> {
  await waitForPhase(main, "rp:home", 6000)
  await sleep(300)
  await waitUntil(() => getRp(main).state === "none", 1000)
}

/** Nothing of the record player stage left: no copy, thread, rings, bubble, rail or tone. */
export function expectRpGone(main: CutawayMain): void {
  const rp = getRp(main)
  check(rp.state === "none", `stage state is ${rp.state}`)
  check(rp.getReplica() === null, "the copy is still there")
  for (const n of ["RpStage", "RpReplica", "RpSound", "RpThread", "RpBubble", "RpRing0", "RpCone", "RpTrail", "RpArmGrab", "RpGrab", "RpTurnGrab"]) {
    check(findSceneObjectByName(n) === undefined, `${n} is still in the scene`)
  }
  const labels = main.labelsUI.shownIds().filter((id) => id.startsWith("rp_"))
  check(labels.length === 0, () => `labels still shown: ${labels.join(", ")}`)
  const rail = main.getRpRailVisual()
  check(!!rail && !(rail.apart || rail.loudness || rail.pitch || rail.putBack), () => `the rail still shows: ${JSON.stringify(rail)}`)
  const tone = main.getRpTone()
  check(!tone || !tone.isOn, "the tone is still playing")
}

// =====================================================================================
// The tonearm and the platter (R3–R6)
// =====================================================================================

/**
 * A unit drag direction (world, flat) that swings the tonearm's finger lift toward the record
 * (`toward` = true) or away from it, tangent to its circle about the pivot.
 */
export function armSwingDir(rp: RecordPlayerHero, toward: boolean): vec3 {
  const piv = rp.pivotWorldForTest()
  const h = findSceneObjectByName("RpArmGrab").getTransform().getWorldPosition()
  const r = new vec3(h.x - piv.x, 0, h.z - piv.z)
  // A positive yaw turns +Z toward +X (up × r); the record is on the negative side.
  const t = vec3.up().cross(r).normalize()
  return toward ? t.uniformScale(-1) : t
}

/** Drag the arm onto the record (it clamps at the inner groove) and wait for the needle to touch down. */
export async function dropNeedle(main: CutawayMain, rp: RecordPlayerHero): Promise<number> {
  const dir = armSwingDir(rp, true)
  await drag("RpArmGrab", dir.uniformScale(0.8).add(new vec3(0, -0.04, 0)), 1200)
  await waitForPhase(main, "rp:needleDown", 1500)
  return getTime()
}

/**
 * Measures the platter's turning from its transform, frame by frame after every update (LateUpdate):
 * the angle it turned about the copy's vertical axis over the frames' own delta times.
 */
export class PlatterMeter {
  private ev: SceneEvent
  private last: number | null = null
  private angle = 0
  private time = 0
  private on = false

  constructor(
    comp: BaseScriptComponent,
    private rp: RecordPlayerHero
  ) {
    this.ev = comp.createEvent("LateUpdateEvent")
    this.ev.bind(() => this.tick())
  }

  /** The platter's angle about the copy's up axis (rad), read from the world transforms. */
  read(): number {
    const p = this.rp.getPart("RpPlatter")
    const rep = this.rp.getReplica()
    if (!p || !rep) return 0
    const rel = rep.getTransform().getWorldRotation().invert().multiply(p.getTransform().getWorldRotation())
    const v = rel.multiplyVec3(vec3.right())
    return Math.atan2(-v.z, v.x)
  }

  start(): void {
    this.angle = 0
    this.time = 0
    // The first LateUpdate takes the reference angle: from then on each frame adds its own turn and dt.
    this.last = null
    this.on = true
  }

  /** Average speed (rpm, signed: clockwise from above is negative) since start(). */
  rpm(): number {
    return this.time > 0 ? (this.angle / this.time) * (60 / (2 * Math.PI)) : 0
  }

  stop(): void {
    this.on = false
    this.ev.enabled = false
  }

  private tick(): void {
    if (!this.on) return
    const a = this.read()
    if (this.last === null) {
      this.last = a
      return
    }
    let d = a - this.last
    while (d > Math.PI) d -= 2 * Math.PI
    while (d < -Math.PI) d += 2 * Math.PI
    this.angle += d
    this.time += getDeltaTime()
    this.last = a
  }
}

/** Platter speed (rpm, magnitude) measured over `ms` from now. */
export async function measureRpm(meter: PlatterMeter, ms: number): Promise<number> {
  meter.start()
  await sleep(ms)
  return Math.abs(meter.rpm())
}

/** The world distance from a point to the speaker marker. */
export function fromSpeaker(main: CutawayMain, p: vec3 | null): number {
  if (!p) return Infinity
  return p.distance(main.speakerMarker.getTransform().getWorldPosition())
}
