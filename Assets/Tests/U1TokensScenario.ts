import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {ALPHA, GLASS, INK} from "../Scripts/CutawayStyle"
import {cleanStart, getMain, SETTLE_MS} from "./CutawayTestUtils"

const near = (a: number, b: number, tol: number = 0.01) => Math.abs(a - b) <= tol

/**
 * Polish U1: the tokens as they land on screen. The grep half of U1 (no hard-coded colour in any
 * UI file) is devpost/tools/check-ui-tokens.sh; this checks that the pills really use the tokens.
 */
@component
export class U1TokensScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    expect(near(INK.x, 0xff / 255) && near(INK.y, 0xf4 / 255) && near(INK.z, 0xe6 / 255)).toBe(true)
    expect(near(ALPHA.text, 0.92) && near(ALPHA.secondary, 0.55) && near(ALPHA.hairline, 0.22) && near(ALPHA.disabled, 0.35)).toBe(true)
    expect(near(GLASS.fill, 0.07) && near(GLASS.rim, 0.3) && near(GLASS.highlight, 0.45)).toBe(true)

    main.lookAt("camera")
    await sleep(SETTLE_MS + 300)
    const chip = findSceneObjectByName("CameraChip")
    let label: Text | null = null
    for (let i = 0; i < chip.getChildrenCount(); i++) if (chip.getChild(i).name === "ButtonLabel") label = chip.getChild(i).getComponent("Component.Text") as Text
    if (!label) throw new Error("chip has no label")
    const c = label.textFill.color
    if (!near(c.x, INK.x) || !near(c.y, INK.y) || !near(c.z, INK.z) || !near(c.w, ALPHA.text, 0.02)) throw new Error(`chip text is (${c.x}, ${c.y}, ${c.z}, ${c.w}), not ink at 92%`)
    main.setGazeOverride(null)
  }
}
