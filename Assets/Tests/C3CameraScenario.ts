import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, expectOrder, getMain, isEnabled, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 3 (camera): turning the head from the record player to the camera brings up
 * the camera chip; its guaranteed question plays the light path through the lens to the sensor.
 */
@component
export class C3CameraScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // Facing the record player the camera stays a dot; turning to it brings up its chip.
    main.lookAt("recordPlayer")
    await sleep(SETTLE_MS)
    expect(main.getStationState("camera")).toBe("idle")
    await startGuaranteedQuestion(main, "camera")
    expect(main.getStationState("recordPlayer")).toBe("idle")

    await waitForPhase(main, "shell", 2000)
    await waitForPhase(main, "cutaway", 2500)
    await sleep(400)
    expect(isEnabled("CutawayShell")).toBe(true)
    expect(findSceneObjectByName("Lens") !== undefined).toBe(true)
    expect(findSceneObjectByName("Sensor") !== undefined).toBe(true)

    await waitForPhase(main, "rays", 4000)
    expect(findSceneObjectByName("Ray0") !== undefined).toBe(true)
    await waitForPhase(main, "sensor", 7000)
    await sleep(300)
    expect(isEnabled("SensorImage")).toBe(true)
    expectOrder(main, ["start:camera:q0", "shell", "cutaway", "rays", "sensor"])

    await press("CameraStop")
    await sleep(500)
    expect(main.isRunning()).toBe(false)
    main.setGazeOverride(null)
  }
}
