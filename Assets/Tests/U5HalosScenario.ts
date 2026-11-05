import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HALO} from "../Scripts/CutawayStyle"
import {CutawayMain, StationKey} from "../Scripts/CutawayMain"
import {cleanStart, getMain, KEYS, softReset, startGuaranteedQuestion, waitUntil} from "./CutawayTestUtils"
import {check, landHero} from "./HeroTestUtils"
import {landLamp, lampCleanStart} from "./LampHeroTestUtils"
import {landRp, rpCleanStart, waitRpHome} from "./RpHeroTestUtils"

const near = (a: number, b: number, e: number) => Math.abs(a - b) <= e

function enabled(main: CutawayMain): string[] {
  return main.getHaloInfo().enabled
}

/** Gaze brings up only that object's halo within 0.3 s, at 35%, with one glint. */
async function gazeAt(main: CutawayMain, key: StationKey): Promise<void> {
  const before = main.getHaloInfo().glints[key]
  const t0 = getTime()
  main.lookAt(key)
  await waitUntil(() => enabled(main).indexOf(key) >= 0, 600, () => `${key}'s halo did not come on`)
  const took = getTime() - t0
  check(took <= 0.3, () => `${key}'s halo took ${took.toFixed(3)} s to enable`)
  check(enabled(main).length === 1, () => `halos on: ${enabled(main).join(", ")}`)
  await sleep(350)
  const info = main.getHaloInfo()
  check(near(info.level, HALO.rim, 0.02), () => `${key}'s rim is at ${info.level}, wanted ${HALO.rim}`)
  check(near(info.ring, HALO.contact, 0.01), () => `${key}'s ring is at ${info.ring}, wanted ${HALO.contact}`)
  check(info.glints[key] === before + 1, () => `${key} glinted ${info.glints[key] - before} times`)
  await sleep(250)
  check(!main.getHaloInfo().glinting, () => `${key}'s glint is still running after 600 ms`)
  print(`Cutaway U5: ${key} halo on in ${took.toFixed(3)} s, rim ${info.level.toFixed(2)}, ring ${info.ring.toFixed(2)}, ${info.tris[key]} triangles`)
}

async function lookAwayCheck(main: CutawayMain, key: string): Promise<void> {
  const t0 = getTime()
  main.lookAway()
  await waitUntil(() => enabled(main).length === 0, 800, () => `${key}'s halo stayed on`)
  const took = getTime() - t0
  check(took <= 0.4, () => `${key}'s halo took ${took.toFixed(3)} s to disable`)
  print(`Cutaway U5: ${key} halo off in ${took.toFixed(3)} s`)
}

/** Copy out: the real object's halo, faint, as the origin. */
function checkOrigin(main: CutawayMain, key: string): void {
  const info = main.getHaloInfo()
  check(info.enabled.length === 1 && info.enabled[0] === key, () => `with its copy out, halos on: ${info.enabled.join(", ")}`)
  check(near(info.level, HALO.origin, 0.02), () => `${key}'s origin halo is at ${info.level}`)
  print(`Cutaway U5: ${key} copy out, origin halo at ${info.level.toFixed(3)}`)
}

/** Polish U5: gaze, one at a time, look away, dim during an explanation, origin, and explained objects. */
@component
export class U5HalosScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    check(enabled(main).length === 0, () => `halos on at rest: ${enabled(main).join(", ")}`)

    for (const key of KEYS) {
      await gazeAt(main, key)
      await lookAwayCheck(main, key)
      await sleep(300)
    }

    // Switching straight from one to another: never two at once.
    main.lookAt("recordPlayer")
    await sleep(500)
    main.lookAt("lamp")
    let most = 0
    let sawLamp = 0
    const t0 = getTime()
    while (getTime() - t0 < 0.8) {
      const on = enabled(main)
      most = Math.max(most, on.length)
      if (!sawLamp && on.indexOf("lamp") >= 0) sawLamp = getTime() - t0
      await sleep(16)
    }
    check(most <= 1, () => `${most} halos on at once`)
    check(sawLamp > 0 && sawLamp <= 0.3, () => `the second halo took ${sawLamp.toFixed(3)} s`)
    print(`Cutaway U5: switched halos, second on after ${sawLamp.toFixed(3)} s, never more than ${most}`)
    await lookAwayCheck(main, "lamp")

    // Its stage 1 explanation dims it to 15%.
    await softReset(main)
    await startGuaranteedQuestion(main, "recordPlayer")
    main.holdExplanation = true
    await sleep(600)
    let info = main.getHaloInfo()
    check(info.enabled.length === 1 && info.enabled[0] === "recordPlayer", () => `during the explanation, halos on: ${info.enabled.join(", ")}`)
    check(near(info.level, HALO.running, 0.02), () => `during the explanation the rim is at ${info.level}`)
    print(`Cutaway U5: during the explanation, ${info.level.toFixed(3)}`)
    main.holdExplanation = false

    // Copy out: 10%, for each object.
    await cleanStart(main)
    const hero = await landHero(main)
    await sleep(400)
    checkOrigin(main, "camera")
    hero.clear()

    await rpCleanStart(main)
    const rp = await landRp(main)
    await sleep(400)
    checkOrigin(main, "recordPlayer")

    // Put back, it's explained: gaze brings no halo, only its dot.
    rp.putBack()
    await waitRpHome(main)
    await sleep(500)
    check(main.isExplained("recordPlayer"), "the record player is not explained after Put it back")
    check(enabled(main).length === 0, () => `after Put it back, halos on: ${enabled(main).join(", ")}`)
    main.lookAt("recordPlayer")
    await sleep(500)
    check(enabled(main).length === 0, "an explained object has a halo")
    main.lookAway()

    await lampCleanStart(main)
    const lamp = await landLamp(main)
    await sleep(400)
    checkOrigin(main, "lamp")
    lamp.clear()
    await sleep(500)
    check(enabled(main).length === 0, () => `after clearing, halos on: ${enabled(main).join(", ")}`)

    info = main.getHaloInfo()
    print(`Cutaway U5: triangles while visible: camera ${info.tris["camera"]}, record player ${info.tris["recordPlayer"]}, lamp ${info.tris["lamp"]}`)
  }
}
