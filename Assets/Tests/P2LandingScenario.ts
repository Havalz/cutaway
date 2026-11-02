import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain, waitUntil} from "./CutawayTestUtils"
import {check, checkContact, footOffCenter, getHero, launchViaQuestion, soundsSince} from "./HeroTestUtils"

/**
 * P2 (camera hero pass 2, landing): the flight ends 20 cm above the table centre and the replica
 * drops under physics. Within 3.5 s of the pinch it is still (under 0.5 cm/s), its lowest point
 * within 2 mm of the table top with no part below it, and its footprint centre within 1 cm of the
 * table centre. No bounce above 3 mm, still within 0.3 s of contact, the soft tap and the landing
 * tone from the contact point, and the yaw kept (optical axis across the view).
 */
@component
export class P2LandingScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    await launchViaQuestion(main)
    const hero = getHero(main)
    const t0 = hero.getTimes().launchedAt
    check(t0 > 0, "no launch")
    await waitUntil(
      () => {
        const i = hero.getInfo()
        return i.pose === "rest" && i.speed < 0.5
      },
      Math.max(100, (t0 + 3.5 - getTime()) * 1000),
      () => `not at rest 3.5 s after the pinch: ${JSON.stringify({pose: hero.getInfo().pose, speed: hero.getInfo().speed})}`
    )
    const at = getTime() - t0
    checkContact(hero, "landing")
    const off = footOffCenter(hero)
    if (off > 1) throw new Error(`footprint centre ${off.toFixed(2)} cm from the table centre`)
    const d = hero.getInfo().lastDrop
    check(!!d, "no drop was recorded")
    if (d.bounce > 0.3) throw new Error(`bounced ${(d.bounce * 10).toFixed(2)} mm (max 3)`)
    if (!(d.settle >= 0 && d.settle <= 0.3)) throw new Error(`still ${d.settle.toFixed(3)} s after contact (max 0.3)`)
    // Tap and landing tone together, from the contact on the table top.
    const tap = soundsSince(main, "hero_tap", t0)
    const land = soundsSince(main, "hero_land", t0)
    check(tap.length === 1 && land.length === 1, () => `taps ${tap.length}, landing tones ${land.length}`)
    check(Math.abs(tap[0].time - land[0].time) < 0.02 && tap[0].position.distance(land[0].position) < 0.01, "the tap and the landing tone are not at the same contact")
    check(Math.abs(tap[0].position.y - hero.getInfo().tableY) < 0.5, () => `tap at y ${tap[0].position.y.toFixed(2)}, not on the table top`)
    // Yaw kept: the lens points across the view.
    check(Math.abs(hero.getYawDeg()) < 1, () => `yaw changed by ${hero.getYawDeg().toFixed(2)}°`)
    print(`Cutaway P2: at rest ${at.toFixed(2)} s after the pinch; gap ${(d.restGap * 10).toFixed(2)} mm, tilt ${d.tiltDeg.toFixed(3)}°, bounce ${(d.bounce * 10).toFixed(2)} mm, still ${d.settle.toFixed(3)} s after contact; footprint centre ${(off * 10).toFixed(2)} mm off`)
    await sleep(500)
    checkContact(hero, "0.5 s later")
  }
}
