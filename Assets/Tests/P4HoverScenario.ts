import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, drag, getMain, waitForPhase} from "./CutawayTestUtils"
import {check, checkContact, landHero, waitRest} from "./HeroTestUtils"

/**
 * P4 (camera hero pass 2, hover): with "Take apart" above 0 the replica first rises to hover
 * 12 cm (±1) above the table over a disc of light, then the parts separate; it bobs gently and
 * can still be moved. With the slider back at 0 the parts reassemble, it comes down and rests
 * with the P2 contact accuracy, and the disc fades.
 */
@component
export class P4HoverScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)

    hero.setApart(0.6)
    await sleep(150)
    // Rising first: the parts wait until it hovers.
    check(hero.getApart() < 0.02, () => `parts separating before it hovers (apart ${hero.getApart().toFixed(3)})`)
    await waitForPhase(main, "hero:hover", 1200)
    for (let i = 0; i < 4; i++) {
      await sleep(i === 0 ? 300 : 700)
      checkHover(hero.getInfo(), `hover sample ${i}`)
    }
    check(hero.getApart() > 0.5, () => `parts not apart while hovering (apart ${hero.getApart().toFixed(3)})`)

    // It can be moved while hovering, at the same height.
    const before = hero.getInfo().foot
    await drag("HeroGrab", new vec3(0.6, 0, 0.4), 500)
    await sleep(200)
    const after = hero.getInfo()
    const moved = new vec3(after.foot.x - before.x, 0, after.foot.z - before.z).length
    if (moved < 3) throw new Error(`a drag while hovering moved it only ${moved.toFixed(2)} cm`)
    checkHover(after, "after the hover drag")

    // Back to 0: parts reassemble, then it comes down and rests on the table.
    hero.setApart(0)
    await waitForPhase(main, "hero:descend", 2000)
    check(hero.getParts().every((p) => p.offset < 0.1), "it came down before the parts were back together")
    await waitRest(hero, 1500, "after coming down")
    checkContact(hero, "after the hover")
    await sleep(400)
    check(!hero.getInfo().discShown, "the disc did not fade out")
    checkContact(hero, "0.4 s later")
  }
}

function checkHover(i: {lowestY: number; tableY: number; discShown: boolean; pose: string; footReach: number; tableRadius: number}, what: string): void {
  const h = i.lowestY - i.tableY
  if (Math.abs(h - 12) > 1) throw new Error(`${what}: hovering ${h.toFixed(2)} cm above the table (12 ± 1)`)
  check(i.pose === "hover", () => `${what}: pose ${i.pose}`)
  check(i.discShown, () => `${what}: no disc under it`)
  check(i.footReach <= i.tableRadius + 0.01, () => `${what}: footprint off the table`)
}
