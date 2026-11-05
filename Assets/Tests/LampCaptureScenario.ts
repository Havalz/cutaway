import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {drag, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {getLamp, lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"

/**
 * Helper (not a test): drive the lamp stage to one beat and freeze it there for the _review/lamp_*
 * captures. Beats: rest; on (the real lamp lit too, 1.2 s after it came on); bubble (the bubble open,
 * 1.4 s after the bulb lit); shade_off (the shade lifted 25 cm, held in the hand); hover (up, not yet
 * apart); apart (fully apart with the lamp on: the driver's live detail); apart_off (apart, lamp off). The stage stays frozen (setHoldLamp) until the
 * next scenario's lampCleanStart.
 */
@component
export class LampCaptureScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const beat = get("beat") || "rest"
    const extra = Number(get("extraMs") || "0")
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    await landLamp(main)
    switch (beat) {
      case "rest":
        await sleep(600)
        break
      case "on":
        await sleep(300)
        await pressLampSwitch()
        await waitForPhase(main, "lamp:realOn", 4000)
        await sleep(1200)
        break
      case "shade_off": {
        // The shade lifted the full 25 cm: held mid-drag (the hold keeps the grab, so it stays up).
        await sleep(300)
        await pressLampSwitch()
        await waitForPhase(main, "lamp:scatter", 6000)
        const lamp = getLamp(main)
        void drag("LampTurnGrab", new vec3(0, 1.2, 0), 4000)
        await waitUntil(() => lamp.getShade().lift >= 25 - 1e-3, 3000, () => `the shade is ${lamp.getShade().lift.toFixed(2)} cm up`)
        await sleep(400)
        if (extra > 0) await sleep(extra)
        main.setHoldLamp(true)
        print(`Cutaway lamp capture: beat ${beat} held`)
        return
      }
      case "hover":
        // Up at the hover, the parts not yet apart.
        await sleep(300)
        main.getLampRail().setValue("apart", 0.002)
        await waitForPhase(main, "lamp:hover", 3000)
        await sleep(600)
        break
      case "apart":
      case "apart_off": {
        // Fully apart, its labels settled; "apart" with the lamp on (the driver's live detail).
        await sleep(300)
        const lamp = getLamp(main)
        if (beat === "apart") {
          await pressLampSwitch()
          await waitForPhase(main, "lamp:scatter", 6000)
        }
        main.getLampRail().setValue("apart", 1)
        await waitForPhase(main, "lamp:hover", 3000)
        await waitUntil(() => lamp.getApart().live, 3000)
        await sleep(beat === "apart" ? 1500 : 900)
        break
      }
      case "bubble":
        await sleep(300)
        await pressLampSwitch()
        await waitForPhase(main, "lamp:bulb", 4000)
        await sleep(1400)
        break
      default:
        throw new Error(`unknown beat "${beat}"`)
    }
    if (extra > 0) await sleep(extra)
    main.setHoldLamp(true)
    print(`Cutaway lamp capture: beat ${beat} held`)
  }
}
