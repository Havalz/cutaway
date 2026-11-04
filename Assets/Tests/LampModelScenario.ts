import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {buildLampModel, reportLampModel} from "./LampTestUtils"

/**
 * Helper (not a done-criterion test): builds the lamp model at scale 1 beside the real lamp and
 * leaves it there for the checkpoint captures (lamp-hero.md, Phase A).
 * Parameters (all optional): `dx`, `dz` = offset from the real lamp's footprint centre (world cm,
 * default 40, 45); `interior` "1" shows the interior parts; `hide` = comma-separated part names;
 * `at` = "x,y,z" puts the footprint centre at that world point instead, at `scale` (default 1)
 * and `yaw` (degrees).
 */
@component
export class LampModelScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const str = (k: string) => (config ? ((config.get(k) as string) ?? "") : "").trim()
    const num = (k: string, d: number) => (str(k) !== "" && isFinite(Number(str(k))) ? Number(str(k)) : d)
    await sleep(800)
    const at = str("at")
      .split(",")
      .map((s) => Number(s.trim()))
    const place = at.length === 3 && at.every((v) => isFinite(v)) ? {at: new vec3(at[0], at[1], at[2]), scale: num("scale", 1), yawDeg: num("yaw", 0)} : undefined
    const m = buildLampModel(new vec3(num("dx", 40), 0, num("dz", 45)), place)
    m.setInteriorVisible(str("interior") === "1")
    for (const name of str("hide")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      const so = findSceneObjectByName(name)
      if (so) so.enabled = false
      else print(`lamp-model: no part named ${name}`)
    }
    await sleep(200)
    reportLampModel(m)
  }
}
