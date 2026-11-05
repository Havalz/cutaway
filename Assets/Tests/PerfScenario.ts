import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {cleanStart, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {landHero, toLive} from "./HeroTestUtils"
import {getLamp, lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"
import {FrameLogger, MeshCounter, perfLine, switchesFor} from "./PerfTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

/** Drive the Lens to one of the measured states. */
async function drive(main: CutawayMain, state: string): Promise<void> {
  main.setHoldLamp(false)
  main.setHoldRp(false)
  switch (state) {
    case "idle":
      await cleanStart(main)
      // The opening runs once after a reset: past it.
      await sleep(6000)
      return
    case "camera_apart": {
      await cleanStart(main)
      const hero = await landHero(main)
      await toLive(main, hero)
      await sleep(1000)
      return
    }
    case "rp_playing": {
      await rpCleanStart(main)
      const rp = await landRp(main)
      await dropNeedle(main, rp)
      await waitForPhase(main, "rp:soundArrived", 6000)
      await sleep(2000)
      return
    }
    case "rp_apart": {
      await rpCleanStart(main)
      const rp = await landRp(main)
      main.getRpRail().setValue("apart", 1)
      await waitUntil(() => rp.getApartInfo().live, 4000)
      await sleep(1500)
      return
    }
    case "lamp_on": {
      await lampCleanStart(main)
      await landLamp(main)
      await sleep(300)
      await pressLampSwitch()
      await waitForPhase(main, "lamp:scatter", 6000)
      await sleep(1500)
      return
    }
    case "lamp_on_apart": {
      await lampCleanStart(main)
      await landLamp(main)
      await sleep(300)
      await pressLampSwitch()
      await waitForPhase(main, "lamp:scatter", 6000)
      main.getLampRail().setValue("apart", 1)
      await waitForPhase(main, "lamp:hover", 3000)
      await waitUntil(() => getLamp(main).getApart().live, 3000)
      await sleep(1500)
      return
    }
    default:
      throw new Error(`unknown state "${state}"`)
  }
}

/** How long the ways of rewriting a mesh take, in µs per vertex: printed, nothing else. */
function benchWrites(): void {
  const LAYOUT = [
    {name: "position", components: 3},
    {name: "normal", components: 3, normalized: true},
    {name: "color", components: 4}
  ]
  const N = 2000
  const make = () => {
    const mb = new MeshBuilder(LAYOUT)
    mb.topology = MeshTopology.Triangles
    mb.indexType = MeshIndexType.UInt16
    const d: number[] = []
    for (let i = 0; i < N * 10; i++) d.push(0)
    mb.appendVerticesInterleaved(d)
    const idx: number[] = []
    for (let i = 0; i + 2 < N; i += 3) idx.push(i, i + 1, i + 2)
    mb.appendIndices(idx)
    mb.updateMesh()
    return mb
  }
  const time = (name: string, f: () => void) => {
    const rounds = 40
    const a = getRealTimeNanos()
    for (let r = 0; r < rounds; r++) f()
    const us = (getRealTimeNanos() - a) / 1000 / rounds / N
    print(`PERF|bench|${name}: ${us.toFixed(3)} µs per vertex`)
  }
  const a = make()
  const v: number[] = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0]
  time("setVertexInterleaved (reused array), no updateMesh", () => {
    for (let i = 0; i < N; i++) {
      v[0] = i
      a.setVertexInterleaved(i, v)
    }
  })
  time("setVertexInterleaved + updateMesh", () => {
    for (let i = 0; i < N; i++) {
      v[0] = i
      a.setVertexInterleaved(i, v)
    }
    a.updateMesh()
  })
  const b = make()
  const big: number[] = []
  for (let i = 0; i < N * 10; i++) big.push(0)
  time("erase + append (reused array), no updateMesh", () => {
    for (let i = 0; i < N; i++) big[i * 10] = i
    b.eraseVertices(0, N)
    b.appendVerticesInterleaved(big)
  })
  time("erase + append + updateMesh", () => {
    for (let i = 0; i < N; i++) big[i * 10] = i
    b.eraseVertices(0, N)
    b.appendVerticesInterleaved(big)
    b.updateMesh()
  })
  print(`PERF|bench|after erase + append: ${b.getVerticesCount()} vertices, ${b.getIndicesCount()} indices`)
  const c = make()
  time("updateMesh alone", () => c.updateMesh())
}

/**
 * Helper (not a test): the frame-time logger. Drives one state, then measures it `seconds` long:
 * params state; off = comma-separated switches (each measured between two baselines); count "1"
 * also counts MeshBuilder calls per frame (it costs a little, so keep it apart from the timings);
 * reps = how many baselines when no switches are given.
 */
@component
export class PerfScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const state = get("state") || "idle"
    const seconds = Number(get("seconds") || "3")
    const reps = Number(get("reps") || "1")
    const offs = get("off")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    const counting = get("count") === "1"
    await sleep(1500)
    if (state === "bench") {
      benchWrites()
      print(`PERF|done|bench`)
      return
    }
    const main = getMain()
    await drive(main, state)
    const counter = counting ? new MeshCounter() : null
    if (counter) counter.on()
    const log = new FrameLogger(this, main, counter)
    const stage = state.startsWith("lamp") ? "lamp" : state.startsWith("rp") ? "rp" : null
    print(`PERF|start|${state}|${offs.join(",")}`)
    try {
      for (let i = 0; i < reps; i++) print(perfLine(state, "none", await log.measure(seconds)))
      for (const off of offs) {
        const sw = stage ? switchesFor(main, stage)[off] : null
        if (!sw) {
          print(`PERF|${state}|${off}|unknown switch`)
          continue
        }
        const undo = sw()
        await sleep(400)
        print(perfLine(state, off, await log.measure(seconds)))
        undo()
        await sleep(400)
        print(perfLine(state, "none", await log.measure(seconds)))
      }
    } finally {
      log.dispose()
      if (counter) counter.off()
    }
    print(`PERF|done|${state}`)
  }
}
