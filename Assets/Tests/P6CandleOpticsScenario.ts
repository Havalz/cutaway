import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {HERO_H_O, imageDistance} from "../Scripts/CutawayHero"
import {cleanStart, getMain} from "./CutawayTestUtils"
import {check, landHero, toLive} from "./HeroTestUtils"

/**
 * P6 (camera hero pass 2, candle optics): the subject is a candle whose flame tip and base stand
 * h_o (6 cm) apart on the axis, its flame flickers, the rays start at the flame tip and the base,
 * and pulses of light run along them. Then H4's numeric checks with the candle: for d_o 30, 50
 * and 80 cm, focused at L = d_i the blur is under 0.1 cm and h_i = h_o × d_i / d_o within 2%;
 * focused at d_i + 5 cm the blur is over 0.8 cm.
 */
@component
export class P6CandleOpticsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)
    await toLive(main, hero)
    await sleep(300)

    const c = hero.getCandleReport()
    check(c !== null, "no candle in the light path")
    check(c.flameShown, "the candle's flame is not shown")
    const d = c.tip.sub(c.base)
    const along = d.dot(c.up)
    check(Math.abs(along - HERO_H_O) < 0.05, () => `flame tip ${along.toFixed(3)} cm above the base (h_o ${HERO_H_O})`)
    check(d.sub(c.up.uniformScale(along)).length < 0.05, "the flame tip is not straight above the base")
    check(c.rayStarts.length === 6, () => `${c.rayStarts.length} rays`)
    const atTip = c.rayStarts.filter((p) => p.distance(c.tip) < 0.05).length
    const atBase = c.rayStarts.filter((p) => p.distance(c.base) < 0.05).length
    check(atTip === 3 && atBase === 3, () => `rays from the tip ${atTip}, from the base ${atBase} (want 3 and 3)`)

    // The flame lives: its height changes from moment to moment.
    const ys: number[] = []
    for (let i = 0; i < 10; i++) {
      ys.push(hero.getCandleReport().flameScaleY)
      await sleep(50)
    }
    const flick = Math.max(...ys) - Math.min(...ys)
    check(flick > 0.03, () => `the flame barely flickers (stretch range ${flick.toFixed(3)})`)

    // Light flows: pulses are on the rays and move.
    const p0 = hero.getPulses()
    await sleep(100)
    const p1 = hero.getPulses()
    check(p0.length >= 6, () => `only ${p0.length} pulses on the rays`)
    const moved = p1.filter((q) => p0.every((p) => p.distance(q) > 1)).length
    check(moved >= p1.length / 2, () => `pulses did not move: ${moved} of ${p1.length} are new positions after 0.1 s`)

    const lines: string[] = []
    for (const d_o of [30, 50, 80]) {
      const di = imageDistance(d_o)
      hero.setSubjectDistance(d_o)
      hero.setFocusL(di)
      await sleep(150)
      const o = hero.getOptics()
      if (Math.abs(o.d_o - d_o) > 1e-3 || Math.abs(o.d_i - di) > 1e-3 || Math.abs(o.L - di) > 0.05) throw new Error(`optics not set: ${JSON.stringify(o)}`)
      check(o.c < 0.1, () => `d_o ${d_o}: focused at d_i the blur is ${o.c.toFixed(3)} cm`)
      const want = (HERO_H_O * di) / d_o
      check(Math.abs(o.h_i - want) / want <= 0.02, () => `d_o ${d_o}: h_i ${o.h_i.toFixed(3)} vs h_o·d_i/d_o ${want.toFixed(3)}`)
      check(o.sharp, `d_o ${d_o}: not sharp at d_i`)
      // The rays still start at the candle where it now stands.
      const r = hero.getCandleReport()
      check(r.rayStarts.filter((p) => p.distance(r.tip) < 0.05).length === 3, `d_o ${d_o}: rays left the flame tip`)
      hero.setFocusL(di + 5)
      await sleep(150)
      const b = hero.getOptics()
      check(b.c > 0.8, () => `d_o ${d_o}: focused at d_i + 5 the blur is only ${b.c.toFixed(3)} cm`)
      check(!b.sharp, `d_o ${d_o}: sharp at d_i + 5`)
      lines.push(`d_o ${d_o}: h_i ${o.h_i.toFixed(3)} (want ${want.toFixed(3)}), c ${o.c.toFixed(4)} / ${b.c.toFixed(3)}`)
    }
    print(`P6: candle tip ${c.tip} base ${c.base}, h_o ${along.toFixed(3)}; flame stretch range ${flick.toFixed(3)}; pulses ${p0.length} → ${p1.length}, ${moved} moved; ` + lines.join("; "))
  }
}
