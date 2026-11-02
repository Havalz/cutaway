import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CameraHero} from "../Scripts/CutawayHero"
import {cleanStart, drag, getMain} from "./CutawayTestUtils"
import {check, checkContact, landHero, waitRest} from "./HeroTestUtils"

/**
 * P3 (camera hero pass 2, move it): grabbing the body slides the replica across the table top.
 * While held it is lifted 1.5 cm; a drag changes its position only in the table plane; dragged
 * far past the edge the footprint stays on the table; within 0.5 s of release it rests with the
 * P2 contact accuracy.
 */
@component
export class P3MoveScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)
    const start = hero.getInfo()

    // A short drag, partly upward: it moves in the plane only, lifted 1.5 cm while held.
    let maxReach = 0
    let held: number[] = []
    const watch = watchDrag(hero, (r, h, isHeld) => {
      maxReach = Math.max(maxReach, r)
      if (isHeld) held.push(h)
    })
    await drag("HeroGrab", new vec3(0.5, 0.6, -0.3), 500)
    watch.stop()
    check(held.length > 3, "too few samples while held")
    const lift = held[held.length - 1]
    if (Math.abs(lift - 1.5) > 0.2) throw new Error(`held ${lift.toFixed(2)} cm above the table (1.5 expected)`)
    const t1 = getTime()
    await waitRest(hero, 500, "0.5 s after release")
    checkContact(hero, `${((getTime() - t1) * 1000).toFixed(0)} ms after release`)
    const a = hero.getInfo()
    const moved = new vec3(a.foot.x - start.foot.x, 0, a.foot.z - start.foot.z).length
    if (moved < 3) throw new Error(`a drag moved it only ${moved.toFixed(2)} cm`)
    check(Math.abs(a.foot.y - start.foot.y) < 0.2, () => `it changed height: ${start.foot.y.toFixed(3)} → ${a.foot.y.toFixed(3)}`)

    // Far past the edge, in two directions: the footprint never leaves the table.
    for (const dir of [new vec3(3, 0, 0), new vec3(-2, 0, -2.5)]) {
      maxReach = 0
      held = []
      const w = watchDrag(hero, (r, h, isHeld) => {
        maxReach = Math.max(maxReach, r)
        if (isHeld) held.push(h)
      })
      await drag("HeroGrab", dir, 1500)
      w.stop()
      const r = hero.getInfo().tableRadius
      if (maxReach > r + 0.01) throw new Error(`dragged past the edge, the footprint reached ${maxReach.toFixed(2)} cm from the centre (radius ${r.toFixed(2)})`)
      const t2 = getTime()
      await waitRest(hero, 500, "0.5 s after the edge drag")
      checkContact(hero, `edge drag, ${((getTime() - t2) * 1000).toFixed(0)} ms after release`)
      const reach = hero.getInfo().footReach
      check(reach > r - 6, () => `it stopped ${(r - reach).toFixed(2)} cm short of the edge`)
      print(`Cutaway P3: edge drag ${dir}: footprint reached ${maxReach.toFixed(2)} cm (table radius ${r.toFixed(2)}), rests at ${reach.toFixed(2)} cm`)
    }
  }
}

/** Sample the footprint reach, the lift and whether it is held, every ~30 ms while a drag runs. */
function watchDrag(hero: CameraHero, cb: (reach: number, lift: number, held: boolean) => void): {stop: () => void} {
  let on = true
  const loop = async () => {
    while (on) {
      const i = hero.getInfo()
      cb(i.footReach, i.lowestY - i.tableY, i.held)
      await sleep(30)
    }
  }
  void loop()
  return {stop: () => (on = false)}
}
