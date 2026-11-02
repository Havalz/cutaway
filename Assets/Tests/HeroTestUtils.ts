/**
 * Shared helpers for the camera hero stage scenarios (H1–H6).
 * The stage is driven through the real UI (the camera's second question / "Bring it closer" pill,
 * the rail's pills) and CameraHero's test hooks (setApart, setFocusL, setSubjectDistance) in place
 * of dragging the UI Kit sliders.
 */
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CameraHero} from "../Scripts/CutawayHero"
import {CutawayMain} from "../Scripts/CutawayMain"
import {press, SETTLE_MS, waitForPhase, waitUntil} from "./CutawayTestUtils"

/** Assert with a message that says what failed (LEAF's boolean expects only say true/false). */
export function check(cond: boolean, msg: string | (() => string)): void {
  if (!cond) throw new Error(typeof msg === "string" ? msg : msg())
}

export function getHero(main: CutawayMain): CameraHero {
  const h = main.getHero()
  if (!h) throw new Error("camera hero stage is not wired")
  return h
}

/** Open the camera's questions and pinch the second one ("Bring it closer" from the questions). */
export async function launchViaQuestion(main: CutawayMain): Promise<void> {
  main.lookAt("camera")
  await sleep(SETTLE_MS)
  await press("CameraChip")
  await sleep(300)
  await press("CameraQ1")
  main.setGazeOverride(null)
}

/** Launch via the second question and wait until the replica is at rest on the table. */
export async function landHero(main: CutawayMain): Promise<CameraHero> {
  await launchViaQuestion(main)
  await waitForPhase(main, "hero:landed", 4000)
  await sleep(500)
  return getHero(main)
}

/** Slider to 1: the light path starts; wait through the viewfinder beat to live view. */
export async function toLive(main: CutawayMain, hero: CameraHero): Promise<void> {
  hero.setApart(1)
  await waitForPhase(main, "hero:light", 3000)
  await waitForPhase(main, "hero:live", 5000)
  await sleep(200)
}

export function phaseCount(main: CutawayMain, phase: string): number {
  return main.getPhaseLog().filter((p) => p === phase).length
}

/** Sounds named `name` played since `since` (getTime()). */
export function soundsSince(main: CutawayMain, name: string, since: number): {name: string; time: number; position: vec3}[] {
  return main.getSoundLog().filter((s) => s.name === name && s.time >= since)
}

/** Nothing of the stage left: no replica, thread, ring, print or rail. */
export function expectStageGone(main: CutawayMain): void {
  const hero = getHero(main)
  check(hero.state === "none", `stage state is ${hero.state}`)
  check(hero.getReplica() === null, "the replica is still there")
  check(!hero.getPrint().shown, "a print is still shown")
  for (const n of ["HeroStage", "HeroReplica", "HeroThread", "HeroTableRing", "HeroPhotoPrint", "HeroSubject", "HeroRays"]) {
    check(findSceneObjectByName(n) === undefined, `${n} is still in the scene`)
  }
  const rail = main.getHeroRailVisual()
  check(!(rail.apart || rail.focus || rail.putBack || rail.photo), () => `the rail still shows: ${JSON.stringify(rail)}`)
}

/** Wait for "Put it back" to finish (the stage clears itself). */
export async function waitHome(main: CutawayMain): Promise<void> {
  await waitForPhase(main, "hero:home", 5000)
  await sleep(300)
  await waitUntil(() => getHero(main).state === "none", 1000)
}

/**
 * P2 contact accuracy (pass 2): still (under 0.5 cm/s), level, its lowest point within 2 mm of
 * the table top and no part below it, and the whole footprint on the table.
 */
export function checkContact(hero: CameraHero, what: string): void {
  const i = hero.getInfo()
  const gap = i.lowestY - i.tableY
  check(i.pose === "rest", () => `${what}: pose is ${i.pose}, not rest`)
  check(i.speed < 0.5, () => `${what}: still moving at ${i.speed.toFixed(3)} cm/s`)
  check(gap >= -0.005, () => `${what}: a part is ${(-gap * 10).toFixed(2)} mm below the table top`)
  check(gap <= 0.2, () => `${what}: lowest point ${(gap * 10).toFixed(2)} mm above the table top`)
  check(i.up.dot(vec3.up()) > 0.99996, () => `${what}: not level, up = ${i.up}`)
  check(i.footReach <= i.tableRadius + 0.01, () => `${what}: the footprint reaches ${i.footReach.toFixed(2)} cm from the table centre (radius ${i.tableRadius.toFixed(2)})`)
}

/** Flat distance from the footprint centre to the table centre (cm). */
export function footOffCenter(hero: CameraHero): number {
  const i = hero.getInfo()
  return new vec3(i.foot.x - i.tableCenter.x, 0, i.foot.z - i.tableCenter.z).length
}

/** Wait until the replica rests (pose "rest", still) on the table, at most `ms`. */
export async function waitRest(hero: CameraHero, ms: number, what: string): Promise<void> {
  await waitUntil(
    () => {
      const i = hero.getInfo()
      return i.pose === "rest" && i.speed < 0.5 && !i.held
    },
    ms,
    () => `${what}: not at rest after ${ms} ms: ${JSON.stringify({pose: hero.getInfo().pose, speed: hero.getInfo().speed, gap: hero.getInfo().lowestY - hero.getInfo().tableY})}`
  )
}
