import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectsByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HERO_PRINT_NAME, imageDistance} from "../Scripts/CutawayHero"
import {cleanStart, getMain, press, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, landHero, phaseCount, soundsSince, toLive} from "./HeroTestUtils"

/**
 * H5 (camera hero, photo): "Take a photo" plays the shutter, flashes the sensor and shows a print
 * whose blur equals the sensor's blur at that moment — sharp when focused, blurry when not. A new
 * photo replaces the previous print.
 */
@component
export class H5PhotoScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)
    await toLive(main, hero)

    // Sharp.
    hero.setSubjectDistance(50)
    hero.setFocusL(imageDistance(50))
    await sleep(200)
    const sharpC = hero.getOptics().c
    check(sharpC < 0.1, "expected sharpC < 0.1")
    const t0 = getTime()
    await press("HeroPhoto")
    check(soundsSince(main, "hero_shutter", t0).length === 1, () => `shutter sounds for photo 1: ${soundsSince(main, "hero_shutter", t0).length}`)
    await waitUntil(() => hero.isSensorFlashing(), 800, () => "the sensor did not flash")
    await waitForPhase(main, "hero:pixels", 800)
    await waitForPhase(main, "hero:print", 1000)
    await sleep(100)
    const p1 = hero.getPrint()
    check(p1.shown, "expected p1.shown")
    if (Math.abs(p1.blur - sharpC) > 1e-4) throw new Error(`print blur ${p1.blur} vs sensor ${sharpC}`)

    // Blurry: the print comes out blurred the same amount and replaces the first one.
    await waitUntil(() => hero.getShotPhase() < 0, 1500)
    hero.setFocusL(36)
    await sleep(200)
    const blurC = hero.getOptics().c
    check(blurC > 1, "expected blurC > 1")
    const t1 = getTime()
    await press("HeroPhoto")
    check(soundsSince(main, "hero_shutter", t1).length === 1, () => `shutter sounds for photo 2: ${soundsSince(main, "hero_shutter", t1).length}`)
    await waitUntil(() => hero.isSensorFlashing(), 800)
    await waitUntil(() => phaseCount(main, "hero:print") >= 2, 1500)
    await sleep(100)
    const p2 = hero.getPrint()
    check(p2.shown, "expected p2.shown")
    if (Math.abs(p2.blur - blurC) > 1e-4) throw new Error(`print blur ${p2.blur} vs sensor ${blurC}`)
    await sleep(900)
    // Exactly one print, and it is the hero's live print (the replaced one has gone).
    const prints = findSceneObjectsByName(HERO_PRINT_NAME)
    const live = hero.getPrintObject()
    check(prints.length === 1 && live !== null && prints[0].isSame(live), () => `prints named ${HERO_PRINT_NAME}: ${prints.length}; live print ${live ? live.name : "none"}; getPrint ${JSON.stringify(hero.getPrint())}; state ${hero.state}`)
  }
}
