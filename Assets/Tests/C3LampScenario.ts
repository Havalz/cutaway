import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, expectOrder, getMain, isEnabled, press, SETTLE_MS, startGuaranteedQuestion, waitForPhase, waitUntil} from "./CutawayTestUtils"

/**
 * Done criterion 3 (lamp): turning to the lamp brings up its chip; its guaranteed question plays
 * the light path of the LED lamp: ghost shell + x-ray window on the bulb and the cord's path,
 * cyan energy pulses up the cord, the magnify bubble at the LED chip (cyan in, light out, with a
 * power-up tone from the lamp), then rays scattering in the paper into a glow over the column.
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

    // Beat 1: ghost shell, the x-ray window with the bulb, and the cord's path.
    await waitForPhase(main, "shell", 2000)
    await waitForPhase(main, "cutaway", 2000)
    await sleep(1400)
    for (const part of ["GhostShell", "XrayWindow", "Bulb"]) expect(isEnabled(part)).toBe(true)
    expect(findSceneObjectByName("Cord") !== undefined).toBe(true)

    // Beat 2: energy pulses travel up the cord.
    await waitForPhase(main, "cord", 4000)
    await waitForPhase(main, "flow", 1000)
    await sleep(600)
    const pulse = findSceneObjectByName("Current0")
    expect(pulse !== undefined).toBe(true)
    await waitUntil(() => pulse.isEnabledInHierarchy, 1500, () => "Current0 never enabled")
    const p0 = pulse.getTransform().getLocalPosition()
    await sleep(200)
    expect(pulse.getTransform().getLocalPosition().distance(p0)).toBeGreaterThan(2)

    // Beat 3: the bubble at the LED chip; the light comes on with the power-up tone from the lamp.
    await waitForPhase(main, "bubble", 5000)
    await waitForPhase(main, "chip", 1000)
    await waitForPhase(main, "light", 1500)
    await waitForPhase(main, "powerUp", 200)
    const toneSo = findSceneObjectByName("LampPowerUp")
    const tone = toneSo.getComponent("Component.AudioComponent") as AudioComponent
    expect(tone.isPlaying()).toBe(true)
    expect(tone.spatialAudio.enabled).toBe(true)
    expect(toneSo.getTransform().getWorldPosition().distance(main.getMarkerPosition("lamp")) < 20).toBe(true)
    expect(isEnabled("ChipBubble")).toBe(true)

    // Beat 4: rays hit the paper and scatter into a glow over the column.
    await waitForPhase(main, "rays", 5000)
    expect(findSceneObjectByName("LightRay0") !== undefined).toBe(true)
    await waitForPhase(main, "glow", 1500)
    expect(isEnabled("ColumnGlow")).toBe(true)
    expectOrder(main, ["start:lamp:q0", "shell", "cutaway", "cord", "flow", "bubble", "chip", "light", "powerUp", "rays", "glow"])

    await press("LampStop")
    await sleep(500)
    expect(main.isRunning()).toBe(false)
    main.setGazeOverride(null)
  }
}
