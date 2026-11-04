import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getMain, waitForPhase} from "./CutawayTestUtils"
import {check, phaseCount} from "./HeroTestUtils"
import {dropNeedle, fromSpeaker, landRp, rpCleanStart} from "./RpHeroTestUtils"

/**
 * R4 (record player hero, the sound in the room). With the needle on the record, the signal thread
 * runs from the copy's stylus to the real speaker; the ghost cone at the speaker moves; the rings
 * leave the speaker marker; the tone plays from an audio source at the speaker marker. The captions
 * follow the story: shakes → signal → air; the rail shows Loudness and Pitch (in place of Take apart) once it plays.
 */
@component
export class R4RpSoundScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    await dropNeedle(main, rp)

    // The needle rides the groove: the bubble opens at the stylus, the first caption.
    await sleep(400)
    check(!!findSceneObjectByName("RpBubble"), "no bubble at the stylus")
    check(rp.getCaptionStage() === 1, () => `caption stage ${rp.getCaptionStage()} with the needle down`)
    const rv = main.getRpRailVisual()
    // Taking it apart works only with the arm at rest (spec §4), so "Take apart" gives way to the sliders.
    check(rv.loudness && rv.pitch && !rv.apart && rv.putBack, () => `rail while playing: ${JSON.stringify(rv)}`)
    let s = rp.getSoundInfo()
    check(s.phase === "groove" && s.bubbleOpen > 0.99, () => `phase ${s.phase}, bubble ${s.bubbleOpen.toFixed(2)}`)
    check(s.grooveAmp > 0, "no wiggle in the groove")

    // The signal leaves the cartridge, then reaches the real speaker.
    await waitForPhase(main, "rp:signal", 2500)
    check(rp.getCaptionStage() === 2, () => `caption stage ${rp.getCaptionStage()} once the signal runs`)
    s = rp.getSoundInfo()
    check(s.threadStart.distance(rp.stylusWorld()) < 0.5, () => `the thread starts ${s.threadStart.distance(rp.stylusWorld()).toFixed(2)} cm from the stylus`)
    check(fromSpeaker(main, s.threadEnd) < 0.5, () => `the thread ends ${fromSpeaker(main, s.threadEnd).toFixed(2)} cm from the speaker`)
    const travel = s.threadLength / 220 + 1
    await waitForPhase(main, "rp:soundArrived", travel * 1000)
    check(rp.getCaptionStage() === 3, () => `caption stage ${rp.getCaptionStage()} once the sound arrives`)
    s = rp.getSoundInfo()
    check(s.front > 0.999, () => `the signal covered ${(s.front * 100).toFixed(1)}% of the thread`)
    check(!!findSceneObjectByName("RpThread"), "no thread in the scene")

    // At the speaker: the cone moves, the rings leave the marker, the tone plays from there.
    await sleep(600)
    const tone = main.getRpTone()
    const st0 = tone.getState()
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < 30; i++) {
      const o = rp.getSoundInfo().coneOffset
      lo = Math.min(lo, o)
      hi = Math.max(hi, o)
      await sleep(30)
    }
    s = rp.getSoundInfo()
    check(s.coneShown && fromSpeaker(main, s.conePos) < 1.5, () => `cone shown ${s.coneShown}, ${fromSpeaker(main, s.conePos).toFixed(2)} cm from the speaker`)
    check(hi - lo > 0.3, () => `the cone moved only ${(hi - lo).toFixed(3)} cm`)
    check(s.rings.length >= 1, "no rings at the speaker")
    for (const r of s.rings) check(fromSpeaker(main, r.center) < 0.01, () => `a ring is centred ${fromSpeaker(main, r.center).toFixed(3)} cm from the speaker`)
    let ringObjs = 0
    for (let i = 0; i < 14; i++) if (findSceneObjectByName("RpRing" + i)) ringObjs++
    check(ringObjs > 0, "no ring objects in the scene")
    check(tone.isOn, "the tone is not playing")
    check(fromSpeaker(main, tone.position()) < 0.01, () => `the tone plays ${fromSpeaker(main, tone.position()).toFixed(2)} cm from the speaker`)
    const st1 = tone.getState()
    check(st1.gain > 0.01 && st1.targetGain > 0.01, () => `tone gain ${st1.gain.toFixed(3)}`)
    check(st1.samples > st0.samples, "the audio output is not pulling samples")
    check(phaseCount(main, "rp:soundArrived") === 1, "the sound arrived more than once")
    print(`Cutaway R4: thread ${s.threadLength.toFixed(1)} cm to the speaker; cone ${(hi - lo).toFixed(2)} cm p-p; ${s.rings.length} rings; tone ${st1.freq.toFixed(1)} Hz at gain ${st1.gain.toFixed(3)}`)
  }
}
