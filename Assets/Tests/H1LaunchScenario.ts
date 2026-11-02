import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {cleanStart, getMain, isEnabled, press, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, checkContact, footOffCenter, getHero, launchViaQuestion, soundsSince, waitHome} from "./HeroTestUtils"

/**
 * H1 (camera hero, launch): pinching "Bring it closer" — from the camera's second question and
 * from the pill under the explained camera — ends with the 3x replica at rest on the table, the
 * thread connecting it to the real camera, and the landing sound playing from the table.
 * Pass 2 (P2) replaces the old "10 cm above the table" check: within 3.5 s of the pinch it is
 * still, sits on the table top (lowest point within 2 mm, nothing below it), and its footprint
 * centre is within 1 cm of the table centre.
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
  if (!(dur > 0 && dur <= 3.5)) throw new Error(`at rest ${dur.toFixed(2)} s after the pinch (must be ≤ 3.5 s)`)
  checkContact(hero, "landed")

  // Still at rest a moment later.
  const a = hero.getInfo()
  await sleep(400)
  const info = hero.getInfo()
  expect(info.state).toBe("landed")
  check(info.position.distance(a.position) < 0.05, () => `not at rest: moved ${info.position.distance(a.position).toFixed(3)} cm in 0.4 s`)
  checkContact(hero, "0.4 s after landing")

  // 3x (±5%), footprint centre within 1 cm of the table centre, upright.
  if (Math.abs(info.scale - 3) > 0.15) throw new Error(`scale ${info.scale.toFixed(3)}`)
  const off = footOffCenter(hero)
  if (off > 1) throw new Error(`footprint centre is ${off.toFixed(2)} cm from the table centre`)
  check(info.up.dot(vec3.up()) > 0.999, () => `not upright: up = ${info.up}`)

  // The thread joins it to the real camera; the landing tone came from the contact on the table.
  check(info.threadOk, "the thread does not connect the replica to the real camera")
  const land = soundsSince(main, "hero_land", hero.getTimes().launchedAt)
  check(land.length === 1, () => `landing sounds since launch: ${land.length}`)
  const p = land[0].position
  const flat = new vec3(p.x - info.tableCenter.x, 0, p.z - info.tableCenter.z).length
  if (Math.abs(p.y - info.tableY) > 0.5 || flat > 34) throw new Error(`landing sound at ${p}, not on the table top under the replica`)
}
