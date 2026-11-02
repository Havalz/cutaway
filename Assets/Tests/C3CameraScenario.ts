import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, expectOrder, getMain, isEnabled, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 3 (camera): turning the head from the record player to the camera brings up
 * the camera chip; its guaranteed question plays the light path through the lens to the sensor:
 * ghost shell + x-ray window, the subject's rays entering the lens and crossing, the mirror
 * flipping up (with a click from the camera body), the image landing upside down on the sensor,
 * then the sensor's pixels lighting up.
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

    // Beat 1: ghost shell and the x-ray window with the lens, mirror and sensor.
    await waitForPhase(main, "shell", 2000)
    await waitForPhase(main, "cutaway", 2000)
    await sleep(600)
    expect(isEnabled("GhostShell")).toBe(true)
    expect(isEnabled("XrayWindow")).toBe(true)
    for (const part of ["Lens", "Mirror", "Sensor"]) expect(isEnabled(part)).toBe(true)

    // Beat 2: the subject and its rays into the lens. Beat 3: they bend and cross.
    await waitForPhase(main, "beat2", 4000)
    await waitForPhase(main, "rays", 1500)
    expect(isEnabled("SubjectArrow")).toBe(true)
    expect(findSceneObjectByName("Ray0") !== undefined).toBe(true)
    await waitForPhase(main, "bend", 5000)

    // Beat 4: the mirror flips up with a click from the camera body; the image lands on the sensor.
    const mirror = findSceneObjectByName("Mirror")
    const down = mirror.getTransform().getLocalRotation()
    await waitForPhase(main, "mirror", 5000)
    await waitForPhase(main, "click", 200)
    const clickSo = findSceneObjectByName("CameraClick")
    const click = clickSo.getComponent("Component.AudioComponent") as AudioComponent
    expect(click.isPlaying()).toBe(true)
    expect(click.spatialAudio.enabled).toBe(true)
    const camBody = main.getMarkerPosition("camera")
    expect(clickSo.getTransform().getWorldPosition().distance(camBody) < 15).toBe(true)
    await waitForPhase(main, "sensor", 1500)
    await sleep(300)
    const flipped = mirror.getTransform().getLocalRotation()
    expect(Math.abs(down.dot(flipped)) < 0.99).toBe(true)
    expect(isEnabled("SensorImage")).toBe(true)

    // Beat 5: the pixels it lands on light up.
    await waitForPhase(main, "pixels", 5000)
    expectOrder(main, ["start:camera:q0", "shell", "cutaway", "arrow", "rays", "bend", "mirror", "click", "sensor", "pixels"])

    await press("CameraStop")
    await sleep(500)
    expect(main.isRunning()).toBe(false)
    main.setGazeOverride(null)
  }
}
