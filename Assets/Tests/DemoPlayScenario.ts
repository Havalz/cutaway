import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {StationKey} from "../Scripts/CutawayMain"
import {cleanStart, getMain, press, PREFIX, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Helper (not a done-criterion test): drives one object to a moment and returns, so the preview
 * holds it for screenshots / manual review.
 * - `station`: recordPlayer | camera | lamp.
 * - `step`:
 *     ""        start the guaranteed explanation and return at once (or wait for `untilPhase`).
 *     "chip"    look at the object: its dot stretches into the chip.
 *     "scan"    pinch the chip: scan sweep, brackets lock on, the questions fan out.
 *     "1".."5"  play the explanation and hold it frozen inside beat N (phase "beatN"); the next
 *               run or test releases the hold.
 *     "finish"  play it to the end: it folds into the dot, which gets its energy rings.
 * - `untilPhase` (with step ""): return once that phase has started.
 * - `extraMs`: extra wait before returning. For "1".."5" it defaults to 1300 ms into the beat.
 * "chip" and "scan" leave the test gaze override on (the chip needs the object looked at);
 * the next run or test clears it.
 */
@component
export class DemoPlayScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    await sleep(300)
    const main = getMain()
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const key = (get("station") || "recordPlayer") as StationKey
    const step = get("step").trim()
    const extraRaw = get("extraMs")
    const extra = Number(extraRaw || 0)
    await cleanStart(main)

    if (step === "chip" || step === "scan") {
      main.lookAt(key)
      await sleep(SETTLE_MS)
      if (step === "scan") {
        await press(PREFIX[key] + "Chip")
        await sleep(900)
      }
      if (extra > 0) await sleep(extra)
      return
    }

    await startGuaranteedQuestion(main, key)
    main.setGazeOverride(null)

    if (/^[1-5]$/.test(step)) {
      await waitForPhase(main, "beat" + step, 22000)
      await sleep(extraRaw ? extra : 1300)
      // Freeze the explanation here so a screenshot taken a few seconds later still shows this
      // beat. The next run or test (cleanStart) releases it.
      main.holdExplanation = true
      return
    }
    if (step === "finish") {
      await waitForPhase(main, "explained", 25000)
      await sleep(extraRaw ? extra : 450)
      return
    }
    const until = get("untilPhase")
    if (until) {
      await waitForPhase(main, until, 20000)
      if (extra > 0) await sleep(extra)
    }
  }
}
