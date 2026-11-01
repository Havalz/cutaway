import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain, isEnabled, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 4: when an explanation finishes everything shrinks into one small dot on the
 * object; pinching that dot reopens the questions; Stop mid-explanation cancels and returns to the dot.
 */
@component
export class C4FinishAndStopScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // --- Finish → one dot ---
    await startGuaranteedQuestion(main, "lamp")
    await waitForPhase(main, "finish", 20000)
    await sleep(120)
    const root = findSceneObjectByName("Effects_Lamp")
    if (root) expect(root.getTransform().getLocalScale().x < 1).toBe(true) // collapsing toward the dot
    await waitForPhase(main, "explained", 2000)
    await sleep(SETTLE_MS)
    expect(main.isRunning()).toBe(false)
    expect(findSceneObjectByName("Effects_Lamp") === undefined).toBe(true)
    expect(main.getStationState("lamp")).toBe("explained")
    let v = main.getStationVisual("lamp")
    expect(v.explainedDot).toBe(true)
    expect(v.idleDot).toBe(false)
    expect(v.chip).toBe(false)
    expect(v.stop).toBe(false)
    expect(v.questions.some((q) => q)).toBe(false)
    expect(isEnabled("LampDot")).toBe(true)
    expect(isEnabled("LampChipPop")).toBe(false)
    expect(isEnabled("LampStopPop")).toBe(false)

    // --- Pinch the dot → questions reopen ---
    await press("LampDot")
    await sleep(SETTLE_MS)
    expect(main.getStationState("lamp")).toBe("questions")
    v = main.getStationVisual("lamp")
    expect(v.questions[0]).toBe(true)
    expect(isEnabled("LampQ0")).toBe(true)

    // --- Stop mid-explanation (already-explained object) → back to its dot ---
    await press("LampQ0")
    expect(main.getStationState("lamp")).toBe("playing")
    await sleep(2500)
    await press("LampStop")
    await sleep(SETTLE_MS)
    expect(main.isRunning()).toBe(false)
    expect(main.getPhaseLog().indexOf("stopped") >= 0).toBe(true)
    expect(main.getStationState("lamp")).toBe("explained")
    expect(isEnabled("LampDot")).toBe(true)
    expect(isEnabled("LampStopPop")).toBe(false)
    expect(findSceneObjectByName("Effects_Lamp") === undefined).toBe(true)

    // --- Stop mid-explanation (new object) → back to its idle dot, chip does not pop right back ---
    await startGuaranteedQuestion(main, "recordPlayer")
    await sleep(3000)
    await press("RecordPlayerStop")
    await sleep(SETTLE_MS)
    expect(main.isRunning()).toBe(false)
    expect(main.getStationState("recordPlayer")).toBe("idle")
    expect(isEnabled("RecordPlayerIdleDot")).toBe(true)
    expect(isEnabled("MagnifyBubble")).toBe(false)
    expect(main.isExplained("recordPlayer")).toBe(false)
    main.setGazeOverride(null)
  }
}
