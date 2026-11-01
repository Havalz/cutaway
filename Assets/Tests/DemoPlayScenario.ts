import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {StationKey} from "../Scripts/CutawayMain"
import {cleanStart, getMain, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Helper (not a done-criterion test): starts one object's guaranteed explanation and returns
 * immediately, so the explanation keeps playing in the preview for screenshots / manual review.
 * Parameter `station`: recordPlayer | camera | lamp. Optional `untilPhase` (e.g. "rays", "sensor"):
 * return only once that phase has started, plus `extraMs`, so a screenshot taken right after shows it.
 */
@component
export class DemoPlayScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    await sleep(300)
    const main = getMain()
    const key = ((config && config.get("station")) || "recordPlayer") as StationKey
    await cleanStart(main)
    await startGuaranteedQuestion(main, key)
    main.setGazeOverride(null)
    const until = config ? (config.get("untilPhase") as string) : ""
    if (until) {
      await waitForPhase(main, until, 20000)
      const extra = Number((config && config.get("extraMs")) || 0)
      if (extra > 0) await sleep(extra)
    }
  }
}
