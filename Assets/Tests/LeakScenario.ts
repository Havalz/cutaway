import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {cleanStart, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {getHero, landHero, toLive, waitHome} from "./HeroTestUtils"
import {getLamp, lampCleanStart, landLamp, pressLampSwitch, waitLampHome} from "./LampHeroTestUtils"
import {CloneCounter, countScene, countsDiff, countsLine, FrameLogger, perfLine} from "./PerfTestUtils"
import {dropNeedle, getRp, landRp, rpCleanStart, waitRpHome} from "./RpHeroTestUtils"

/** One cycle: launch → apart → put back (the record plays and the lamp is on along the way). */
export async function cycle(main: CutawayMain, station: string): Promise<void> {
  if (station === "lamp") {
    await lampCleanStart(main)
    await landLamp(main)
    await sleep(300)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    const lamp = getLamp(main)
    main.getLampRail().setValue("apart", 1)
    await waitForPhase(main, "lamp:hover", 3000)
    await waitUntil(() => lamp.getApart().live, 3000)
    await sleep(600)
    lamp.putBack()
    await waitLampHome(main)
    return
  }
  if (station === "recordPlayer") {
    await rpCleanStart(main)
    const rp = await landRp(main)
    main.getRpRail().setValue("apart", 1)
    await waitUntil(() => rp.getApartInfo().live, 4000)
    await sleep(600)
    main.getRpRail().setValue("apart", 0)
    await waitUntil(() => rp.getInfo().pose === "rest", 5000, () => `pose ${rp.getInfo().pose}`)
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await sleep(600)
    getRp(main).putBack()
    await waitRpHome(main)
    return
  }
  await cleanStart(main)
  const hero = await landHero(main)
  await toLive(main, hero)
  await sleep(600)
  getHero(main).putBack()
  await waitHome(main)
}

/**
 * Helper (not a test): the leak check. Counts scene objects, visuals and the materials they draw with
 * around `cycles` cycles of one object, and the frame time at idle before and after. Prints a line per
 * cycle and what grew by name.
 */
@component
export class LeakScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const station = get("station") || "lamp"
    const cycles = Number(get("cycles") || "5")
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    await sleep(6000)
    const clones = new CloneCounter()
    const counting = clones.on()
    const start = countScene()
    print(`LEAK|counting clones: ${counting}`)
    print(countsLine(`${station}|start`, start, clones.made))
    const log = new FrameLogger(this, main)
    print(perfLine(`idle before ${station} cycles`, "none", await log.measure(3)))
    let last = start
    for (let i = 1; i <= cycles; i++) {
      await cycle(main, station)
      // Right after the put back (the last fades over), and again after Reset: both are the start.
      await sleep(1000)
      const back = countScene()
      print(countsLine(`${station}|cycle ${i} put back`, back, clones.made))
      const bd = countsDiff(start, back)
      if (bd) print(`LEAK|${station}|cycle ${i} put back vs start: ${bd}`)
      await cleanStart(main)
      await sleep(800)
      const c = countScene()
      print(countsLine(`${station}|cycle ${i}`, c, clones.made))
      const d = countsDiff(last, c)
      if (d) print(`LEAK|${station}|cycle ${i} changed: ${d}`)
      last = c
    }
    const end = countScene()
    print(`LEAK|${station}|total change: objects ${end.objects - start.objects}, visuals ${end.visuals - start.visuals}, materials ${end.materials - start.materials}`)
    const dd = countsDiff(start, end)
    if (dd) print(`LEAK|${station}|by name: ${dd}`)
    await sleep(6000)
    print(perfLine(`idle after ${station} cycles`, "none", await log.measure(3)))
    log.dispose()
    clones.off()
    print(`LEAK|done|${station}`)
  }
}
