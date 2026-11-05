import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {LampHero} from "../Scripts/CutawayLampHero"
import {drag, getMain} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {checkLampContact, landLamp, lampCleanStart, waitLampRest} from "./LampHeroTestUtils"

/**
 * L2 (lamp hero, move and turn; the same rules as the camera's P3 and H3).
 * Turn: grabbing the shade (the lamp off) only turns it around the vertical axis: its base's centre
 * and scale stay the same and it stays upright.
 * Move: grabbing the base and stem slides it across the table top. While held it is lifted 1.5 cm;
 * a drag changes its position only in the table plane; dragged far past the edge the whole floor
 * outline (base, cord, switch, plug) stays on the table; within 0.5 s of release it stands with the
 * L1 contact accuracy. The cord and the switch move and turn with the lamp.
 */
@component
export class L2LampMoveTurnScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    const lamp = await landLamp(main)

    // --- Turn (H3) ---
    // LEAF's mock interactor reports planecastPoint as the handle's position plus its hit point, so a
    // drag is seen around the world origin rather than the base's centre: a sideways (world X) drag
    // is what swings the handle around the copy here, as in H3. On device the planecast point is true.
    const before = lamp.getInfo()
    const sw0 = switchRel(lamp)
    const yaw0 = lamp.getYawDeg()
    await drag("LampTurnGrab", new vec3(1.2, 0, 0), 700)
    await waitLampRest(lamp, 800, "after the turn")
    const yaw1 = lamp.getYawDeg()
    if (Math.abs(yaw1 - yaw0) < 3) throw new Error(`a sideways drag turned it only ${(yaw1 - yaw0).toFixed(2)}°`)
    checkSame(before, lamp.getInfo())
    // The switch turned with it: the same distance from the base, at the new yaw.
    const sw1 = switchRel(lamp)
    check(Math.abs(sw1.length - sw0.length) < 0.05, () => `the switch is ${sw1.length.toFixed(2)} cm from the base, was ${sw0.length.toFixed(2)}`)
    const turnedSw = (Math.atan2(sw1.x, sw1.z) - Math.atan2(sw0.x, sw0.z)) * (180 / Math.PI)
    const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180
    check(Math.abs(wrap(turnedSw - (yaw1 - yaw0))) < 0.5, () => `the switch turned ${turnedSw.toFixed(2)}°, the lamp ${(yaw1 - yaw0).toFixed(2)}°`)

    // Up, down and toward the user: still (at most) a turn, never a move, tilt or scale.
    await drag("LampTurnGrab", new vec3(0, 1.2, 0), 500)
    await waitLampRest(lamp, 800, "after the up drag")
    await drag("LampTurnGrab", new vec3(0, -0.8, 0.8), 500)
    await waitLampRest(lamp, 800, "after the down drag")
    checkSame(before, lamp.getInfo())
    checkLampContact(lamp, "after turning")
    print(`Cutaway L2: turned ${(lamp.getYawDeg() - yaw0).toFixed(2)}° in all; base kept; the switch turned with it`)

    // --- Move (P3): a short drag, partly upward: plane only, lifted 1.5 cm while held ---
    const start = lamp.getInfo()
    const swStart = switchWorld(lamp)
    let maxReach = 0
    let held: number[] = []
    const watch = watchDrag(lamp, (r, h, isHeld) => {
      maxReach = Math.max(maxReach, r)
      if (isHeld) held.push(h)
    })
    await drag("LampGrab", new vec3(0.5, 0.6, -0.3), 500)
    watch.stop()
    check(held.length > 3, "too few samples while held")
    const lift = held[held.length - 1]
    if (Math.abs(lift - 1.5) > 0.2) throw new Error(`held ${lift.toFixed(2)} cm above the table (1.5 expected)`)
    const t1 = getTime()
    await waitLampRest(lamp, 500, "0.5 s after release")
    checkLampContact(lamp, `${((getTime() - t1) * 1000).toFixed(0)} ms after release`)
    const a = lamp.getInfo()
    const mv = new vec3(a.foot.x - start.foot.x, 0, a.foot.z - start.foot.z)
    const moved = mv.length
    const want = new vec3(0.5, 0, -0.3).normalize()
    if (moved < 1.5) throw new Error(`a drag moved it only ${moved.toFixed(2)} cm`)
    check(mv.normalize().dot(want) > 0.8, () => `it moved along ${mv.normalize()}, not the drag ${want}`)
    check(Math.abs(a.foot.y - start.foot.y) < 0.2, () => `it changed height: ${start.foot.y.toFixed(3)} → ${a.foot.y.toFixed(3)}`)
    // The cord and switch came along: the switch moved exactly as the base did.
    const swMv = switchWorld(lamp).sub(swStart)
    check(new vec3(swMv.x - mv.x, 0, swMv.z - mv.z).length < 0.05, () => `the switch moved ${swMv}, the base ${mv}`)
    print(`Cutaway L2: a short drag moved it ${moved.toFixed(2)} cm, the switch with it (outline reach ${a.footReach.toFixed(2)} of ${a.tableRadius.toFixed(2)} cm)`)

    // Far past the edge, in two directions: the floor outline never leaves the table.
    for (const dir of [new vec3(3, 0, 0), new vec3(-2, 0, -2.5)]) {
      maxReach = 0
      held = []
      const w = watchDrag(lamp, (r, h, isHeld) => {
        maxReach = Math.max(maxReach, r)
        if (isHeld) held.push(h)
      })
      await drag("LampGrab", dir, 1500)
      w.stop()
      const r = lamp.getInfo().tableRadius
      if (maxReach > r + 0.01) throw new Error(`dragged past the edge, the outline reached ${maxReach.toFixed(2)} cm from the centre (radius ${r.toFixed(2)})`)
      const t2 = getTime()
      await waitLampRest(lamp, 500, "0.5 s after the edge drag")
      checkLampContact(lamp, `edge drag, ${((getTime() - t2) * 1000).toFixed(0)} ms after release`)
      const reach = lamp.getInfo().footReach
      check(reach > r - 6, () => `it stopped ${(r - reach).toFixed(2)} cm short of the edge`)
      print(`Cutaway L2: edge drag ${dir}: outline reached ${maxReach.toFixed(2)} cm (table radius ${r.toFixed(2)}), rests at ${reach.toFixed(2)} cm`)
    }
    expect(lamp.state).toBe("landed")
  }
}

/** The switch's world position. */
function switchWorld(lamp: LampHero): vec3 {
  return lamp.getPart("LampSwitch").getTransform().getWorldPosition()
}

/** The switch relative to the base's centre (flat, world). */
function switchRel(lamp: LampHero): vec3 {
  const p = switchWorld(lamp)
  const f = lamp.getInfo().foot
  return new vec3(p.x - f.x, 0, p.z - f.z)
}

function checkSame(before: {foot: vec3; scale: number; up: vec3}, after: {foot: vec3; scale: number; up: vec3}): void {
  const moved = new vec3(after.foot.x - before.foot.x, 0, after.foot.z - before.foot.z).length
  if (moved > 0.05) throw new Error(`its base moved ${moved.toFixed(3)} cm`)
  if (Math.abs(after.scale - before.scale) > 1e-3) throw new Error(`scale changed ${before.scale} → ${after.scale}`)
  if (after.up.dot(vec3.up()) < 0.99985) throw new Error(`it tilted: up = ${after.up}`)
}

/** Sample the outline reach, the lift and whether it is held, every ~30 ms while a drag runs. */
function watchDrag(lamp: LampHero, cb: (reach: number, lift: number, held: boolean) => void): {stop: () => void} {
  let on = true
  const loop = async () => {
    while (on) {
      const i = lamp.getInfo()
      cb(i.footReach, i.lowestY - i.tableY, i.held)
      await sleep(30)
    }
  }
  void loop()
  return {stop: () => (on = false)}
}
