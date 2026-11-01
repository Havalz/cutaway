import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {angleDeg, cleanStart, expectOrder, getMain, isEnabled, press, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 2: pinching the "Record player" chip shows its question; pinching the
 * guaranteed question plays bubble at the needle → line of light to the speaker → cone moves →
 * chime from the speaker. From the start spot (≥3 m away) record player and speaker are both in view.
 */
@component
export class C2RecordPlayerScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // Geometry: from where the user stands both objects fit in one view.
    const cam = main.getCameraPosition()
    const rp = main.getMarkerPosition("recordPlayer")
    const sp = main.getMarkerPosition("speaker")
    const flatDist = new vec3(rp.x - cam.x, 0, rp.z - cam.z).length
    expect(flatDist).toBeGreaterThan(300)
    expect(angleDeg(rp.sub(cam), sp.sub(cam)) < 20).toBe(true)

    await startGuaranteedQuestion(main, "recordPlayer")
    const v = main.getStationVisual("recordPlayer")
    expect(v.chip).toBe(false)
    expect(v.questions[0]).toBe(true)
    expect(v.stop).toBe(true)

    // 1. Magnify bubble opens at the needle.
    await waitForPhase(main, "bubble", 2000)
    await sleep(500)
    expect(isEnabled("MagnifyBubble")).toBe(true)

    // 2. Line of light along the shelf.
    await waitForPhase(main, "line", 7000)
    expect(findSceneObjectByName("LineOfLight") !== undefined).toBe(true)

    // 3. Light reaches the speaker → chime from the speaker + cone moves.
    await waitForPhase(main, "lineArrived", 6000)
    await waitForPhase(main, "chime", 500)
    expectOrder(main, ["bubble", "line", "lineArrived", "chime", "cone"])
    const chimes = main.getChimeLog()
    expect(chimes.length > 0).toBe(true)
    const chimePos = chimes[chimes.length - 1].position
    expect(chimePos.distance(sp) < 15).toBe(true)
    const audioSo = findSceneObjectByName("ChimeSpeaker")
    const audio = audioSo.getComponent("Component.AudioComponent") as AudioComponent
    expect(audio.isPlaying()).toBe(true)
    expect(audio.spatialAudio.enabled).toBe(true)

    await sleep(400)
    const cone = findSceneObjectByName("SpeakerCone")
    expect(cone !== undefined && cone.isEnabledInHierarchy).toBe(true)
    let moved = 0
    let prev = cone.getTransform().getLocalPosition()
    for (let i = 0; i < 6; i++) {
      await sleep(40)
      const p = cone.getTransform().getLocalPosition()
      moved = Math.max(moved, p.distance(prev))
      prev = p
    }
    expect(moved).toBeGreaterThan(0.05)

    // Leave a clean state.
    await press("RecordPlayerStop")
    await sleep(500)
    expect(main.isRunning()).toBe(false)
    main.setGazeOverride(null)
  }
}
