import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, expectOrder, getMain, isEnabled, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 3 (lamp): turning to the lamp brings up its chip; its guaranteed question
 * plays current flowing along the cord, then the bulb lights and light streams out.
 */
@component
export class C3LampScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    main.lookAt("camera")
    await sleep(SETTLE_MS)
    expect(main.getStationState("lamp")).toBe("idle")
    await startGuaranteedQuestion(main, "lamp")

    // Current along the cord: beads move along it.
    await waitForPhase(main, "cord", 2000)
    await sleep(1200)
    expect(findSceneObjectByName("Cord") !== undefined).toBe(true)
    const bead = findSceneObjectByName("Current0")
    expect(bead !== undefined && bead.isEnabledInHierarchy).toBe(true)
    const p0 = bead.getTransform().getLocalPosition()
    await sleep(200)
    expect(bead.getTransform().getLocalPosition().distance(p0)).toBeGreaterThan(2)

    // Then the light.
    await waitForPhase(main, "bulb", 7000)
    await sleep(400)
    expect(isEnabled("Bulb")).toBe(true)
    await waitForPhase(main, "rays", 2000)
    expect(findSceneObjectByName("LightRay0") !== undefined).toBe(true)
    expectOrder(main, ["start:lamp:q0", "cord", "flow", "bulb", "rays"])

    await press("LampStop")
    await sleep(500)
    expect(main.isRunning()).toBe(false)
    main.setGazeOverride(null)
  }
}
