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
