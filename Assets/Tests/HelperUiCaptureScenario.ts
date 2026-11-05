import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {StationKey} from "../Scripts/CutawayMain"
import {kelvinToWarmth} from "../Scripts/CutawayLampLight"
import {freqToPitch} from "../Scripts/CutawayRpSound"
import {cleanStart, getMain, KEYS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"
import {landHero, toLive} from "./HeroTestUtils"
import {lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

/** Not a test: leaves the preview at a polish beat for a capture. */
@component
export class HelperUiCaptureScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const beat = get("beat") || "halo"
    const extra = Number(get("extraMs") || "700")
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    if (beat === "halo") main.lookAt((get("station") || "recordPlayer") as StationKey)
    if (beat === "opening") {
      main.holdOpeningAt(Number(get("holdAt") || "3"))
      main.resetAll()
    }
    if (beat === "trio") {
      for (const key of KEYS.slice(0, 2)) {
        await startGuaranteedQuestion(main, key)
        await waitForPhase(main, "explained", 40000)
        main.lookAway()
        await sleep(800)
      }
    }
    if (beat === "rail_camera") {
      const hero = await landHero(main)
      await toLive(main, hero)
      main.getHeroRail().setFocusValue(0.5)
    }
    if (beat === "rail_rp") {
      await rpCleanStart(main)
      const rp = await landRp(main)
      await dropNeedle(main, rp)
      await waitForPhase(main, "rp:soundArrived", 6000)
      main.getRpRail().setValue("loudness", 0.6)
      main.getRpRail().setValue("pitch", freqToPitch(440))
    }
    if (beat === "rail_lamp") {
      await lampCleanStart(main)
      await landLamp(main)
      await sleep(300)
      await pressLampSwitch()
      await waitForPhase(main, "lamp:scatter", 6000)
      main.getLampRail().setValue("brightness", 0.7)
      main.getLampRail().setValue("warmth", kelvinToWarmth(4000))
    }
    if (beat === "finale") {
      main.holdFinaleAt(Number(get("holdAt") || "3.5"))
      main.fillTrioForTest()
    }
    await sleep(extra)
  }
}
