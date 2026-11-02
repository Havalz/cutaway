import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HERO_D_MAX, HERO_D_MIN, HERO_H_O, imageDistance} from "../Scripts/CutawayHero"
import {cleanStart, drag, getMain, waitForPhase} from "./CutawayTestUtils"
import {check, landHero} from "./HeroTestUtils"

/**
 * H4 (camera hero, light path): at full separation the subject (a candle, h_o = 6 cm) appears; during the viewfinder
 * beat the mirror sends the rays up, then they reach the sensor. For subject distances 30, 50 and
 * 80 cm, focused at L = d_i the blur c is under 0.1 cm and h_i = h_o × d_i / d_o within 2%;
 * focused at L = d_i + 5 cm, c is above 0.8 cm. Grabbing the subject slides it along the axis,
 * inside its range.
 */
@component
export class H4LightPathScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)

    hero.setApart(1)
    await waitForPhase(main, "hero:light", 3000)
    await sleep(300)
    check(hero.isSubjectShown(), "expected hero.isSubjectShown()")
    const candle = hero.getCandleReport()
    check(candle !== null && Math.abs(candle.tip.sub(candle.base).dot(candle.up) - HERO_H_O) < 0.05, "the subject is not the h_o candle")
    expect(hero.getLightPhase()).toBe("viewfinder")
    check(!(hero.raysReachSensor()), "expected not hero.raysReachSensor()")
    check(!(main.getHeroRailVisual().focus), "expected not main.getHeroRailVisual().focus")

    await waitForPhase(main, "hero:mirrorUp", 4000)
    await waitForPhase(main, "hero:live", 1500)
    await sleep(200)
    expect(hero.getLightPhase()).toBe("live")
    check(hero.raysReachSensor(), "expected hero.raysReachSensor()")
    const rail = main.getHeroRailVisual()
    check(rail.focus, "expected rail.focus")
    check(rail.photo, "expected rail.photo")

    for (const d of [30, 50, 80]) {
      const di = imageDistance(d)
      hero.setSubjectDistance(d)
      hero.setFocusL(di)
      await sleep(150)
      const o = hero.getOptics()
      if (Math.abs(o.d_o - d) > 1e-3 || Math.abs(o.d_i - di) > 1e-3 || Math.abs(o.L - di) > 0.05) throw new Error(`optics not set: ${JSON.stringify(o)}`)
      if (!(o.c < 0.1)) throw new Error(`d_o ${d}: focused at d_i the blur is ${o.c.toFixed(3)} cm`)
      const want = (HERO_H_O * di) / d
      if (Math.abs(o.h_i - want) / want > 0.02) throw new Error(`d_o ${d}: h_i ${o.h_i.toFixed(3)} vs h_o·d_i/d_o ${want.toFixed(3)}`)
      check(o.sharp, "expected o.sharp")

      hero.setFocusL(di + 5)
      await sleep(150)
      const b = hero.getOptics()
      if (!(b.c > 0.8)) throw new Error(`d_o ${d}: focused at d_i + 5 the blur is only ${b.c.toFixed(3)} cm`)
      check(!(b.sharp), "expected not b.sharp")
    }

    // Grab the subject and slide it away from the lens along the axis: d_o grows, within range.
    hero.setSubjectDistance(40)
    await sleep(150)
    const axis = hero.getReplica().getTransform().forward
    await drag("HeroSubject", axis.uniformScale(0.8), 600)
    const after = hero.getOptics().d_o
    if (!(after > 41)) throw new Error(`dragging the subject along the axis left d_o at ${after.toFixed(2)}`)
    check(after >= HERO_D_MIN && after <= HERO_D_MAX, "expected after >= HERO_D_MIN && after <= HERO_D_MAX")
  }
}
