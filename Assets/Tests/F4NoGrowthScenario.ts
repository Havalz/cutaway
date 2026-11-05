import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {cycle} from "./LeakScenario"
import {countScene, countsDiff} from "./PerfTestUtils"

/**
 * Nothing piles up: launch, apart and put back leave the scene as they found it, right after the
 * put back and after Reset. Two cycles of each object (helper-leaks runs any number with figures).
 */
@component
export class F4NoGrowthScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    await sleep(6000)
    const start = countScene()
    for (const station of ["lamp", "recordPlayer", "camera"]) {
      for (let i = 1; i <= 2; i++) {
        await cycle(main, station)
        await sleep(1000)
        const back = countScene()
        const d = countsDiff(start, back)
        check(!d, () => `${station}, cycle ${i}, after the put back: ${d}`)
        await cleanStart(main)
        await sleep(800)
        const c = countScene()
        const e = countsDiff(start, c)
        check(!e, () => `${station}, cycle ${i}, after Reset: ${e}`)
      }
    }
    print(`Cutaway F4: ${start.objects} objects, ${start.visuals} visuals, ${start.materials} materials before and after two cycles of each object`)
  }
}
