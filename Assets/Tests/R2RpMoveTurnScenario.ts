import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {RecordPlayerHero} from "../Scripts/CutawayRpHero"
import {drag, getMain} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {checkRpContact, landRp, rpCleanStart, waitRpRest} from "./RpHeroTestUtils"

/**
 * R2 (record player hero, move and turn; the same rules as the camera's P3 and H3).
 * Move: grabbing the plinth slides the copy across the table top. While held it is lifted 1.5 cm;
 * a drag changes its position only in the table plane; dragged far past the edge the footprint
 * stays on the table; within 0.5 s of release it rests with the P2 contact accuracy.
 * Turn: grabbing the open dust cover only turns it around the vertical axis. Its footprint centre
 * and scale stay the same and it stays upright.
 */
@component
export class R2RpMoveTurnScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)

    // --- Turn (H3): the same drags as the camera's H3 ---
    // LEAF's mock interactor reports planecastPoint as the handle's position plus its hit point, so a
    // drag is seen around the world origin rather than the footprint centre: a sideways (world X) drag
    // is what swings the handle around the copy here, as in H3. On device the planecast point is true.
    const before = rp.getInfo()
    const yaw0 = rp.getYawDeg()
    await drag("RpTurnGrab", new vec3(1.2, 0, 0), 700)
    await waitRpRest(rp, 800, "after the turn")
    const yaw1 = rp.getYawDeg()
    if (Math.abs(yaw1 - yaw0) < 3) throw new Error(`a sideways drag turned it only ${(yaw1 - yaw0).toFixed(2)}°`)
    checkSame(before, rp.getInfo())

    // Up, down and toward the user: still (at most) a turn, never a move, tilt or scale.
    await drag("RpTurnGrab", new vec3(0, 1.2, 0), 500)
    await waitRpRest(rp, 800, "after the up drag")
    await drag("RpTurnGrab", new vec3(0, -0.8, 0.8), 500)
    await waitRpRest(rp, 800, "after the down drag")
    checkSame(before, rp.getInfo())
    checkRpContact(rp, "after turning")
    print(`Cutaway R2: turned ${(rp.getYawDeg() - yaw0).toFixed(2)}° in all; footprint centre kept`)

    // --- Move (P3): a short drag, partly upward: plane only, lifted 1.5 cm while held ---
    const start = rp.getInfo()
    let maxReach = 0
    let held: number[] = []
    const watch = watchDrag(rp, (r, h, isHeld) => {
      maxReach = Math.max(maxReach, r)
      if (isHeld) held.push(h)
    })
    await drag("RpGrab", new vec3(0.5, 0.6, -0.3), 500)
    watch.stop()
    check(held.length > 3, "too few samples while held")
    const lift = held[held.length - 1]
    if (Math.abs(lift - 1.5) > 0.2) throw new Error(`held ${lift.toFixed(2)} cm above the table (1.5 expected)`)
    const t1 = getTime()
    await waitRpRest(rp, 500, "0.5 s after release")
    checkRpContact(rp, `${((getTime() - t1) * 1000).toFixed(0)} ms after release`)
    // At its scale (the largest that fits) the footprint reaches within 3 cm of the table edge, so a
    // drag can carry it only a few cm before the edge holds it: it moves the way it was dragged.
    const a = rp.getInfo()
    const mv = new vec3(a.foot.x - start.foot.x, 0, a.foot.z - start.foot.z)
    const moved = mv.length
    const want = new vec3(0.5, 0, -0.3).normalize()
    if (moved < 1.5) throw new Error(`a drag moved it only ${moved.toFixed(2)} cm`)
    check(mv.normalize().dot(want) > 0.8, () => `it moved along ${mv.normalize()}, not the drag ${want}`)
    print(`Cutaway R2: a short drag moved it ${moved.toFixed(2)} cm (footprint reach ${a.footReach.toFixed(2)} of ${a.tableRadius.toFixed(2)} cm)`)
    check(Math.abs(a.foot.y - start.foot.y) < 0.2, () => `it changed height: ${start.foot.y.toFixed(3)} → ${a.foot.y.toFixed(3)}`)

    // Far past the edge, in two directions: the footprint never leaves the table.
    for (const dir of [new vec3(3, 0, 0), new vec3(-2, 0, -2.5)]) {
      maxReach = 0
      held = []
      const w = watchDrag(rp, (r, h, isHeld) => {
        maxReach = Math.max(maxReach, r)
        if (isHeld) held.push(h)
      })
      await drag("RpGrab", dir, 1500)
      w.stop()
      const r = rp.getInfo().tableRadius
      if (maxReach > r + 0.01) throw new Error(`dragged past the edge, the footprint reached ${maxReach.toFixed(2)} cm from the centre (radius ${r.toFixed(2)})`)
      const t2 = getTime()
      await waitRpRest(rp, 500, "0.5 s after the edge drag")
      checkRpContact(rp, `edge drag, ${((getTime() - t2) * 1000).toFixed(0)} ms after release`)
      const reach = rp.getInfo().footReach
      check(reach > r - 6, () => `it stopped ${(r - reach).toFixed(2)} cm short of the edge`)
      print(`Cutaway R2: edge drag ${dir}: footprint reached ${maxReach.toFixed(2)} cm (table radius ${r.toFixed(2)}), rests at ${reach.toFixed(2)} cm`)
    }
    expect(rp.state).toBe("landed")
  }
}

function checkSame(before: {foot: vec3; scale: number; up: vec3}, after: {foot: vec3; scale: number; up: vec3}): void {
  const moved = new vec3(after.foot.x - before.foot.x, 0, after.foot.z - before.foot.z).length
  if (moved > 0.05) throw new Error(`its footprint centre moved ${moved.toFixed(3)} cm`)
  if (Math.abs(after.scale - before.scale) > 1e-3) throw new Error(`scale changed ${before.scale} → ${after.scale}`)
  if (after.up.dot(vec3.up()) < 0.99996) throw new Error(`it tilted: up = ${after.up}`)
}

/** Sample the footprint reach, the lift and whether it is held, every ~30 ms while a drag runs. */
function watchDrag(rp: RecordPlayerHero, cb: (reach: number, lift: number, held: boolean) => void): {stop: () => void} {
  let on = true
  const loop = async () => {
    while (on) {
      const i = rp.getInfo()
      cb(i.footReach, i.lowestY - i.tableY, i.held)
      await sleep(30)
    }
  }
  void loop()
  return {stop: () => (on = false)}
}
