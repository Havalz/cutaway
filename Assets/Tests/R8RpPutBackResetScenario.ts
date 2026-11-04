import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {RecordPlayerHero} from "../Scripts/CutawayRpHero"
import {getMain, isEnabled, KEYS, press, SETTLE_MS, softReset, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {dropNeedle, expectRpGone, landRp, launchRpViaQuestion, rpCleanStart, waitRpHome} from "./RpHeroTestUtils"

/**
 * R8 (record player hero, put it back and Reset; the same as the camera's H6). "Put it back" first
 * returns the arm to its rest and stops the platter (and gathers the parts), then the copy lifts,
 * flies home, shrinks and melts into the real record player: no copy, thread, rings, bubble, labels,
 * rail or tone remain, and the record player stays explained. Reset from each step (launching,
 * playing, apart, arm in the hand) clears the stage the same way and every object goes back to idle.
 */
@component
export class R8RpPutBackResetScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)

    // Put it back while the record plays, with its sound in the room.
    let rp = await landRp(main)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await sleep(300)
    const before = rp.getReplica().getTransform().getWorldPosition()
    const order = watchOrder(main, rp, before)
    await press("RpRailPutBack")
    await waitForPhase(main, "rp:putBack", 500)
    await waitForPhase(main, "rp:ready", 3000)
    order.stop()
    order.check()
    await waitRpHome(main)
    expectRpGone(main)
    expectExplained(main)
    print(`Cutaway R8: put back while playing: arm on its rest and platter still ${order.readyAfter().toFixed(2)} s after the pinch, then home`)

    // Put it back with the parts apart: they gather first.
    await softReset(main)
    rp = await landRp(main)
    main.getRpRail().setValue("apart", 1)
    await waitUntil(() => rp.getApartInfo().live, 4000)
    await press("RpRailPutBack")
    await waitForPhase(main, "rp:ready", 3000)
    check(rp.getApartInfo().s === 0 && !rp.getApartInfo().interiorShown, "the parts were not together before the flight")
    await waitRpHome(main)
    expectRpGone(main)
    expectExplained(main)

    // Reset while launching.
    await softReset(main)
    await launchRpViaQuestion(main)
    await waitForPhase(main, "rp:flight", 2500)
    await resetAndCheck(main)

    // Reset while it plays.
    await softReset(main)
    rp = await landRp(main)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await resetAndCheck(main)

    // Reset with the parts apart.
    await softReset(main)
    rp = await landRp(main)
    main.getRpRail().setValue("apart", 0.7)
    await waitForPhase(main, "rp:hover", 2000)
    await sleep(600)
    await resetAndCheck(main)

    // Reset with the needle just down (bubble open, signal not yet out).
    await softReset(main)
    rp = await landRp(main)
    await dropNeedle(main, rp)
    await resetAndCheck(main)
    // And the stage can launch again cleanly afterwards.
    await softReset(main)
    rp = await landRp(main)
    expect(rp.state).toBe("landed")
    check(rp.getDeck().atRest && rp.getApartInfo().s === 0, "a fresh copy did not start at rest")
  }
}

function expectExplained(main: CutawayMain): void {
  expect(main.getStationState("recordPlayer")).toBe("explained")
  check(main.isExplained("recordPlayer"), "the record player is not explained after Put it back")
  check(main.getStationVisual("recordPlayer").explainedDot, "the record player has no explained dot")
}

async function resetAndCheck(main: CutawayMain): Promise<void> {
  main.lookAway()
  await sleep(300)
  check(isEnabled("ResetPill"), "the Reset pill is not shown")
  await press("ResetPill")
  await sleep(SETTLE_MS)
  expectRpGone(main)
  for (const key of KEYS) expect(main.getStationState(key)).toBe("idle")
  main.setGazeOverride(null)
}

/**
 * From the pinch until "rp:ready": the copy stays where it is (it does not lift yet) and the tone
 * stops; at "rp:ready" the arm is on its rest and the platter still.
 */
function watchOrder(main: CutawayMain, rp: RecordPlayerHero, at: vec3): {stop: () => void; check: () => void; readyAfter: () => number} {
  const errs: string[] = []
  let on = true
  let t0 = -1
  let tReady = -1
  const loop = async () => {
    while (on) {
      const log = main.getPhaseLog()
      if (t0 < 0 && log.indexOf("rp:putBack") >= 0) t0 = getTime()
      const ready = log.indexOf("rp:ready") >= 0
      if (t0 >= 0 && !ready) {
        const p = rp.getReplica().getTransform().getWorldPosition()
        if (p.distance(at) > 0.01) errs.push(`the copy moved ${p.distance(at).toFixed(2)} cm before the arm and platter were at rest`)
      }
      if (ready && tReady < 0) {
        tReady = getTime()
        const d = rp.getDeck()
        if (!d || !d.atRest || d.omega !== 0) errs.push(`at rp:ready the arm is ${d ? d.mode : "?"} and the platter turns at ${d ? d.rpm.toFixed(2) : "?"} rpm`)
        const tone = main.getRpTone()
        if (tone && tone.isOn) errs.push("the tone still plays as it lifts")
      }
      await sleep(16)
    }
  }
  void loop()
  return {
    stop: () => (on = false),
    check: () => {
      if (errs.length) throw new Error(errs[0])
      const log = main.getPhaseLog()
      const iRest = log.indexOf("rp:armRest")
      const iReady = log.indexOf("rp:ready")
      if (iRest < 0 || iRest > iReady) throw new Error("the arm was not back on its rest before the copy lifted")
    },
    readyAfter: () => tReady - t0
  }
}
