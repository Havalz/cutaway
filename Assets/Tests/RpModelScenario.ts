import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getMain} from "./CutawayTestUtils"
import {buildRpModel, reportRpModel} from "./RpTestUtils"

/**
 * Helper (not a done-criterion test): builds the record player model at scale 1 beside the real
 * deck and leaves it there for the checkpoint captures (recordplayer-hero.md, Phase A).
 * Parameters (all optional): `dx`, `dz` = offset from the real deck's footprint centre (world cm,
 * default 50, 0); `interior` "1" shows the interior parts; `hide` = comma-separated part names;
 * `at` "table" puts it on the coffee table instead, at `scale` (default 1.5) and `yaw` (degrees).
 */
@component
export class RpModelScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const str = (k: string) => (config ? ((config.get(k) as string) ?? "") : "").trim()
    const num = (k: string, d: number) => (str(k) !== "" && isFinite(Number(str(k))) ? Number(str(k)) : d)
    await sleep(800)
    // at "table": on the coffee table's fallback top at the table marker (hero scale, yaw).
    const main = getMain()
    const tm = main.getTablePosition()
    const place = str("at") === "table" ? {at: new vec3(tm.x, main.tableTopHeight, tm.z), scale: num("scale", 1.5), yawDeg: num("yaw", 0)} : undefined
    const m = buildRpModel(new vec3(num("dx", 50), 0, num("dz", 0)), place)
    m.setInteriorVisible(str("interior") === "1")
    for (const name of str("hide").split(",").map((s) => s.trim()).filter((s) => s !== "")) {
      const so = findSceneObjectByName(name)
      if (so) so.enabled = false
      else print(`rp-model: no part named ${name}`)
    }
    await sleep(200)
    reportRpModel(m)
  }
}
