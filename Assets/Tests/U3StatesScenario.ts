import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {PRESS_RINGS} from "../Scripts/CutawayUiKit"
import {cleanStart, getMain, hoverOver, isEnabled, press, SETTLE_MS} from "./CutawayTestUtils"
import {landHero, toLive} from "./HeroTestUtils"

const scaleOf = (popName: string) => findSceneObjectByName(popName).getTransform().getLocalScale().x

/** Hover raises a control to 1.04 ±0.01 (relative to its resting scale) and lets it go again. */
async function checkHover(name: string, popName: string): Promise<void> {
  const rest = scaleOf(popName)
  const hovering = hoverOver(name, 450)
  await sleep(320)
  const k = scaleOf(popName) / rest
  if (Math.abs(k - 1.04) > 0.01) throw new Error(`${name}: hover scale ${k.toFixed(3)}, want 1.04 ±0.01`)
  await hovering
  await sleep(250)
  const after = scaleOf(popName) / rest
  if (Math.abs(after - 1) > 0.006) throw new Error(`${name}: after hover the scale is ${after.toFixed(3)}, want 1`)
}

/** A press plays exactly one ring, which shows and then goes away within 250 ms or so. */
async function checkPress(name: string): Promise<void> {
  const ring = name + "PressRing"
  const before = PRESS_RINGS[ring] ?? 0
  let seen = false
  let done = false
  const pressing = press(name).then(() => (done = true))
  while (!done) {
    if (isEnabled(ring)) seen = true
    await sleep(16)
  }
  await pressing
  const count = (PRESS_RINGS[ring] ?? 0) - before
  if (count !== 1) throw new Error(`${name}: press spawned ${count} rings, want 1`)
  if (!seen) throw new Error(`${name}: the press ring never showed`)
  if (isEnabled(ring)) throw new Error(`${name}: the press ring did not finish`)
}

/** Polish U3: hovering a pill raises it to 1.04, pressing it spawns one ring. */
@component
export class U3StatesScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    await checkHover("ResetPill", "ResetPop")
    await checkPress("ResetPill")
    await sleep(SETTLE_MS)

    main.lookAt("camera")
    await sleep(SETTLE_MS)
    await checkHover("CameraChip", "CameraChipPop")
    await checkPress("CameraChip")
    await sleep(400)
    expect(main.getStationState("camera")).toBe("questions")
    await checkHover("CameraQ0", "CameraQ0Pop")
    main.setGazeOverride(null)

    // A rail: a primary pill, a secondary pill and a slider knob.
    await cleanStart(main)
    const hero = await landHero(main)
    await checkHover("HeroPutBack", "HeroPutBackPop")
    await toLive(main, hero)
    await sleep(500)
    await checkHover("HeroPhoto", "HeroPhotoPop")
    await checkHover("HeroFocusSlider", "HeroFocusSliderKnob")
    await checkPress("HeroFocusSlider")
  }
}
