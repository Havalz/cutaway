import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {boxCorners} from "../Scripts/CutawayLayout"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {getLamp, lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"
import {checkGlassFits, checkLabelsClear, checkRailClear, frameOn} from "./LayoutCheckUtils"

const STAYS_DOWN = ["LampCord", "LampWires", "LampSwitch", "LampSwitchButton", "LampPlug"]

/**
 * The lamp's rail stands outside the outline of the copy taken apart from before the first part
 * moves, so it has no need to move; no label overlaps another, the caption, the rail or Reset.
 */
@component
export class L9LampApartLayoutScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    await landLamp(main)
    await sleep(300)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    await sleep(800)
    const lampRail = main.getLampRail()
    const rail = lampRail.getRail()
    const before = rail.getPlaced()
    lampRail.setValue("apart", 1)
    await waitForPhase(main, "lamp:hover", 3000)
    const lamp = getLamp(main)
    await waitUntil(() => lamp.getApart().live, 3000)
    await sleep(1500)
    const moved = rail.getPlaced().distance(before)
    check(moved < 1, () => `the rail moved ${moved.toFixed(1)} cm when the copy came apart`)
    const F = frameOn(lamp.getReplica())
    const exploded = lamp
      .getModel()
      .meshList()
      .filter((m) => STAYS_DOWN.indexOf(m.part) < 0 && m.rmv.getSceneObject().isEnabledInHierarchy)
      .map((m) => boxCorners(m.rmv.getSceneObject().getTransform().getWorldTransform(), m.lo, m.hi))
    const clear = checkRailClear(F, rail, exploded)
    const labels = checkLabelsClear(F, main.labelsUI, "lamp_", rail)
    const fits = checkGlassFits(rail, "on", main.labelsUI)
    print(`Cutaway L9: ${clear}; it moved ${moved.toFixed(2)} cm coming apart; ${labels}; ${fits}`)
  }
}
