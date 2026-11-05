import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {kelvinToRgb, kelvinToWarmth} from "../Scripts/CutawayLampLight"
import {InstrumentSlider} from "../Scripts/CutawayRail"
import {freqToPitch} from "../Scripts/CutawayRpSound"
import {ENERGY, INK} from "../Scripts/CutawayStyle"
import {cleanStart, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, landHero, toLive} from "./HeroTestUtils"
import {lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"
import {dropNeedle, landRp, rpCleanStart, waitRpRest} from "./RpHeroTestUtils"

const same = (a: vec4, b: vec4) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) < 1e-4

function readout(s: InstrumentSlider, want: string): void {
  check(s.getReadout() === want, () => `the value shows "${s.getReadout()}", not "${want}"`)
}

/** Every tick is lit exactly while its part is free, and the light on screen agrees. */
function checkTicks(s: InstrumentSlider, what: string): number {
  const ticks = s.getTicks()
  let lit = 0
  ticks.forEach((t, i) => {
    check(s.tickShows(i) === t.freed, () => `${what}: tick ${i} shows ${s.tickShows(i)} but its part is ${t.freed ? "free" : "home"}`)
    if (t.freed) lit++
  })
  return lit
}

/**
 * Polish U2: each slider shows its live value with units; its fill matches its energy; the Warmth
 * track at 2700, 4000 and 6500 K matches the lamp formula within 2% per channel; the Take apart
 * ticks light in step with the parts.
 */
@component
export class U2SlidersScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()

    // ---- Camera: Take apart in ink, Focus in warm white, "L 22.4 cm". ----
    await cleanStart(main)
    const hero = await landHero(main)
    const rail = main.getHeroRail()
    const apart = rail.getApartSlider()
    check(same(apart.fillColor, INK), "the camera's Take apart fill is not ink")
    await sleep(300)
    check(apart.getTicks().length >= 8, () => `the camera's Take apart has only ${apart.getTicks().length} ticks`)
    check(checkTicks(apart, "camera at rest") === 0, "ticks are lit with the camera whole")
    hero.setApart(0.45)
    await waitUntil(() => apart.getTicks().some((t) => t.freed), 4000, () => "no tick lit at Take apart 45%")
    await sleep(600)
    const mid = checkTicks(apart, "camera half apart")
    check(mid > 0 && mid < apart.getTicks().length, () => `half apart, ${mid} of ${apart.getTicks().length} ticks are lit`)
    await toLive(main, hero)
    const focus = rail.getFocusSlider()
    check(same(focus.fillColor, ENERGY.light), "Focus's fill is not warm white")
    rail.setFocusValue(0.5)
    await sleep(120)
    readout(focus, "L " + (16 + 12).toFixed(1) + " cm")
    check(checkTicks(apart, "camera apart") === apart.getTicks().length, "not every tick is lit with the camera fully apart")

    // ---- Record player: Loudness and Pitch in amber, percent and Hz. ----
    await rpCleanStart(main)
    const rp = await landRp(main)
    const rpRail = main.getRpRail()
    await sleep(300)
    check(same(rpRail.getSlider("apart").fillColor, INK), "the record player's Take apart fill is not ink")
    check(checkTicks(rpRail.getSlider("apart"), "record player at rest") === 0, "ticks are lit with the record player whole")
    rpRail.setValue("apart", 0.5)
    await waitUntil(() => rpRail.getSlider("apart").getTicks().some((t) => t.freed), 3000, () => "no tick lit at Take apart 50%")
    checkTicks(rpRail.getSlider("apart"), "record player half apart")
    rpRail.setValue("apart", 0)
    await waitUntil(() => rpRail.getSlider("apart").getTicks().every((t) => !t.freed), 4000, () => "ticks still lit with the record player back together")
    await waitRpRest(rp, 8000, "after Take apart went back to 0")
    await sleep(300)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    check(same(rpRail.getSlider("loudness").fillColor, ENERGY.motion), "Loudness's fill is not amber")
    check(same(rpRail.getSlider("pitch").fillColor, ENERGY.motion), "Pitch's fill is not amber")
    rpRail.setValue("loudness", 0.6)
    rpRail.setValue("pitch", freqToPitch(440))
    await sleep(120)
    readout(rpRail.getSlider("loudness"), "60%")
    readout(rpRail.getSlider("pitch"), "440 Hz")

    // ---- Lamp: Brightness in warm white, Warmth the colour scale. ----
    await lampCleanStart(main)
    await landLamp(main)
    const lampRail = main.getLampRail()
    await sleep(300)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    await sleep(300)
    check(same(lampRail.getSlider("brightness").fillColor, ENERGY.light), "Brightness's fill is not warm white")
    lampRail.setValue("brightness", 0.7)
    await sleep(120)
    readout(lampRail.getSlider("brightness"), "70%")
    const warmth = lampRail.getSlider("warmth")
    for (const K of [2700, 4000, 6500]) {
      const want = kelvinToRgb(K)
      const got = warmth.trackColorAt(kelvinToWarmth(K))
      const err = Math.max(Math.abs(got.x - want.x), Math.abs(got.y - want.y), Math.abs(got.z - want.z))
      check(err <= 0.02, () => `the Warmth track at ${K} K is (${got.x.toFixed(3)}, ${got.y.toFixed(3)}, ${got.z.toFixed(3)}), the formula gives (${want.x.toFixed(3)}, ${want.y.toFixed(3)}, ${want.z.toFixed(3)})`)
      lampRail.setValue("warmth", kelvinToWarmth(K))
      await sleep(80)
      readout(warmth, K + " K")
      print(`Cutaway U2: Warmth track at ${K} K off the formula by ${(err * 100).toFixed(2)}%`)
    }
    const ticks = lampRail.getSlider("apart")
    check(ticks.getTicks().length > 0, "the lamp's Take apart has no ticks")
    check(checkTicks(ticks, "lamp whole") === 0, "ticks are lit with the lamp whole")
    lampRail.setValue("apart", 0.5)
    await waitUntil(() => ticks.getTicks().some((t) => t.freed), 3000, () => "no tick lit at Take apart 50%")
    checkTicks(ticks, "lamp half apart")
  }
}
