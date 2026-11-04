import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {freqToPitch} from "../Scripts/CutawayRpSound"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

/**
 * Helper (not a test): drive the record player stage to one beat and freeze it there for the
 * _review/rp_* captures. Beats: rest, needle, playing, loud, pitch_low, pitch_high, hover, apart.
 * The stage stays frozen (setHoldRp) until the next scenario's rpCleanStart.
 */
@component
export class RpCaptureScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const beat = get("beat") || "rest"
    const extra = Number(get("extraMs") || "0")
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    const rail = main.getRpRail()
    const play = async () => {
      await dropNeedle(main, rp)
      await waitForPhase(main, "rp:soundArrived", 6000)
    }
    switch (beat) {
      case "rest":
        await sleep(600)
        break
      case "needle":
        await dropNeedle(main, rp)
        await sleep(450)
        break
      case "playing":
        await play()
        await sleep(1400)
        break
      case "loud":
        await play()
        rail.setValue("loudness", 1)
        await sleep(1400)
        break
      case "pitch_low":
        // Loud enough that the rings read; held when the newest 3.1 m ring is 1–1.6 m out.
        await play()
        rail.setValue("loudness", 0.9)
        rail.setValue("pitch", freqToPitch(110))
        await waitUntil(() => rp.getSoundInfo().rings.length >= 2, 5000)
        await waitUntil(() => rp.getSoundInfo().rings.some((r) => r.radius >= 100 && r.radius <= 160), 5000)
        break
      case "pitch_high":
        await play()
        rail.setValue("loudness", 0.9)
        rail.setValue("pitch", freqToPitch(880))
        await sleep(1600)
        break
      case "hover":
        rail.setValue("apart", 0.002)
        await waitForPhase(main, "rp:hover", 2000)
        await sleep(400)
        break
      case "apart":
        rail.setValue("apart", 1)
        await waitUntil(() => rp.getApartInfo().live, 4000)
        await sleep(900)
        break
      default:
        throw new Error(`unknown beat "${beat}"`)
    }
    if (extra > 0) await sleep(extra)
    main.setHoldRp(true)
    print(`Cutaway RP capture: beat ${beat} held`)
  }
}
