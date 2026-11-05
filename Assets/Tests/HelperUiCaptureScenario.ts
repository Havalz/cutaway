import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {StationKey} from "../Scripts/CutawayMain"
import {cleanStart, getMain} from "./CutawayTestUtils"

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
    await sleep(extra)
  }
}
