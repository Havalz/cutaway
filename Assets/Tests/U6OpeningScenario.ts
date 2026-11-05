import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {OPENING} from "../Scripts/CutawayStyle"
import {OpeningInfo} from "../Scripts/CutawayOpening"
import {cleanStart, getMain, KEYS, PREFIX, press, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"

function opening(main: CutawayMain): OpeningInfo {
  const info = main.getOpeningInfo()
  if (!info) throw new Error("the opening is not set up")
  return info
}

function reveals(main: CutawayMain): number[] {
  return KEYS.map((k) => main.getStationVisual(k).idleDotReveal)
}

function lastEvent(info: OpeningInfo, event: string): number {
  for (let i = info.log.length - 1; i >= 0; i--) if (info.log[i].event === event) return info.log[i].time
  throw new Error(`no "${event}" in the opening's log: ${info.log.map((e) => e.event).join(", ")}`)
}

/** Polish U6: it plays on start and after Reset, brings the dots up in sequence, and a pinch skips it. */
@component
export class U6OpeningScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()

    // On start, before anything has touched the Lens.
    let info = opening(main)
    check(info.plays === 1, () => `it has played ${info.plays} times since the Lens started`)
    check(info.log[0].event === "start", () => `the first event was ${info.log[0].event}`)
    await waitUntil(() => !opening(main).playing, 10000, () => "the opening never ended")
    check(reveals(main).every((r) => r > 0.99), () => `dots after the opening: ${reveals(main).join(", ")}`)

    // After Reset: masked at once, then the sweep, then the dots one at a time with their ticks.
    await cleanStart(main)
    const soundsBefore = main.getSoundLog().length
    const t0 = getTime()
    main.resetAll()
    info = opening(main)
    check(info.plays === 3, () => `plays after two resets: ${info.plays}`)
    check(info.playing, () => "Reset did not start it")
    await sleep(100)
    check(reveals(main).every((r) => r === 0), () => `dots 100 ms into the sweep: ${reveals(main).join(", ")}`)
    check(KEYS.every((k) => main.getStationVisual(k).idleDot), () => "the dots should stay logically on")
    await sleep(400)
    info = opening(main)
    check(info.sweepLevel > 0.1, () => `sweep level at 500 ms: ${info.sweepLevel}`)
    await waitUntil(() => reveals(main).every((r) => r > 0.9), 4000, () => `dots: ${reveals(main).join(", ")}`)
    await sleep(300)
    info = opening(main)
    check(info.sweepLevel === 0, () => `the sweep is still on after its 1.2 s: ${info.sweepLevel}`)
    const dots = [lastEvent(info, "dot0"), lastEvent(info, "dot1"), lastEvent(info, "dot2")]
    const firstDot = dots[0] - t0
    check(firstDot >= OPENING.sweepS - 0.05 && firstDot < OPENING.sweepS + 0.6, () => `the first dot came at ${firstDot.toFixed(3)} s`)
    for (let i = 1; i < 3; i++) {
      const gap = dots[i] - dots[i - 1]
      check(Math.abs(gap - OPENING.dotGapS) < 0.1, () => `gap ${i}: ${gap.toFixed(3)} s`)
    }
    const ticks = main.getSoundLog().slice(soundsBefore).filter((e) => e.name === "openingTick")
    check(ticks.length === 3, () => `${ticks.length} opening ticks`)
    const order = ["lamp", "recordPlayer", "camera"] as const
    ticks.forEach((tick, i) => {
      const off = tick.position.distance(main.getDotPosition(order[i]))
      check(off < 0.01, () => `tick ${i} is ${off.toFixed(2)} cm from the ${order[i]}'s dot`)
    })
    print(`Cutaway U6: first dot ${firstDot.toFixed(3)} s, gaps ${(dots[1] - dots[0]).toFixed(3)}, ${(dots[2] - dots[1]).toFixed(3)} s`)

    // The caption: low in view, one line of the opening's words, gone after 5 s.
    await waitUntil(() => opening(main).caption !== null, 1500, () => "the caption did not come")
    info = opening(main)
    check(info.caption === OPENING.caption, () => `caption: ${info.caption}`)
    const shown = main.labelsUI.getCaptionInfo()
    check(!!shown && shown.ambient && shown.plain === OPENING.caption, () => `on screen: ${shown ? shown.plain : "nothing"}`)
    check(main.labelsUI.captionText() === null, () => "the opening's line should not count as a story caption")
    const at = info.captionAt
    const head = main.getCameraPosition()
    const below = at ? (Math.atan2(head.y - at.y, Math.sqrt((at.x - head.x) ** 2 + (at.z - head.z) ** 2)) * 180) / Math.PI : 0
    check(below > 10 && below < 17, () => `the caption hangs ${below.toFixed(1)}° below the eye`)
    await waitUntil(() => !opening(main).playing, OPENING.captionS * 1000 + 800, () => "the caption did not fade")
    info = opening(main)
    const held = lastEvent(info, "captionOut") - lastEvent(info, "caption")
    check(Math.abs(held - OPENING.captionS) < 0.3, () => `the caption stayed ${held.toFixed(2)} s`)
    print(`Cutaway U6: caption ${below.toFixed(1)}° below the eye for ${held.toFixed(2)} s`)

    // A pinch in the air, mid-sweep: everything comes up at once, no more ticks.
    main.resetAll()
    await sleep(350)
    const skipsBefore = opening(main).skips
    const before = main.getSoundLog().length
    main.pinchInTheAir()
    info = opening(main)
    check(!info.playing && info.skips === skipsBefore + 1, () => `after a pinch: playing ${info.playing}, skips ${info.skips}`)
    check(info.caption === null, () => "the caption survived the pinch")
    await sleep(400)
    check(reveals(main).every((r) => r > 0.9), () => `dots after a skip: ${reveals(main).join(", ")}`)
    check(opening(main).sweepLevel === 0, () => `the sweep survived the pinch: ${opening(main).sweepLevel}`)
    await sleep(2000)
    check(main.getSoundLog().length === before, () => "a skipped opening still ticked")
    check(main.labelsUI.getCaptionInfo() === null, () => "a skipped opening still captioned")

    // A pinch on a control skips it too, and it never blocks that control.
    main.resetAll()
    // A station re-arms after a frame of looking elsewhere.
    await sleep(100)
    main.lookAt("recordPlayer")
    await waitUntil(() => main.getStationState("recordPlayer") === "chip", 1000, () => "no chip during the opening")
    check(opening(main).caption === null, () => "a chip should end the caption")
    await sleep(350)
    await press(PREFIX.recordPlayer + "Chip")
    check(!opening(main).playing, () => "pinching the chip did not skip the opening")
    check(main.getStationState("recordPlayer") === "questions", () => `the chip went to ${main.getStationState("recordPlayer")}`)

    // The first chip ends the caption once it is up.
    await cleanStart(main)
    await waitUntil(() => opening(main).caption !== null, 3500, () => "the caption did not come")
    main.lookAt("recordPlayer")
    await waitUntil(() => opening(main).caption === null, 600, () => "the chip did not end the caption")
    await sleep(300)
    const gone = main.labelsUI.getCaptionInfo()
    check(!gone || gone.phase === "out", () => `caption after the chip: ${gone ? gone.plain + " " + gone.phase : ""}`)
    print("Cutaway U6: a pinch and a chip both end it")
  }
}
