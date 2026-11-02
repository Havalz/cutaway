import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {imageDistance} from "../Scripts/CutawayHero"
import {cleanStart, getMain, isEnabled, KEYS, press, SETTLE_MS, softReset, waitForPhase} from "./CutawayTestUtils"
import {check, expectStageGone, landHero, launchViaQuestion, toLive, waitHome} from "./HeroTestUtils"

/**
 * H6 (camera hero, put it back and Reset): "Put it back" ends with no replica, thread, print or
 * rail, and the camera in its explained state. Reset from each step (launching, apart, light
 * path, photo) clears the stage the same way, and — as Reset always does — every object goes
 * back to idle.
 */
@component
export class H6PutBackResetScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // Put it back, from the light path with a print out.
    let hero = await landHero(main)
    await toLive(main, hero)
    hero.setFocusL(imageDistance(50))
    await press("HeroPhoto")
    await waitForPhase(main, "hero:print", 1500)
    await sleep(300)
    await press("HeroPutBack")
    await waitForPhase(main, "hero:putBack", 500)
    await waitHome(main)
    expectStageGone(main)
    expect(main.getStationState("camera")).toBe("explained")
    check(main.isExplained("camera"), "expected main.isExplained(\"camera\")")
    check(main.getStationVisual("camera").explainedDot, "expected main.getStationVisual(\"camera\").explainedDot")

    // Reset while launching.
    await softReset(main)
    await launchViaQuestion(main)
    await waitForPhase(main, "hero:flight", 2500)
    await resetAndCheck(main)

    // Reset with the parts apart.
    await softReset(main)
    hero = await landHero(main)
    hero.setApart(0.7)
    await sleep(600)
    await resetAndCheck(main)

    // Reset in the light path.
    await softReset(main)
    hero = await landHero(main)
    await toLive(main, hero)
    await resetAndCheck(main)

    // Reset right after a photo (print out).
    await softReset(main)
    hero = await landHero(main)
    await toLive(main, hero)
    await press("HeroPhoto")
    await waitForPhase(main, "hero:print", 1500)
    await resetAndCheck(main)
  }
}

async function resetAndCheck(main: CutawayMain): Promise<void> {
  main.lookAway()
  await sleep(300)
  check(isEnabled("ResetPill"), "expected isEnabled(\"ResetPill\")")
  await press("ResetPill")
  await sleep(SETTLE_MS)
  expectStageGone(main)
  for (const key of KEYS) expect(main.getStationState(key)).toBe("idle")
  main.setGazeOverride(null)
}
