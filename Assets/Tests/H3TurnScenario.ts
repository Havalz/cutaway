import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, drag, getMain} from "./CutawayTestUtils"
import {check, checkContact, landHero, waitRest} from "./HeroTestUtils"

/**
 * H3 (camera hero, turn it): grabbing the replica by its lens only turns it around the vertical
 * axis. Its footprint centre and scale stay the same, it stays upright, and the parts stay
 * assembled. (Pass 2: the body handle slides it across the table, see P3; the lens handle turns.)
 */
@component
export class H3TurnScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)
    const before = hero.getInfo()
    const yaw0 = hero.getYawDeg()

    // Sideways drag: it turns (and settles back onto the table).
    await drag("HeroTurnGrab", new vec3(1.2, 0, 0), 700)
    await waitRest(hero, 800, "after the turn")
    const a = hero.getInfo()
    const yaw1 = hero.getYawDeg()
    if (Math.abs(yaw1 - yaw0) < 3) throw new Error(`a sideways drag turned it only ${(yaw1 - yaw0).toFixed(2)}°`)
    checkSame(before, a)

    // Up, down and toward the user: still only (at most) a turn, never a move, tilt or scale.
    await drag("HeroTurnGrab", new vec3(0, 1.2, 0), 500)
    await waitRest(hero, 800, "after the up drag")
    await drag("HeroTurnGrab", new vec3(0, -0.8, 0.8), 500)
    await waitRest(hero, 800, "after the down drag")
    checkSame(before, hero.getInfo())
    checkContact(hero, "after turning")
    for (const p of hero.getParts()) check(p.offset < 0.1, "expected p.offset < 0.1")
    expect(hero.state).toBe("landed")
  }
}

function checkSame(before: {foot: vec3; scale: number; up: vec3}, after: {foot: vec3; scale: number; up: vec3}): void {
  const moved = new vec3(after.foot.x - before.foot.x, 0, after.foot.z - before.foot.z).length
  if (moved > 0.05) throw new Error(`its footprint centre moved ${moved.toFixed(3)} cm`)
  if (Math.abs(after.scale - before.scale) > 1e-3) throw new Error(`scale changed ${before.scale} → ${after.scale}`)
  if (after.up.dot(vec3.up()) < 0.99996) throw new Error(`it tilted: up = ${after.up}`)
}
