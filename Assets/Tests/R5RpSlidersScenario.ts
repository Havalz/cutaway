import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {freqToPitch, RP_S, RP_SOUND_CM_S, RpSoundInfo} from "../Scripts/CutawayRpSound"
import {RP_SAMPLE_RATE} from "../Scripts/CutawayRpTone"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

/**
 * R5 (record player hero, live sliders). Loudness raises the groove wiggle, the signal's height, the
 * cone's excursion, the rings' brightness and the tone's gain together, in the same frame. At 110,
 * 440 and 880 Hz the rings are spaced 34300 / f cm (±2%) and the tone plays at f (measured from its
 * samples); the groove, the waveform and the cone follow the same f.
 */
@component
export class R5RpSlidersScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await sleep(400)
    const rail = main.getRpRail()
    const tone = main.getRpTone()

    // --- Loudness: everything it drives rises together, in the same frame as the change ---
    const at = async (l: number) => {
      rail.setValue("loudness", l)
      const now = rp.getSoundInfo()
      check(Math.abs(now.signalAmp - l * 2.4) < 1e-6, () => `the signal did not follow loudness ${l} in the same frame (${now.signalAmp})`)
      check(Math.abs(tone.getState().targetGain - now.toneGain) < 1e-6, "the tone was not asked for the new gain in the same frame")
      await sleep(250)
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < 25; i++) {
        const o = rp.getSoundInfo().coneOffset
        lo = Math.min(lo, o)
        hi = Math.max(hi, o)
        await sleep(25)
      }
      return {info: rp.getSoundInfo(), pp: hi - lo, gain: tone.getState().gain, peak: peakOf(tone.getRecent(4096))}
    }
    const q = await at(0.2)
    const L = await at(0.9)
    const pairs: [string, number, number][] = [
      ["groove wiggle", q.info.grooveAmp, L.info.grooveAmp],
      ["signal height", q.info.signalAmp, L.info.signalAmp],
      ["cone excursion", q.info.coneAmp, L.info.coneAmp],
      ["cone travel (measured)", q.pp, L.pp],
      ["ring brightness", q.info.ringBrightness, L.info.ringBrightness],
      ["tone gain", q.info.toneGain, L.info.toneGain],
      ["tone gain (played)", q.gain, L.gain],
      ["tone peak (samples)", q.peak, L.peak]
    ]
    for (const [what, a, b] of pairs) check(b > a * 1.2, () => `${what} did not rise with loudness: ${a.toFixed(4)} → ${b.toFixed(4)}`)
    print(`Cutaway R5: loudness 0.2 → 0.9: ${pairs.map(([w, a, b]) => `${w} ${a.toFixed(3)}→${b.toFixed(3)}`).join(", ")}`)
    rail.setValue("loudness", 0.6)

    // --- Pitch: ring spacing is the real wavelength in air; the tone plays f ---
    for (const f of [110, 440, 880]) {
      rail.setValue("pitch", freqToPitch(f))
      const lam = RP_SOUND_CM_S / f
      const label = labelOf("RpRailPitchPop")
      check(label === `Pitch  ${f} Hz`, () => `the pitch label reads "${label}"`)
      const now = rp.getSoundInfo()
      check(Math.abs(now.toneFreq - f) / f < 1e-3, () => `in the same frame the tone was asked for ${now.toneFreq.toFixed(2)} Hz, not ${f}`)
      // Rings: wait for two at once (at 110 Hz only part of each 1.8 s cycle shows a second ring).
      let s: RpSoundInfo = now
      await waitUntil(
        () => {
          s = rp.getSoundInfo()
          return s.rings.length >= 2
        },
        4000,
        () => `only ${rp.getSoundInfo().rings.length} ring(s) at ${f} Hz`
      )
      const gaps: number[] = []
      for (let i = 1; i < s.rings.length; i++) gaps.push(s.rings[i].radius - s.rings[i - 1].radius)
      for (const g of gaps) check(Math.abs(g - lam) / lam <= 0.02, () => `ring spacing ${g.toFixed(2)} cm at ${f} Hz (λ = ${lam.toFixed(2)})`)
      const sp = main.speakerMarker.getTransform().getWorldPosition()
      for (const r of s.rings) check(r.center.distance(sp) < 0.01, "a ring is not centred on the speaker")
      // The same f everywhere else: groove (v / f · M), waveform, cone rate (f / S).
      check(Math.abs(s.coneHz - f / RP_S) < 1e-6, () => `cone rate ${s.coneHz} Hz, not ${f / RP_S}`)
      // The tone, measured from what was played (after its 20 ms glide).
      await sleep(300)
      const played = measureFreq(tone.getRecent(8192))
      check(Math.abs(played - f) / f <= 0.01, () => `the tone plays ${played.toFixed(2)} Hz, not ${f}`)
      print(`Cutaway R5: ${f} Hz: rings every ${gaps.map((g) => g.toFixed(1)).join(", ")} cm (λ ${lam.toFixed(1)}); tone ${played.toFixed(2)} Hz; groove λ ${s.grooveWavelength.toFixed(2)} cm shown; wave λ ${s.signalWavelength.toFixed(1)} cm; cone ${s.coneHz.toFixed(3)} Hz`)
    }
    const w110 = await waveAt(rail, rp, 110)
    const w880 = await waveAt(rail, rp, 880)
    check(Math.abs(w110.groove / w880.groove - 8) < 0.01, () => `the groove's wavelength did not scale with 1/f: ${w110.groove} vs ${w880.groove}`)
    check(Math.abs(w110.wave / w880.wave - 8) < 0.01, () => `the waveform's wavelength did not scale with 1/f: ${w110.wave} vs ${w880.wave}`)
    rail.setValue("pitch", freqToPitch(440))
    check(!!findSceneObjectByName("RpRing0"), "no ring objects")
  }
}

async function waveAt(rail: {setValue: (k: "pitch", v: number) => void}, rp: {getSoundInfo: () => RpSoundInfo}, f: number): Promise<{groove: number; wave: number}> {
  rail.setValue("pitch", freqToPitch(f))
  const s = rp.getSoundInfo()
  return {groove: s.grooveWavelength, wave: s.signalWavelength}
}

function labelOf(popName: string): string {
  const pop = findSceneObjectByName(popName)
  if (!pop) return ""
  for (let i = 0; i < pop.getChildrenCount(); i++) {
    const c = pop.getChild(i)
    if (c.name === "Label") {
      const t = c.getComponent("Component.Text") as Text
      return t ? t.text : ""
    }
  }
  return ""
}

function peakOf(x: Float32Array): number {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

/** The played frequency from rising zero crossings (with hysteresis against the soft harmonics). */
function measureFreq(x: Float32Array): number {
  const peak = peakOf(x)
  if (peak <= 1e-6) return 0
  const lowArm = -0.3 * peak
  let armed = false
  const cross: number[] = []
  for (let i = 1; i < x.length; i++) {
    if (x[i] < lowArm) armed = true
    if (armed && x[i - 1] < 0 && x[i] >= 0) {
      cross.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]))
      armed = false
    }
  }
  if (cross.length < 3) return 0
  const period = (cross[cross.length - 1] - cross[0]) / (cross.length - 1)
  return RP_SAMPLE_RATE / period
}

