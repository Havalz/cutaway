import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {meshBoxes} from "../Scripts/CutawayLayout"
import {getMain, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {checkGlassFits, checkLabelsClear, checkRailClear, frameOn} from "./LayoutCheckUtils"
import {landRp, rpCleanStart} from "./RpHeroTestUtils"

/**
 * The record player's rail stands outside the outline of the copy taken apart from before the first
 * part moves; no label overlaps another, the caption, the rail or Reset.
 */
@component
export class R9RpApartLayoutScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    await sleep(800)
    const rpRail = main.getRpRail()
    const rail = rpRail.getRail()
    const before = rail.getPlaced()
    rpRail.setValue("apart", 1)
    await waitUntil(() => rp.getApartInfo().live, 4000)
    await sleep(1500)
    const moved = rail.getPlaced().distance(before)
    check(moved < 1, () => `the rail moved ${moved.toFixed(1)} cm when the copy came apart`)
    const F = frameOn(rp.getReplica())
    const clear = checkRailClear(F, rail, meshBoxes(rp.getReplica()))
    const labels = checkLabelsClear(F, main.labelsUI, "rp_", rail)
    const fits = checkGlassFits(rail, rail.getLayout(), main.labelsUI)
    print(`Cutaway R9: ${clear}; it moved ${moved.toFixed(2)} cm coming apart; ${labels}; ${fits}`)
  }
}
