import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {StationKey} from "../Scripts/CutawayMain"
import {cleanStart, getMain, startGuaranteedQuestion} from "./CutawayTestUtils"

/**
 * Helper (not a done-criterion test): starts one object's guaranteed explanation and returns
 * immediately, so the explanation keeps playing in the preview for screenshots / manual review.
 * Parameter `station`: recordPlayer | camera | lamp.
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
  }
}
