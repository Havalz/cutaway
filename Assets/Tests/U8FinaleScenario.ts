import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {FinaleInfo} from "../Scripts/CutawayFinale"
import {CutawayMain} from "../Scripts/CutawayMain"
import {ENERGY, FINALE, INK, OBJECT_ENERGY} from "../Scripts/CutawayStyle"
import {cleanStart, getMain, KEYS, press, SETTLE_MS, softReset, startGuaranteedQuestion, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, landHero, waitHome} from "./HeroTestUtils"

function finale(main: CutawayMain): FinaleInfo {
  const info = main.getFinaleInfo()
  if (!info) throw new Error("the finale is not set up")
  return info
}

function lastEvent(info: FinaleInfo, event: string): number {
  for (let i = info.log.length - 1; i >= 0; i--) if (info.log[i].event === event) return info.log[i].time
  throw new Error(`no "${event}" in the finale's log: ${info.log.map((e) => e.event).join(", ")}`)
}

function sameColor(a: vec4, b: vec4): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01
}

const WORD_COLORS: {[word: string]: vec4} = {"Sound,": ENERGY.motion, "light,": ENERGY.light, "signal.": ENERGY.signal}
const PLAIN = "Sound, light, signal. You've seen inside all three."

/** Polish U8: it plays once all are explained and nothing is active, not while a copy is out, and Reset re-arms it. */
@component
export class U8FinaleScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    check(finale(main).plays === 0, () => "it played before anything was found")

    // For real: one explanation after another. It holds off until the third.
    for (let i = 0; i < KEYS.length; i++) {
      await startGuaranteedQuestion(main, KEYS[i])
      check(!finale(main).playing, () => `it played during ${KEYS[i]}'s explanation`)
      await waitForPhase(main, "explained", 40000)
      main.lookAway()
      if (i < KEYS.length - 1) {
        await sleep(FINALE.delayS * 1000 + 500)
        check(!finale(main).playing && finale(main).plays === 0, () => `it played with only ${i + 1} found`)
      }
    }
    await waitUntil(() => finale(main).playing, 2500, () => "it did not start once all three were found")
    check(finale(main).plays === 1, () => `plays: ${finale(main).plays}`)
    const soundsBefore = main.getSoundLog().length

    // Each thread leaves its own object in its own colour.
    let info = finale(main)
    const markers = {recordPlayer: "recordPlayer", camera: "camera", lamp: "lamp"} as const
    for (const thread of info.threads) {
      const key = thread.key as keyof typeof markers
      const off = thread.start.distance(main.getMarkerPosition(markers[key]))
      check(off < 0.01, () => `${key}'s thread starts ${off.toFixed(2)} cm from it`)
      check(sameColor(thread.color, OBJECT_ENERGY[key]), () => `${key}'s thread is ${thread.color}`)
    }

    // They meet in clear view from the default pose.
    await waitUntil(() => finale(main).t >= FINALE.growS + 0.05, 4000)
    info = finale(main)
    const meet = main.getFinaleMeet()
    for (const thread of info.threads) {
      check(thread.reveal === 1, () => `${thread.key} has only reached ${thread.reveal}`)
      check(thread.head.distance(meet) < 0.5, () => `${thread.key}'s head is ${thread.head.distance(meet).toFixed(2)} cm from the meeting point`)
    }
    const cam = WorldCameraFinderProvider.getInstance().getComponent()
    const seen = cam.worldSpaceToScreenSpace(meet)
    check(seen.x > 0.3 && seen.x < 0.7 && seen.y > 0.3 && seen.y < 0.7, () => `the meeting point is at ${seen.x.toFixed(3)}, ${seen.y.toFixed(3)} on screen`)
    print(`Cutaway U8: threads meet at ${seen.x.toFixed(3)}, ${seen.y.toFixed(3)} on screen`)

    // One pulse, with the chord, one note from each object.
    let peak = 0
    await waitUntil(() => {
      peak = Math.max(peak, finale(main).pointLevel)
      return finale(main).t >= FINALE.pulseS + FINALE.pulseLenS + 0.05
    }, 3000)
    check(peak > 0.85, () => `the point only reached ${peak.toFixed(2)}`)
    const sounds = main.getSoundLog().slice(soundsBefore)
    const notes = [
      ["finaleRoot", "recordPlayer"],
      ["finaleThird", "camera"],
      ["finaleFifth", "lamp"]
    ] as const
    for (const [name, key] of notes) {
      const heard = sounds.filter((e) => e.name === name)
      check(heard.length === 1, () => `${name} played ${heard.length} times`)
      check(heard[0].position.distance(main.getMarkerPosition(key)) < 0.01, () => `${name} did not come from the ${key}`)
    }

    // The caption, with its three words in their colours.
    check(main.labelsUI.captionText() === PLAIN, () => `caption: ${main.labelsUI.captionText()}`)
    await sleep(600)
    const shown = main.labelsUI.getCaptionInfo()
    check(!!shown, () => "no caption on screen")
    for (const w of shown.words) {
      const want = WORD_COLORS[w.word] ?? INK
      check(sameColor(w.color, want), () => `"${w.word}" is ${w.color}, wanted ${want}`)
    }
    print(`Cutaway U8: pulse ${peak.toFixed(2)}, chord from all three, caption "${shown.plain}"`)

    // The threads go home, the slots glow once, and it is about 8 s all told.
    await waitUntil(() => !finale(main).playing, 8000, () => `t = ${finale(main).t}`)
    info = finale(main)
    const took = lastEvent(info, "end") - lastEvent(info, "start")
    check(Math.abs(took - FINALE.durationS) < 0.6, () => `it took ${took.toFixed(2)} s`)
    check(main.getTrio().every((s) => s.glows === 1), () => `glows: ${main.getTrio().map((s) => s.glows).join(", ")}`)
    check(main.labelsUI.captionText() === null, () => "the caption outlived the finale")
    print(`Cutaway U8: played once in ${took.toFixed(2)} s; the slots glowed once`)

    // Once: it doesn't come back on its own.
    await sleep(FINALE.delayS * 1000 + 1200)
    check(finale(main).plays === 1 && !finale(main).playing, () => `it played again: ${finale(main).plays}`)

    // Reset re-arms it, but it waits for a copy to be put back.
    await softReset(main)
    await landHero(main)
    main.fillTrioForTest()
    await sleep(FINALE.delayS * 1000 + 1500)
    check(!finale(main).playing && finale(main).plays === 1, () => "it played with a copy out")
    main.lookAway()
    await press("HeroPutBack")
    await waitHome(main)
    await waitUntil(() => finale(main).playing, FINALE.delayS * 1000 + 1500, () => "it did not play after the copy went back")
    check(finale(main).plays === 2, () => `plays: ${finale(main).plays}`)
    print("Cutaway U8: waited for the copy, then played")

    // Starting something makes it give way, and it comes back when things are quiet.
    await sleep(800)
    main.lookAt("recordPlayer")
    await waitUntil(() => !finale(main).playing, 1000, () => "it kept playing over a chip")
    check(main.labelsUI.captionText() === null, () => "its caption stayed")
    main.lookAway()
    await waitUntil(() => finale(main).playing, FINALE.delayS * 1000 + 1500, () => "it did not come back")
    check(finale(main).plays === 3, () => `plays: ${finale(main).plays}`)

    // Reset stops it at once and empties the trio.
    await sleep(800)
    await press("ResetPill")
    await sleep(SETTLE_MS)
    check(!finale(main).playing, () => "Reset did not stop it")
    check(main.getTrio().every((s) => !s.filled), () => "Reset left a slot full")
    await sleep(FINALE.delayS * 1000 + 500)
    check(finale(main).plays === 3, () => `it played on an empty trio: ${finale(main).plays}`)
    print("Cutaway U8: Reset stops and re-arms it")
  }
}
