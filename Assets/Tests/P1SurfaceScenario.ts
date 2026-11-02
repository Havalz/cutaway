import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, getHero, launchViaQuestion} from "./HeroTestUtils"

/**
 * P1 (camera hero pass 2, surface): at launch the table top is surveyed (World Query hit test,
 * 9 x 9 rays over 1.2 m x 1.2 m around the table marker). The method in use is reported (hit
 * test or fallback), with the found height, centre and radius against the table marker; the
 * physics table collider and the landing spot use it.
 */
@component
export class P1SurfaceScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    await launchViaQuestion(main)
    const hero = getHero(main)
    await waitUntil(() => main.getPhaseLog().some((p) => p.indexOf("hero:surface:") === 0), 4000, () => "no surface was reported")
    const s = hero.getSurface()
    check(s.method === "hitTest" || s.method === "fallback", () => `unknown surface method ${s.method}`)
    const reported = main.getPhaseLog().filter((p) => p.indexOf("hero:surface:") === 0)
    check(reported[reported.length - 1] === "hero:surface:" + s.method, () => `reported ${JSON.stringify(reported)} but using ${s.method}`)
    for (const v of [s.height, s.center.x, s.center.z, s.radius, s.safeRadius]) check(isFinite(v), () => `surface value not finite: ${JSON.stringify(s)}`)
    check(s.radius > 10 && s.safeRadius > 10 && s.safeRadius <= s.radius + 1e-3, () => `implausible radius ${s.radius} (safe ${s.safeRadius})`)
    check(Math.abs(s.center.y - s.height) < 1e-3, "the centre is not on the table top")
    // The offsets against the marker are the real ones.
    const m = main.getTablePosition()
    const off = new vec3(s.center.x - m.x, 0, s.center.z - m.z).length
    check(Math.abs(off - s.offCenter) < 1e-3, () => `offCenter ${s.offCenter} vs ${off}`)
    check(Math.abs(s.height - m.y - s.offHeight) < 1e-3, () => `offHeight ${s.offHeight} vs ${s.height - m.y}`)
    if (s.method === "fallback") check(s.note.length > 0, "the fallback does not say why it is in use")
    print(
      `Cutaway P1: surface ${s.method}${s.note ? " (" + s.note + ")" : ""}: height ${s.height.toFixed(2)} cm, centre (${s.center.x.toFixed(2)}, ${s.center.z.toFixed(2)}), ` +
        `radius ${s.radius.toFixed(2)} (safe ${s.safeRadius.toFixed(2)}) cm; tableMarker (${m.x.toFixed(2)}, ${m.y.toFixed(2)}, ${m.z.toFixed(2)}): centre ${s.offCenter.toFixed(2)} cm away, height ${s.offHeight.toFixed(2)} cm`
    )
    // The replica lands on that surface.
    await waitForPhase(main, "hero:landed", 4000)
    const info = hero.getInfo()
    check(Math.abs(info.tableY - s.height) < 1e-3, "the replica uses another table height")
  }
}
