import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getMain, waitForPhase} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {getLamp, lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"

/** The hover's bob moves the whole object: the shade's glow never rebuilds for it. */
@component
export class F2ShadeBobScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    await landLamp(main)
    await sleep(300)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    await sleep(1000)
    const lamp = getLamp(main)
    const shade = (lamp as any).light.g.shadeMesh as {rewrites: number; so: SceneObject}
    const r0 = shade.rewrites
    check(r0 > 0, "the shade's glow was never built")
    // It glows on the table. Once the cord has dropped 4 cm the whole lamp's light has faded (as it always did).
    check(lamp.getLight().shadeGlow > 0.5, () => `the shade glows only ${lamp.getLight().shadeGlow.toFixed(2)} on the table`)
    // Just up, before the first part leaves.
    main.getLampRail().setValue("apart", 0.03)
    await waitForPhase(main, "lamp:hover", 3000)
    await sleep(500)
    const tr = lamp.getReplica().getTransform()
    const paper = lamp.getPart("LampPaper").getTransform()
    const glow = shade.so.getTransform()
    let lo = Infinity
    let hi = -Infinity
    let off = 0
    const offset0 = paper.getWorldPosition().y - tr.getWorldPosition().y
    const glow0 = glow.getWorldPosition().y - tr.getWorldPosition().y
    const t0 = getTime()
    while (getTime() - t0 < 3) {
      const y = tr.getWorldPosition().y
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
      off = Math.max(off, Math.abs(paper.getWorldPosition().y - y - offset0), Math.abs(glow.getWorldPosition().y - y - glow0))
      await sleep(50)
    }
    check(hi - lo > 0.1, () => `the copy bobbed only ${(hi - lo).toFixed(3)} cm`)
    check(off < 1e-3, () => `the shade or its glow moved ${off.toFixed(4)} cm against the copy`)
    check(shade.rewrites === r0, () => `the shade's glow rebuilt ${shade.rewrites - r0} times through the lift and the bob`)
    print(`Cutaway F2: the copy bobbed ${(hi - lo).toFixed(2)} cm over 3 s, the shade's glow rode with it and rebuilt 0 times`)
  }
}
