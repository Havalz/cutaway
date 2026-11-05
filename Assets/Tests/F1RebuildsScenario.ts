import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {getLamp, lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"
import {MeshCounter} from "./PerfTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

const WINDOW_S = 3
/** A ribbon updates at 30 Hz at most: at the 45 fps of the preview, one built each frame fails this. */
const LIMIT = 30 * WINDOW_S * 1.1 + 2

async function window(counter: MeshCounter): Promise<number> {
  counter.reset()
  const t0 = getTime()
  while (getTime() - t0 < WINDOW_S) await sleep(100)
  return getTime() - t0
}

/**
 * Meshes rebuild only when they visibly change: nothing at all with nothing moving, and no mesh more
 * than 30 times a second while the light and sound run. The camera does not move in this test.
 */
@component
export class F1RebuildsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    const counter = new MeshCounter()
    check(counter.on(), "cannot count MeshBuilder calls")
    const out: string[] = []
    const atMost = (state: string, most: number) => {
      const top = counter.mostForOneMesh()
      check(top <= most, () => `${state}: a mesh rebuilt ${top} times in ${WINDOW_S} s (at most ${most.toFixed(0)})`)
      out.push(`${state}: ${counter.updates} rebuilds, ${counter.perMesh.size} meshes, busiest ${top}`)
    }
    try {
      await lampCleanStart(main)
      await landLamp(main)
      await sleep(1500)
      await window(counter)
      atMost("lamp off on the table", 0)
      await pressLampSwitch()
      await waitForPhase(main, "lamp:scatter", 6000)
      await sleep(1500)
      await window(counter)
      atMost("lamp on", LIMIT)
      main.getLampRail().setValue("apart", 1)
      await waitForPhase(main, "lamp:hover", 3000)
      await waitUntil(() => getLamp(main).getApart().live, 3000)
      await sleep(1500)
      await window(counter)
      atMost("lamp on and apart", LIMIT)
      await rpCleanStart(main)
      const rp = await landRp(main)
      await sleep(1500)
      await window(counter)
      atMost("record player stopped", 0)
      await dropNeedle(main, rp)
      await waitForPhase(main, "rp:soundArrived", 6000)
      await sleep(1500)
      await window(counter)
      atMost("record playing", LIMIT)
      await rpCleanStart(main)
      const rp2 = await landRp(main)
      main.getRpRail().setValue("apart", 1)
      await waitUntil(() => rp2.getApartInfo().live, 4000)
      await sleep(1500)
      await window(counter)
      atMost("record player apart", 0)
    } finally {
      counter.off()
    }
    print(`Cutaway F1: ${out.join("; ")}`)
  }
}
