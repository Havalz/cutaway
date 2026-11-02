import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {angleDeg, cleanStart, expectOrder, getMain, isEnabled, press, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"

/**
 * Done criterion 2: pinching the "Record player" chip shows its question; pinching the
 * guaranteed question plays bubble at the needle → line of light to the speaker → cone moves →
 * warm tone from the speaker. From the start spot (≥3 m away) record player and speaker are both in view.
 * Sound: a tick on each pinch, the scan sweep on the chip, the needle-drop crackle at the stylus.
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

    const s0 = main.getSoundLog().length
    const sounds = (name: string) => main.getSoundLog().slice(s0).filter((s) => s.name === name)
    await startGuaranteedQuestion(main, "recordPlayer")
    const v = main.getStationVisual("recordPlayer")
    expect(v.chip).toBe(false)
    expect(v.questions[0]).toBe(true)
    expect(v.stop).toBe(true)
    // A soft tick on every pinch (chip, question), and the chip pinch plays the scan sweep.
    expect(sounds("tick").length >= 2).toBe(true)
    expect(sounds("scan").length).toBe(1)

    // 1. Magnify bubble opens at the needle (beat 2; beat 1 is the ghost shell, ~3.4 s),
    //    with the needle-drop crackle played from the stylus.
    await waitForPhase(main, "bubble", 5000)
    await sleep(500)
    expect(isEnabled("MagnifyBubble")).toBe(true)
    const crackle = sounds("crackle")
    expect(crackle.length).toBe(1)
    expect(crackle[0].position.distance(main.getMarkerPosition("needle")) < 5).toBe(true)

    // 2. Line of light along the shelf (beat 4, ~6.8 s after the bubble).
    await waitForPhase(main, "line", 9000)
    expect(findSceneObjectByName("LineOfLight") !== undefined).toBe(true)

    // 3. Light reaches the speaker → chime from the speaker + cone moves.
    await waitForPhase(main, "lineArrived", 6000)
    await waitForPhase(main, "chime", 500)
    expectOrder(main, ["bubble", "line", "lineArrived", "chime", "cone"])
    const chimes = main.getChimeLog()
    expect(chimes.length > 0).toBe(true)
    const chimePos = chimes[chimes.length - 1].position
    expect(chimePos.distance(sp) < 15).toBe(true)
    // The warm tone (it replaced the chime) is the speaker's sound.
    expect(sounds("tone").length).toBe(1)
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
