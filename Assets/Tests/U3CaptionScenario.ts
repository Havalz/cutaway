import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {ALPHA, ENERGY, keyWord, RAIL} from "../Scripts/CutawayStyle"
import {cleanStart, getMain} from "./CutawayTestUtils"
import {check, landHero, toLive} from "./HeroTestUtils"

const near = (a: number, b: number, e: number) => Math.abs(a - b) <= e

/**
 * Polish step 3: a caption reveals word by word, keeps its key word's colour, waits for the old one
 * to fade, and is one at a time. On the rail it sits in the top slot, left-aligned to the column.
 */
@component
export class U3CaptionScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const labels = main.labelsUI
    const at = main.getCameraPosition().add(new vec3(0, 0, -110))

    // Word by word: partway through, an earlier word is further along than a later one.
    const first = keyWord("One two three *four* five six.", ENERGY.signal)
    labels.setCaption(first, at)
    check(labels.captionText() === "One two three four five six.", () => `caption text "${labels.captionText()}"`)
    await sleep(90)
    let info = labels.getCaptionInfo()
    check(!!info && info.words.length === 6, () => `${info ? info.words.length : 0} words`)
    const a = info.words.map((w) => w.alpha)
    print(`Cutaway U3: reveal at ~90 ms, word alphas ${a.map((x) => x.toFixed(2)).join(" ")}`)
    check(a[0] > a[1] && a[1] >= a[2], () => `words are not staggered: ${a.join(" ")}`)
    check(a[0] < ALPHA.text + 1e-3, "the first word is past its alpha")
    await sleep(500)
    info = labels.getCaptionInfo()
    check(info.phase === "hold", () => `after the reveal the caption is ${info.phase}`)
    for (const w of info.words) {
      check(near(w.alpha, ALPHA.text, 0.01), () => `"${w.word}" settled at ${w.alpha}`)
      check(near(w.y, 0, 0.001), () => `"${w.word}" settled at y ${w.y}`)
    }
    const key = info.words[3]
    check(key.word === "four" && near(key.color.x, ENERGY.signal.x, 0.01) && near(key.color.z, ENERGY.signal.z, 0.01), () => `key word "${key.word}" lost its colour`)
    const ink = info.words[0].color
    check(near(ink.x, 1, 0.01) && ink.z < 0.95, "plain words are not ink")
    const lefts = info.words.map((w) => w.x)
    check(lefts[1] > lefts[0], "words are not laid out left to right")

    // The next caption waits for this one's 220 ms fade. Logically it is the caption straight away.
    labels.setCaption("Next one.", at)
    check(labels.captionText() === "Next one.", "the wanted caption is not reported straight away")
    await sleep(60)
    info = labels.getCaptionInfo()
    check(info.plain === "One two three four five six." && info.phase === "out", () => `60 ms after the swap: "${info.plain}" ${info.phase}`)
    check(info.words[0].alpha < ALPHA.text && info.words[0].alpha > 0, () => `outgoing word alpha ${info.words[0].alpha}`)
    await sleep(320)
    info = labels.getCaptionInfo()
    check(info.plain === "Next one.", () => `after the fade the screen shows "${info.plain}"`)
    check(info.words[0].alpha > 0, "the new caption has not started")

    // Null hides it (logically at once); the screen is empty after the fade.
    labels.setCaption(null)
    check(labels.captionText() === null, "caption still reported after null")
    check(labels.getCaptionQuad() === null, "caption still has a quad after null")
    await sleep(350)
    check(labels.getCaptionInfo() === null, "words still on screen after the fade")

    // Words measure the same as the ruler says for a whole word (no fallback estimates).
    for (const [word, want] of [["Counterweight", 5.343], ["magnet", 2.641], ["Dust cover", 3.842]] as [string, number][]) {
      const got = labels.measure(word).x
      print(`Cutaway U3: "${word}" measures ${got.toFixed(3)} (a whole-word bounding box says ${want})`)
      check(near(got, want, want * 0.04), () => `"${word}" measures ${got.toFixed(3)}, wanted ${want}`)
    }

    // On a rail: left edge on the column, top inside the plate, wrapped to the column.
    const hero = await landHero(main)
    await toLive(main, hero)
    await sleep(900)
    const text = labels.captionText()
    check(text !== null, "no caption on the camera's rail")
    const rail = main.getHeroRail().getRail()
    const q = labels.getCaptionQuad()
    const place = rail.captionPlace()
    const left = place.rotation.invert().multiplyVec3(q[0].sub(place.position)).x / place.scale
    const right = place.rotation.invert().multiplyVec3(q[1].sub(place.position)).x / place.scale
    const top = place.rotation.invert().multiplyVec3(q[3].sub(place.position)).y / place.scale
    const bottom = place.rotation.invert().multiplyVec3(q[0].sub(place.position)).y / place.scale
    print(`Cutaway U3: "${text}" on the rail: x ${left.toFixed(2)}..${right.toFixed(2)} of ${RAIL.column}, y ${bottom.toFixed(2)}..${top.toFixed(2)} of slot ${RAIL.captionSlot}`)
    check(near(left, 0, 0.01) && near(top, 0, 0.01), () => `not at the top left of the slot: ${left}, ${top}`)
    check(right <= RAIL.column + 0.01, () => `wider than the column: ${right}`)
    check(right > 8, () => `implausibly narrow, so the words aren't really being measured: ${right}`)
    check(bottom >= -RAIL.captionSlot, () => `taller than the slot: ${bottom}`)
    check(hero.isOut, "hero gone")
  }
}
