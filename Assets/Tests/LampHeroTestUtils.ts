/**
 * Shared helpers for the lamp hero stage scenarios (L1–L7, lamp-hero.md Phase B). The stage is
 * driven through the real UI (the lamp's second question / its "Bring it closer" pill, the foot
 * switch, the rail's pill) and LampHero's test hooks in place of dragging UI Kit sliders.
 */
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {LampHero} from "../Scripts/CutawayLampHero"
import {cleanStart, press, SETTLE_MS, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"

export function getLamp(main: CutawayMain): LampHero {
  const h = main.getLampHero()
  if (!h) throw new Error("lamp hero stage is not wired")
  return h
}

/** cleanStart, and the lamp stage's own hold flag off. */
export async function lampCleanStart(main: CutawayMain): Promise<void> {
  main.setHoldLamp(false)
  main.setHoldRp(false)
  await cleanStart(main)
}

/** Open the lamp's questions and pinch the second one ("Bring it closer"). */
export async function launchLampViaQuestion(main: CutawayMain): Promise<void> {
  main.lookAt("lamp")
  await sleep(SETTLE_MS)
  await press("LampChip")
  await sleep(300)
  await press("LampQ1")
  main.setGazeOverride(null)
}

/** Launch via the second question and wait until the copy stands on the table. */
export async function landLamp(main: CutawayMain): Promise<LampHero> {
  await launchLampViaQuestion(main)
  await waitForPhase(main, "lamp:landed", 4000)
  await sleep(500)
  return getLamp(main)
}

/**
 * L1 contact accuracy: still (under 0.5 cm/s), upright (tilt under 1°; the stage levels it to
 * well under that), its base within 2 mm of the table top and no part below it, and its whole floor
 * outline (base, cord, switch and plug) on the table.
 */
export function checkLampContact(lamp: LampHero, what: string): void {
  const i = lamp.getInfo()
  const gap = i.lowestY - i.tableY
  check(i.pose === "rest", () => `${what}: pose is ${i.pose}, not rest`)
  check(i.speed < 0.5, () => `${what}: still moving at ${i.speed.toFixed(3)} cm/s`)
  check(gap >= -0.005, () => `${what}: a part is ${(-gap * 10).toFixed(2)} mm below the table top`)
  check(gap <= 0.2, () => `${what}: the base is ${(gap * 10).toFixed(2)} mm above the table top`)
  const tilt = Math.acos(Math.max(-1, Math.min(1, i.up.dot(vec3.up())))) * (180 / Math.PI)
  check(tilt < 1, () => `${what}: tilted ${tilt.toFixed(3)}°`)
  check(i.footReach <= i.tableRadius + 0.01, () => `${what}: the cord, switch or base reaches ${i.footReach.toFixed(2)} cm from the table centre (radius ${i.tableRadius.toFixed(2)})`)
}

/** Flat distance from the base's centre to the table centre (cm). */
export function lampOffCenter(lamp: LampHero): number {
  const i = lamp.getInfo()
  return new vec3(i.foot.x - i.tableCenter.x, 0, i.foot.z - i.tableCenter.z).length
}

/** Wait until the copy rests (pose "rest", still, not held) on the table, at most `ms`. */
export async function waitLampRest(lamp: LampHero, ms: number, what: string): Promise<void> {
  await waitUntil(
    () => {
      const i = lamp.getInfo()
      return i.pose === "rest" && i.speed < 0.5 && !i.held
    },
    ms,
    () => `${what}: not at rest after ${ms} ms: ${JSON.stringify({pose: lamp.getInfo().pose, speed: lamp.getInfo().speed, gap: lamp.getInfo().lowestY - lamp.getInfo().tableY})}`
  )
}

/** Wait for "Put it back" to finish (the stage clears itself). */
export async function waitLampHome(main: CutawayMain): Promise<void> {
  await waitForPhase(main, "lamp:home", 7000)
  await sleep(300)
  await waitUntil(() => getLamp(main).state === "none", 1000)
}

/** Every object the lamp stage makes (none may be left once it is gone). */
export const LAMP_STAGE_OBJECTS = ["LampStage", "LampReplica", "LampTrail", "LampGrab", "LampTurnGrab", "LampSwitchGrab", "LampContactGlow", "LampHoverDisc", ...lampLightObjects()]

/** Every object the light makes (none may be left once it is off). */
export function lampLightObjects(): string[] {
  return ["LampLight", "LampCurrent", "LampCurrentGlow", "LampShadeGlow", "LampBulbPoint", "LampTablePool", "LampBubble", "LampBubbleLeader", "LampThread", "LampThreadGlow", "LampRealGlow", "LampRealBloom", "LampFloorPool"]
}

/** Pinch the copy's foot switch. */
export async function pressLampSwitch(): Promise<void> {
  await press("LampSwitchGrab")
}

/** The light is off: nothing of it is drawn or left, the rail shows no Brightness or Warmth. */
export function expectLampDark(main: CutawayMain, what: string): void {
  const lamp = getLamp(main)
  const li = lamp.getLight()
  check(!!li && li.phase === "off", () => `${what}: the light is ${li ? li.phase : "missing"}`)
  check(li.led === 0 && li.shadeGlow === 0 && li.realGlow === 0 && li.floorPool === 0 && li.pulseLevel === 0 && li.bubbleOpen === 0, () => `${what}: still lit: ${JSON.stringify({led: li.led, shade: li.shadeGlow, real: li.realGlow, floor: li.floorPool, pulses: li.pulseLevel, bubble: li.bubbleOpen})}`)
  for (const n of lampLightObjects()) check(findSceneObjectByName(n) === undefined, () => `${what}: ${n} is still in the scene`)
  const rail = main.getLampRailVisual()
  check(!!rail && !rail.brightness && !rail.warmth, () => `${what}: the rail still shows Brightness or Warmth: ${JSON.stringify(rail)}`)
}

/** Nothing of the lamp stage left: no copy, light, rail or caption. */
export function expectLampGone(main: CutawayMain): void {
  const lamp = getLamp(main)
  check(lamp.state === "none", `stage state is ${lamp.state}`)
  check(lamp.getReplica() === null, "the copy is still there")
  for (const n of LAMP_STAGE_OBJECTS) check(findSceneObjectByName(n) === undefined, `${n} is still in the scene`)
  const labels = main.labelsUI.shownIds().filter((id) => id.startsWith("lamp_"))
  check(labels.length === 0, () => `labels still shown: ${labels.join(", ")}`)
  const rail = main.getLampRailVisual()
  check(!!rail && !(rail.apart || rail.brightness || rail.warmth || rail.putBack), () => `the rail still shows: ${JSON.stringify(rail)}`)
}
