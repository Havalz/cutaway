import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {LAMP_SCALE} from "../Scripts/CutawayLampHero"
import {LAMP_GEOM} from "../Scripts/CutawayLampModel"
import {getMain, isEnabled, press, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, getHero, launchViaQuestion, soundsSince} from "./HeroTestUtils"
import {checkLampContact, expectLampGone, getLamp, lampCleanStart, lampOffCenter, launchLampViaQuestion, waitLampHome} from "./LampHeroTestUtils"
import {getRp, launchRpViaQuestion} from "./RpHeroTestUtils"

/**
 * L1 (lamp hero, launch): "Bring it closer", from the lamp's second question and from the pill under
 * the explained lamp, ends within 3.5 s with the copy standing upright on the table: its base within
 * 2 mm of the table top (nothing below it), centred within 1 cm, its tilt under 1° and its whole
 * floor outline, cord and switch included, on the table. Its scale gives a 60 cm standing height
 * (0.3632x) unless the table is too small; the cord and its switch face the user. If the camera's
 * or the record player's copy is out, it goes home first (one copy on the table at a time).
 */
@component
export class L1LampLaunchScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)

    // Entry 1: the lamp's second question.
    await launchLampViaQuestion(main)
    await checkLanded(main)

    // Put it back; the lamp is explained and idle, so its "Bring it closer" pill shows.
    await press("LampRailPutBack")
    await waitLampHome(main)
    expectLampGone(main)
    expect(main.getStationState("lamp")).toBe("explained")
    await waitUntil(() => isEnabled("LampCloser"), 1500, () => "the Bring it closer pill did not show")

    // Entry 2: the pill.
    await press("LampCloser")
    await checkLanded(main)

    // One copy at a time: the camera's copy out, then the lamp's launch sends it home first.
    await lampCleanStart(main)
    await launchViaQuestion(main)
    await waitForPhase(main, "hero:landed", 4000)
    check(getHero(main).isOut, "the camera's copy is not out")
    await launchLampViaQuestion(main)
    let log = main.getPhaseLog()
    check(log.indexOf("lamp:cameraHome") >= 0 && log.indexOf("lamp:launch") > log.indexOf("lamp:cameraHome"), () => `the camera did not go home before the launch: ${JSON.stringify(log)}`)
    check(getHero(main).state === "none" && getHero(main).getReplica() === null, () => `the camera's copy is still out (${getHero(main).state})`)
    await checkLanded(main)

    // And the record player's.
    await lampCleanStart(main)
    await launchRpViaQuestion(main)
    await waitForPhase(main, "rp:landed", 4000)
    check(getRp(main).isOut, "the record player's copy is not out")
    await launchLampViaQuestion(main)
    log = main.getPhaseLog()
    check(log.indexOf("lamp:recordPlayerHome") >= 0 && log.indexOf("lamp:launch") > log.indexOf("lamp:recordPlayerHome"), () => `the record player did not go home before the launch: ${JSON.stringify(log)}`)
    check(getRp(main).state === "none" && getRp(main).getReplica() === null, () => `the record player's copy is still out (${getRp(main).state})`)
    await checkLanded(main)
    main.setGazeOverride(null)
  }
}

async function checkLanded(main: CutawayMain): Promise<void> {
  const lamp = getLamp(main)
  await waitForPhase(main, "lamp:landed", 4000)
  const times = lamp.getTimes()
  const dur = times.landedAt - times.launchedAt
  if (!(dur > 0 && dur <= 3.5)) throw new Error(`standing ${dur.toFixed(2)} s after the pinch (must be ≤ 3.5 s)`)
  checkLampContact(lamp, "landed")

  // Still at rest a moment later.
  const a = lamp.getInfo()
  await sleep(400)
  const info = lamp.getInfo()
  expect(info.state).toBe("landed")
  check(info.position.distance(a.position) < 0.05, () => `not at rest: moved ${info.position.distance(a.position).toFixed(3)} cm in 0.4 s`)
  checkLampContact(lamp, "0.4 s after landing")

  // The scale: 60 cm tall, or the largest whose floor outline fits the table radius minus 3 cm.
  const s = lamp.getScale()
  const spare = info.tableRadius - lamp.getFitReach()
  check(Math.abs(s - LAMP_SCALE) < 1e-4 || spare < 3.01, () => `scale ${s.toFixed(4)}: not the 60 cm scale (${LAMP_SCALE.toFixed(4)}) though ${spare.toFixed(2)} cm are to spare`)
  check(spare >= 3 - 0.01, () => `at this scale the floor outline reaches ${spare.toFixed(2)} cm short of the table edge when centred (≥ 3 expected)`)
  check(Math.abs(info.scale - s) < 1e-3, () => `on the table at ${info.scale.toFixed(4)}, not ${s.toFixed(4)}`)
  const height = LAMP_GEOM.height * info.scale
  const off = lampOffCenter(lamp)
  if (off > 1) throw new Error(`the base is ${off.toFixed(2)} cm from the table centre`)

  // The cord and its switch face the user.
  const head = main.getCameraPosition()
  const toUser = new vec3(head.x - info.foot.x, 0, head.z - info.foot.z).normalize()
  const sw = lamp.getSwitchSide()
  check(sw.dot(toUser) > 0.97, () => `the switch is toward ${sw}, the user is along ${toUser}`)

  // No bounce above 3 mm, still within 0.3 s of contact.
  const d = info.lastDrop
  check(!!d, "no drop was recorded")
  if (d.bounce > 0.3) throw new Error(`bounced ${(d.bounce * 10).toFixed(2)} mm (max 3)`)
  if (!(d.settle >= 0 && d.settle <= 0.3)) throw new Error(`still ${d.settle.toFixed(3)} s after contact (max 0.3)`)

  // The tap and the landing tone together, from the contact on the table.
  const tap = soundsSince(main, "lamp_tap", times.launchedAt)
  const land = soundsSince(main, "lamp_land", times.launchedAt)
  check(tap.length === 1, () => `taps since launch: ${tap.length}`)
  check(land.length === 1, () => `landing sounds since launch: ${land.length}`)
  check(Math.abs(tap[0].time - land[0].time) < 0.02 && tap[0].position.distance(land[0].position) < 0.01, "the tap and the landing tone are not at the same contact")
  const p = land[0].position
  const flat = new vec3(p.x - info.tableCenter.x, 0, p.z - info.tableCenter.z).length
  if (Math.abs(p.y - info.tableY) > 0.5 || flat > info.tableRadius) throw new Error(`landing sound at ${p}, not on the table top under the copy`)
  const tilt = Math.acos(Math.max(-1, Math.min(1, info.up.dot(vec3.up())))) * (180 / Math.PI)
  print(`Cutaway L1: standing ${dur.toFixed(2)} s after the pinch; scale ${s.toFixed(4)} (${height.toFixed(1)} cm tall); gap ${((info.lowestY - info.tableY) * 10).toFixed(2)} mm (${(d.restGap * 10).toFixed(2)} mm as found, tilt ${d.tiltDeg.toFixed(3)}° as found, ${tilt.toFixed(4)}° at rest), bounce ${(d.bounce * 10).toFixed(2)} mm, still ${d.settle.toFixed(3)} s after contact; base ${(off * 10).toFixed(2)} mm off centre; outline ${(info.tableRadius - info.footReach).toFixed(2)} cm inside the table edge`)
}
