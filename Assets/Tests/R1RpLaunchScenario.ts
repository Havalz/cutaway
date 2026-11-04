import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {getMain, isEnabled, press, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, getHero, launchViaQuestion, soundsSince} from "./HeroTestUtils"
import {checkRpContact, expectRpGone, getRp, launchRpViaQuestion, rpCleanStart, rpFootOffCenter, waitRpHome} from "./RpHeroTestUtils"

/**
 * R1 (record player hero, launch): "Bring it closer", from the record player's second question and
 * from the pill under the explained deck, ends within 3.5 s with the copy at rest on the table: its
 * lowest point within 2 mm of the table top (nothing below it), its footprint centre within 1 cm of
 * the table centre and its whole footprint on the table. The scale is the largest (up to 2x) whose
 * footprint fits the table radius minus 3 cm; the tonearm side faces the user. If the camera's copy
 * is out, the camera goes home first (one copy on the table at a time).
 */
@component
export class R1RpLaunchScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)

    // Entry 1: the record player's second question.
    await launchRpViaQuestion(main)
    await checkLanded(main)

    // Put it back; the deck is explained and idle, so its "Bring it closer" pill shows.
    await press("RpRailPutBack")
    await waitRpHome(main)
    expectRpGone(main)
    expect(main.getStationState("recordPlayer")).toBe("explained")
    await waitUntil(() => isEnabled("RecordPlayerCloser"), 1500, () => "the Bring it closer pill did not show")

    // Entry 2: the pill.
    await press("RecordPlayerCloser")
    await checkLanded(main)

    // One copy at a time: the camera's copy out, then the record player's launch sends it home first.
    await rpCleanStart(main)
    await launchViaQuestion(main)
    await waitForPhase(main, "hero:landed", 4000)
    check(getHero(main).isOut, "the camera's copy is not out")
    await launchRpViaQuestion(main)
    const log = main.getPhaseLog()
    const home = log.indexOf("rp:cameraHome")
    const launch = log.indexOf("rp:launch")
    check(home >= 0 && launch > home, () => `the camera did not go home before the launch: ${JSON.stringify(log)}`)
    check(getHero(main).state === "none" && getHero(main).getReplica() === null, () => `the camera's copy is still out (${getHero(main).state})`)
    await checkLanded(main)
    main.setGazeOverride(null)
  }
}

async function checkLanded(main: CutawayMain): Promise<void> {
  const rp = getRp(main)
  await waitForPhase(main, "rp:landed", 4000)
  const times = rp.getTimes()
  const dur = times.landedAt - times.launchedAt
  if (!(dur > 0 && dur <= 3.5)) throw new Error(`at rest ${dur.toFixed(2)} s after the pinch (must be ≤ 3.5 s)`)
  checkRpContact(rp, "landed")

  // Still at rest a moment later.
  const a = rp.getInfo()
  await sleep(400)
  const info = rp.getInfo()
  expect(info.state).toBe("landed")
  check(info.position.distance(a.position) < 0.05, () => `not at rest: moved ${info.position.distance(a.position).toFixed(3)} cm in 0.4 s`)
  checkRpContact(rp, "0.4 s after landing")

  // The scale: the largest (≤ 2x) whose footprint fits the table radius minus 3 cm.
  const s = rp.getScale()
  check(s > 1 && s <= 2, () => `scale ${s.toFixed(4)}`)
  check(Math.abs(info.scale - s) < 1e-3, () => `on the table at ${info.scale.toFixed(4)}, not ${s.toFixed(4)}`)
  const spare = info.tableRadius - rp.getFitReach()
  check(spare >= 3 - 0.01, () => `at this scale the footprint reaches ${spare.toFixed(2)} cm short of the table edge when centred (≥ 3 expected)`)
  check(s >= 2 - 1e-4 || spare < 3.01, () => `scale ${s.toFixed(4)} is not the largest that fits: ${spare.toFixed(2)} cm to spare`)
  const edge = info.tableRadius - info.footReach
  const off = rpFootOffCenter(rp)
  if (off > 1) throw new Error(`footprint centre is ${off.toFixed(2)} cm from the table centre`)

  // The tonearm side faces the user.
  const head = main.getCameraPosition()
  const toUser = new vec3(head.x - info.foot.x, 0, head.z - info.foot.z).normalize()
  const arm = rp.getArmSide()
  check(arm.dot(toUser) > 0.97, () => `the tonearm side faces ${arm}, the user is along ${toUser}`)

  // P2: no bounce above 3 mm, still within 0.3 s of contact.
  const d = info.lastDrop
  check(!!d, "no drop was recorded")
  if (d.bounce > 0.3) throw new Error(`bounced ${(d.bounce * 10).toFixed(2)} mm (max 3)`)
  if (!(d.settle >= 0 && d.settle <= 0.3)) throw new Error(`still ${d.settle.toFixed(3)} s after contact (max 0.3)`)

  // The tap and the landing tone together, from the contact on the table.
  const tap = soundsSince(main, "rp_tap", times.launchedAt)
  const land = soundsSince(main, "rp_land", times.launchedAt)
  check(tap.length === 1, () => `taps since launch: ${tap.length}`)
  check(land.length === 1, () => `landing sounds since launch: ${land.length}`)
  check(Math.abs(tap[0].time - land[0].time) < 0.02 && tap[0].position.distance(land[0].position) < 0.01, "the tap and the landing tone are not at the same contact")
  const p = land[0].position
  const flat = new vec3(p.x - info.tableCenter.x, 0, p.z - info.tableCenter.z).length
  if (Math.abs(p.y - info.tableY) > 0.5 || flat > info.tableRadius) throw new Error(`landing sound at ${p}, not on the table top under the copy`)
  print(`Cutaway R1: at rest ${dur.toFixed(2)} s after the pinch; scale ${s.toFixed(4)}; gap ${((info.lowestY - info.tableY) * 10).toFixed(2)} mm (${(d.restGap * 10).toFixed(2)} mm as found), bounce ${(d.bounce * 10).toFixed(2)} mm, still ${d.settle.toFixed(3)} s after contact; footprint centre ${(off * 10).toFixed(2)} mm off; ${edge.toFixed(2)} cm to the table edge`)
}
