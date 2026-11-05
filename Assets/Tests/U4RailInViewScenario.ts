import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {RailColumn} from "../Scripts/CutawayRail"
import {cleanStart, getMain, waitForPhase} from "./CutawayTestUtils"
import {check, landHero, toLive} from "./HeroTestUtils"
import {lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"
import {dropNeedle, landRp, rpCleanStart} from "./RpHeroTestUtils"

/** The plate's corners, projected: all inside the view. */
function checkInView(rail: RailColumn, what: string): void {
  const cam = WorldCameraFinderProvider.getInstance().getComponent()
  const tr = WorldCameraFinderProvider.getInstance().getTransform()
  const look = tr.forward.uniformScale(-1)
  let x0 = 1
  let x1 = 0
  let y0 = 1
  let y1 = 0
  for (const c of rail.getCorners()) {
    check(c.sub(tr.getWorldPosition()).dot(look) > 0, `${what}: a rail corner is behind the camera`)
    const s = cam.worldSpaceToScreenSpace(c)
    x0 = Math.min(x0, s.x)
    x1 = Math.max(x1, s.x)
    y0 = Math.min(y0, s.y)
    y1 = Math.max(y1, s.y)
  }
  const main = getMain()
  let rx0 = 1
  let rx1 = 0
  let ry0 = 1
  let ry1 = 0
  for (const c of main.getResetClearCorners()) {
    const s = cam.worldSpaceToScreenSpace(c)
    rx0 = Math.min(rx0, s.x)
    rx1 = Math.max(rx1, s.x)
    ry0 = Math.min(ry0, s.y)
    ry1 = Math.max(ry1, s.y)
  }
  check(x1 < rx0 || x0 > rx1 || y1 < ry0 || y0 > ry1, () => `${what}: the rail (x ${x0.toFixed(3)}..${x1.toFixed(3)}, y ${y0.toFixed(3)}..${y1.toFixed(3)}) covers the Reset pill (x ${rx0.toFixed(3)}..${rx1.toFixed(3)}, y ${ry0.toFixed(3)}..${ry1.toFixed(3)})`)
  print(`Cutaway U4: ${what}: rail on screen x ${x0.toFixed(3)}..${x1.toFixed(3)}, y ${y0.toFixed(3)}..${y1.toFixed(3)}`)
  check(x0 > 0.01 && x1 < 0.99 && y0 > 0.01 && y1 < 0.96, () => `${what}: the rail is not fully in view: x ${x0.toFixed(3)}..${x1.toFixed(3)}, y ${y0.toFixed(3)}..${y1.toFixed(3)}`)
}

/** Polish U4: at every hero step, the whole rail is inside the view from the default pose. */
@component
export class U4RailInViewScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()

    await cleanStart(main)
    const hero = await landHero(main)
    const heroRail = main.getHeroRail()
    await sleep(500)
    checkInView(heroRail.getRail(), "camera, take apart")
    await toLive(main, hero)
    await sleep(500)
    checkInView(heroRail.getRail(), "camera, light path")

    await rpCleanStart(main)
    const rp = await landRp(main)
    await sleep(500)
    checkInView(main.getRpRail().getRail(), "record player, at rest")
    await dropNeedle(main, rp)
    await waitForPhase(main, "rp:soundArrived", 6000)
    await sleep(500)
    checkInView(main.getRpRail().getRail(), "record player, playing")

    await lampCleanStart(main)
    await landLamp(main)
    await sleep(500)
    checkInView(main.getLampRail().getRail(), "lamp, off")
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    await sleep(500)
    checkInView(main.getLampRail().getRail(), "lamp, on")
  }
}
