/**
 * Shared helpers for the record player hero stage scenarios (R1–R8, recordplayer-hero.md Phase B).
 * The stage is driven through the real UI (the record player's second question / its "Bring it
 * closer" pill, the rail's pill) and RecordPlayerHero's test hooks in place of dragging UI Kit sliders.
 */
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {RecordPlayerHero} from "../Scripts/CutawayRpHero"
import {cleanStart, press, SETTLE_MS, waitForPhase, waitUntil} from "./CutawayTestUtils"
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
  for (const n of ["RpStage", "RpReplica", "RpThread", "RpBubble", "RpRings", "RpCone", "RpTrail"]) {
    check(findSceneObjectByName(n) === undefined, `${n} is still in the scene`)
  }
  const rail = main.getRpRailVisual()
  check(!!rail && !(rail.apart || rail.loudness || rail.pitch || rail.putBack), () => `the rail still shows: ${JSON.stringify(rail)}`)
  const tone = main.getRpTone()
  check(!tone || !tone.isOn, "the tone is still playing")
}
