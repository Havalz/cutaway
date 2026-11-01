import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain, isEnabled, KEYS, PREFIX, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 5: the Reset pill clears all explained dots and all three objects go back to idle
 * (also when pressed in the middle of an explanation).
 */
@component
export class C5ResetScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // Explain the lamp for real so there is an explained dot to clear.
    await startGuaranteedQuestion(main, "lamp")
    await waitForPhase(main, "explained", 22000)
    await sleep(SETTLE_MS)
    expect(main.getStationState("lamp")).toBe("explained")

    // Leave the camera mid-explanation.
    await startGuaranteedQuestion(main, "camera")
    await sleep(2000)
    expect(main.isRunning()).toBe(true)

    // Reset pill (looking down at it — away from every object).
    main.lookAway()
    expect(isEnabled("ResetPill")).toBe(true)
    await press("ResetPill")
    await sleep(SETTLE_MS)

    expect(main.isRunning()).toBe(false)
    for (const key of KEYS) {
      expect(main.getStationState(key)).toBe("idle")
      expect(main.isExplained(key)).toBe(false)
      const v = main.getStationVisual(key)
      expect(v.idleDot).toBe(true)
      expect(v.explainedDot).toBe(false)
      expect(v.chip).toBe(false)
      expect(v.stop).toBe(false)
      expect(isEnabled(PREFIX[key] + "IdleDot")).toBe(true)
      expect(isEnabled(PREFIX[key] + "Dot")).toBe(false)
    }
    main.setGazeOverride(null)
  }
}
