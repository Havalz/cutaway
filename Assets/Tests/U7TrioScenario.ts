import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {OBJECT_ENERGY, TRIO} from "../Scripts/CutawayStyle"
import {cleanStart, getMain, KEYS, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"

function filled(main: CutawayMain): string {
  return main
    .getTrio()
    .map((s) => (s.filled ? "x" : "."))
    .join("")
}

/** Polish U7: each slot fills in the right colour when its explanation finishes; Reset empties them. */
@component
export class U7TrioScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    check(filled(main) === "...", () => `a clean start shows ${filled(main)}`)

    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i]
      await startGuaranteedQuestion(main, key)
      check(!main.getTrio()[i].filled, () => `${key}'s slot filled when the explanation started`)
      await sleep(1500)
      check(!main.getTrio()[i].filled, () => `${key}'s slot filled during the explanation`)
      await waitForPhase(main, "explained", 40000)
      const slot = main.getTrio()[i]
      check(slot.filled, () => `${key}'s slot did not fill: ${filled(main)}`)
      const want = OBJECT_ENERGY[key]
      const c = slot.color
      check(!!c && c.x === want.x && c.y === want.y && c.z === want.z, () => `${key}'s slot is ${c}, wanted ${want}`)
      check(Math.abs(slot.peak - TRIO.popScale) < 0.001, () => `${key}'s pop peaked at ${slot.peak}`)
      await waitUntil(() => main.getTrio()[i].settledS >= 0, 800, () => `${key}'s pop: ${main.getTrio()[i].scale}`)
      const settled = main.getTrio()[i].settledS
      check(settled <= 0.24, () => `${key}'s pop took ${settled.toFixed(3)} s`)
      const wantFilled = KEYS.map((_, j) => (j <= i ? "x" : ".")).join("")
      check(filled(main) === wantFilled, () => `after ${key}: ${filled(main)}, wanted ${wantFilled}`)
      print(`Cutaway U7: ${key} filled, pop ${slot.peak.toFixed(2)} settled in ${settled.toFixed(3)} s`)
      main.lookAway()
      await sleep(SETTLE_MS)
    }

    main.lookAway()
    await press("ResetPill")
    await sleep(SETTLE_MS)
    check(filled(main) === "...", () => `Reset left ${filled(main)}`)
    print("Cutaway U7: Reset empties all three")
  }
}
