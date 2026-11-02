import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {cleanStart, getMain, isEnabled, press, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, getHero, launchViaQuestion, soundsSince, waitHome} from "./HeroTestUtils"

/**
 * H1 (camera hero, launch): pinching "Bring it closer" — from the camera's second question and
 * from the pill under the explained camera — ends within 3 s with the 3x replica at rest above
 * the table marker, its lowest point 10 cm (±2) above the table top, the thread connecting it to
 * the real camera, and the landing sound playing from the table.
 */
@component
export class H1LaunchScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)

    // Entry 1: the camera's second question.
    await launchViaQuestion(main)
    await checkLanded(main)

    // Put it back; the camera is explained and idle, so its "Bring it closer" pill shows.
    await press("HeroPutBack")
    await waitHome(main)
    expect(main.getStationState("camera")).toBe("explained")
    await waitUntil(() => isEnabled("CameraCloser"), 1500, () => "the Bring it closer pill did not show")

    // Entry 2: the pill.
    await press("CameraCloser")
    await checkLanded(main)
    main.setGazeOverride(null)
  }
}

async function checkLanded(main: CutawayMain): Promise<void> {
  const hero = getHero(main)
  await waitForPhase(main, "hero:landed", 4000)
  const times = hero.getTimes()
  const dur = times.landedAt - times.launchedAt
  if (!(dur > 0 && dur <= 3.0)) throw new Error(`landed ${dur.toFixed(2)} s after the pinch (must be ≤ 3 s)`)

  // At rest: the same place a moment later.
  const a = hero.getInfo()
  await sleep(400)
  const info = hero.getInfo()
  expect(info.state).toBe("landed")
  check(info.position.distance(a.position) < 0.05, () => `not at rest: moved ${info.position.distance(a.position).toFixed(3)} cm in 0.4 s`)

  // 3x (±5%), right above the table marker, lowest point 10 cm (±2) above the table top.
  if (Math.abs(info.scale - 3) > 0.15) throw new Error(`scale ${info.scale.toFixed(3)}`)
  const table = main.getTablePosition()
  const flat = new vec3(info.position.x - table.x, 0, info.position.z - table.z).length
  if (flat > 1) throw new Error(`replica is ${flat.toFixed(2)} cm off the table marker`)
  const lift = info.lowestY - info.tableY
  if (Math.abs(lift - 10) > 2) throw new Error(`lowest point ${lift.toFixed(2)} cm above the table`)
  check(info.up.dot(vec3.up()) > 0.999, () => `not upright: up = ${info.up}`)

  // The thread joins it to the real camera; the landing tone came from the table.
  check(info.threadOk, "the thread does not connect the replica to the real camera")
  const land = soundsSince(main, "hero_land", hero.getTimes().launchedAt)
  check(land.length === 1, () => `landing sounds since launch: ${land.length}`)
  if (land[0].position.distance(table) > 5) throw new Error(`landing sound ${land[0].position.distance(table).toFixed(1)} cm from the table`)
}
