import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, landHero, soundsSince} from "./HeroTestUtils"

/**
 * H2 (camera hero, take apart): the slider at 1 separates at least 6 named parts along the
 * optical axis, each with its callout label (four words or fewer); each part clicks as it frees
 * itself. Back at 0 every part returns to within 1 mm of rest.
 */
@component
export class H2TakeApartScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)
    const t0 = getTime()
    check(main.getHeroRailVisual().apart, "expected main.getHeroRailVisual().apart")

    // Halfway: some parts are out, the later ones are not yet (the stagger).
    hero.setApart(0.5)
    await sleep(500)
    const half = hero.getParts()
    const sensorHalf = half.find((p) => p.key === "sensor")
    check(sensorHalf.offset < 0.1, "expected sensorHalf.offset < 0.1")
    check(half.find((p) => p.key === "elements").labelShown, "expected half.find((p) => p.key === \"elements\").labelShown")

    // At 1 (the light path starts, the parts stay apart).
    hero.setApart(1)
    await waitForPhase(main, "hero:light", 3000)
    await sleep(400)
    const parts = hero.getParts().filter((p) => p.key !== "lens" && p.key !== "body")
    expect(parts.length).toBe(8)
    const along = parts.filter((p) => Math.abs(p.alongAxis) >= 0.5 && p.labelShown)
    if (along.length < 6) throw new Error(`only ${along.length} parts apart along the axis with labels: ${JSON.stringify(parts.map((p) => [p.key, p.alongAxis.toFixed(2), p.labelShown]))}`)
    for (const p of parts) {
      check(p.labelShown, "expected p.labelShown")
      check(p.label.split(" ").length <= 4, "expected p.label.split(\" \").length <= 4")
    }
    // One soft click per part as it freed itself.
    check(soundsSince(main, "hero_part", t0).length >= 8, "expected soundsSince(main, \"hero_part\", t0).length >= 8")

    // Back to 0: the light path ends and everything returns to rest (within 1 mm).
    hero.setApart(0)
    await waitForPhase(main, "hero:lightOff", 1000)
    await waitUntil(() => hero.getParts().every((p) => p.offset < 0.1), 2000, () => JSON.stringify(hero.getParts().map((p) => [p.key, p.offset.toFixed(3)])))
    await sleep(400)
    for (const p of hero.getParts()) {
      if (p.offset >= 0.1) throw new Error(`${p.key} is ${p.offset.toFixed(3)} cm from rest`)
      check(!(p.labelShown), "expected not p.labelShown")
    }
    expect(hero.state).toBe("landed")
    check(!(hero.isSubjectShown()), "expected not hero.isSubjectShown()")
    const rail = main.getHeroRailVisual()
    check(rail.apart, "expected rail.apart")
    check(!(rail.focus), "expected not rail.focus")
    check(!(rail.photo), "expected not rail.photo")
  }
}
