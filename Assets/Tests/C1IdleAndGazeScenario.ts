import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {angleDeg, CHIP_TEXT, chipLabel, cleanStart, getMain, isEnabled, KEYS, PREFIX, SETTLE_MS} from "./CutawayTestUtils"

/**
 * Done criterion 1: at start each of the three objects shows only a small dot; looking at one
 * grows a chip with its name; looking away shrinks it back to the dot.
 */
@component
export class C1IdleAndGazeScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // Only dots at start.
    for (const key of KEYS) {
      const v = main.getStationVisual(key)
      expect(main.getStationState(key)).toBe("idle")
      expect(v.idleDot).toBe(true)
      expect(v.chip).toBe(false)
      expect(v.explainedDot).toBe(false)
      expect(v.stop).toBe(false)
      expect(v.questions.some((q) => q)).toBe(false)
      expect(isEnabled(PREFIX[key] + "IdleDot")).toBe(true)
      expect(isEnabled(PREFIX[key] + "ChipPop")).toBe(false)
    }

    // Look at each object in turn: its chip grows (with its name), the others stay as dots.
    for (const key of KEYS) {
      main.lookAt(key)
      await sleep(SETTLE_MS)
      expect(main.getStationState(key)).toBe("chip")
      expect(isEnabled(PREFIX[key] + "ChipPop")).toBe(true)
      expect(isEnabled(PREFIX[key] + "IdleDot")).toBe(false)
      expect(chipLabel(key)).toBe(CHIP_TEXT[key])
      for (const other of KEYS) {
        if (other !== key) expect(main.getStationState(other)).toBe("idle")
      }

      // Look away: chip shrinks back into the dot.
      main.lookAway()
      await sleep(SETTLE_MS)
      expect(main.getStationState(key)).toBe("idle")
      expect(isEnabled(PREFIX[key] + "ChipPop")).toBe(false)
      expect(isEnabled(PREFIX[key] + "IdleDot")).toBe(true)
    }

    // Two dots lined up in the gaze: from the sofa the camera sits in front of the record player
    // (under 1° apart). Looking along that line focuses the nearer one, the camera.
    const sofa = new vec3(71.92, 0, 228.56)
    main.setHeadOverride(sofa)
    main.lookAway()
    await sleep(SETTLE_MS)
    const toCam = main.getMarkerPosition("camera").sub(sofa)
    const toRecord = main.getMarkerPosition("recordPlayer").sub(sofa)
    expect(angleDeg(toCam, toRecord) < 4).toBe(true)
    main.lookAt("recordPlayer")
    await sleep(SETTLE_MS)
    expect(main.getStationState("camera")).toBe("chip")
    expect(main.getStationState("recordPlayer")).toBe("idle")
    main.setHeadOverride(null)
    main.lookAway()
    await sleep(SETTLE_MS)
    main.setGazeOverride(null)
  }
}
