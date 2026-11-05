import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {MAX_SAMPLES_PER_FRAME, rpToneAt, rpToneShape} from "../Scripts/CutawayRpTone"
import {getMain, waitForPhase} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

/** The tone's table sounds the same as the sum it replaced; it reuses one buffer and caps what it queues. */
@component
export class F3ToneTableScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    let worst = 0
    const N = 200000
    for (let i = 0; i < N; i++) {
      const x = (i / N) * 2 * Math.PI
      const e = Math.abs(rpToneAt(x) - rpToneShape(x))
      if (e > worst) worst = e
    }
    check(worst < 1e-4, () => `the table is ${worst.toExponential(2)} off the tone`)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await sleep(500)
    const tone = main.getRpTone()
    const s0 = tone.getState()
    const b0 = tone.getLastBlock()
    check(!!b0, "no samples have gone out")
    let same = true
    const t0 = getTime()
    while (getTime() - t0 < 1) {
      const b = tone.getLastBlock()
      if (b && b.buffer !== b0.buffer) same = false
      check(!b || b.length <= MAX_SAMPLES_PER_FRAME, () => `queued ${b.length} samples in a frame`)
      await sleep(16)
    }
    const s1 = tone.getState()
    check(s1.frames > s0.frames, "the tone stopped sending")
    check(same, "the tone did not keep to one buffer")
    print(`Cutaway F3: table within ${worst.toExponential(2)} of the tone; ${s1.samples - s0.samples} samples in ${s1.frames - s0.frames} frames from one buffer, never more than ${MAX_SAMPLES_PER_FRAME} a frame`)
  }
}
