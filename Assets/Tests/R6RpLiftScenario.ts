import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {drag, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {armSwingDir, dropNeedle, landRp, measureRpm, PlatterMeter, rpCleanStart} from "./RpHeroTestUtils"

/**
 * R6 (record player hero, lifting the arm). With the record playing and its sound in the room,
 * lifting the arm off the record stops the platter within 2 s and the tone stops; the signal fades
 * and the bubble closes; the arm can be carried back to its rest.
 */
@component
export class R6RpLiftScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await sleep(500)
    const tone = main.getRpTone()
    check(tone.isOn, "the tone is not playing before the lift")
    const meter = new PlatterMeter(this, rp)
    try {
      // Pick the arm up and carry it back to its rest.
      const deck = rp.getDeck()
      let tLift = -1
      const away = armSwingDir(rp, false)
      const watch = (async () => {
        while (tLift < 0) {
          if (main.getPhaseLog().indexOf("rp:lift") >= 0) tLift = getTime()
          await sleep(10)
        }
      })()
      await drag("RpArmGrab", away.uniformScale(0.5), 1100)
      await watch
      check(deck.mode !== "playing", "the arm is still playing after the lift")
      // Within 2 s of the lift: the platter is still, no tone, signal and bubble gone.
      await waitUntil(() => deck.omega === 0, Math.max(0, 2000 - (getTime() - tLift) * 1000) + 50, () => `the platter still turns at ${deck.rpm.toFixed(2)} rpm ${(getTime() - tLift).toFixed(2)} s after the lift`)
      const tStill = getTime() - tLift
      check(tStill <= 2.0, () => `the platter stopped ${tStill.toFixed(2)} s after the lift`)
      const rpm = await measureRpm(meter, 300)
      check(rpm < 1e-3, () => `the platter's transform still turns at ${rpm.toFixed(4)} rpm`)
      check(!tone.isOn, "the tone still plays")
      check(tone.getState().targetGain === 0, "the tone is still asked for")
      const s = rp.getSoundInfo()
      check(s.phase === "off", () => `sound phase ${s.phase}`)
      for (const n of ["RpSound", "RpBubble", "RpThread", "RpCone"]) check(!findSceneObjectByName(n), `${n} is still in the scene`)
      await waitUntil(() => deck.atRest, 1500, () => `the arm is not back on its rest (${deck.mode})`)
      check(rp.getCaptionStage() === 0, () => `caption stage ${rp.getCaptionStage()} after the lift`)
      const rv = main.getRpRailVisual()
      check(!rv.loudness && !rv.pitch && rv.apart && rv.putBack, () => `rail after the lift: ${JSON.stringify(rv)}`)
      print(`Cutaway R6: platter still ${tStill.toFixed(2)} s after the lift; tone off; arm on its rest`)
    } finally {
      meter.stop()
    }
  }
}
