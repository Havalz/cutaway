import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {boxCorners, meshBoxes} from "../Scripts/CutawayLayout"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {getLamp, lampCleanStart} from "./LampHeroTestUtils"
import {checkGlassFits, checkLabelsClear, checkRailClear, frameOn} from "./LayoutCheckUtils"
import {getRp} from "./RpHeroTestUtils"

const STAYS_DOWN = ["LampCord", "LampWires", "LampSwitch", "LampSwitchButton", "LampPlug"]

/**
 * Helper (not a test): the layout of a copy taken apart from wherever the camera is now. It launches
 * directly, not through the chip, so the camera can be somewhere the chip can't be gazed at or pinched.
 */
@component
export class LayoutCheckScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const station = config ? ((config.get("station") as string) ?? "lamp") : "lamp"
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    if (station === "lamp") {
      ;(main as any).launchLamp()
      await waitForPhase(main, "lamp:landed", 4000)
      await sleep(800)
      const lamp = getLamp(main)
      main.getLampRail().setValue("apart", 1)
      await waitUntil(() => lamp.getApart().live, 8000)
      await sleep(2000)
      const rail = main.getLampRail().getRail()
      const F = frameOn(lamp.getReplica())
      const exploded = lamp
        .getModel()
        .meshList()
        .filter((m) => STAYS_DOWN.indexOf(m.part) < 0 && m.rmv.getSceneObject().isEnabledInHierarchy)
        .map((m) => boxCorners(m.rmv.getSceneObject().getTransform().getWorldTransform(), m.lo, m.hi))
      print(`Cutaway layout, lamp: ${checkRailClear(F, rail, exploded)}; ${checkLabelsClear(F, main.labelsUI, "lamp_", rail)}; ${checkGlassFits(rail, "on", main.labelsUI)}`)
    } else {
      ;(main as any).launchRp()
      await waitForPhase(main, "rp:landed", 4000)
      await sleep(800)
      const rp = getRp(main)
      main.getRpRail().setValue("apart", 1)
      await waitUntil(() => rp.getApartInfo().live, 8000)
      await sleep(2000)
      const rail = main.getRpRail().getRail()
      const F = frameOn(rp.getReplica())
      print(`Cutaway layout, record player: ${checkRailClear(F, rail, meshBoxes(rp.getReplica()))}; ${checkLabelsClear(F, main.labelsUI, "rp_", rail)}; ${checkGlassFits(rail, rail.getLayout(), main.labelsUI)}`)
    }
  }
}
