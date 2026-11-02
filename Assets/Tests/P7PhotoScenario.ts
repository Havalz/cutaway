import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectsByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CameraHero, HERO_PRINT_NAME, imageDistance} from "../Scripts/CutawayHero"
import {cleanStart, getMain, press, softReset, waitUntil} from "./CutawayTestUtils"
import {check, landHero, phaseCount, toLive} from "./HeroTestUtils"

const RUNS = 10

/**
 * P7 (camera hero pass 2, photo): in a 10-run loop (each a fresh launch, landing and light path,
 * sharp and blurry in turn) the print appears every time, is the only print in the scene, faces
 * the user and floats 55 cm (±5) in front of them, below the eye line; its image has exactly the
 * sensor's relative blur and its tag says Sharp or Out of focus. Then: it develops (blank → image
 * in 1.2 s), the next photo replaces it, and pinching it dismisses it.
 */
@component
export class P7PhotoScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const report: string[] = []
    let appeared = 0
    let hero: CameraHero | null = null
    for (let i = 0; i < RUNS; i++) {
      if (i > 0) await softReset(main)
      hero = await landHero(main)
      await toLive(main, hero)
      const sharp = i % 2 === 0
      const d_o = [50, 40, 70, 30, 60][i % 5]
      hero.setSubjectDistance(d_o)
      hero.setFocusL(sharp ? imageDistance(d_o) : imageDistance(d_o) + 6)
      await sleep(200)
      const o = hero.getOptics()
      const n0 = phaseCount(main, "hero:printShown")
      await press("HeroPhoto")
      await waitUntil(() => phaseCount(main, "hero:printShown") > n0, 2500, () => `run ${i + 1}: no print reached the user (phases: ${main.getPhaseLog().slice(-6).join(", ")})`)
      await sleep(150)
      const so = hero.getPrintObject()
      const named = findSceneObjectsByName(HERO_PRINT_NAME)
      check(so !== null, `run ${i + 1}: no live print`)
      check(named.length === 1 && named[0].isSame(so), () => `run ${i + 1}: ${named.length} objects named ${HERO_PRINT_NAME}`)
      const p = hero.getPrint()
      check(p.shown, `run ${i + 1}: print not shown`)
      check(Math.abs(p.blur - o.c) < 1e-4, () => `run ${i + 1}: print blur ${p.blur} vs sensor ${o.c}`)
      const rel = p.imageBlur / p.imageHeight
      check(Math.abs(rel - o.c / o.h_i) < 1e-6, () => `run ${i + 1}: print relative blur ${rel} vs sensor ${o.c / o.h_i}`)
      check(p.tag === (o.sharp ? "Sharp" : "Out of focus"), () => `run ${i + 1}: tag "${p.tag}" for c ${o.c.toFixed(3)}`)
      const head = main.getCameraPosition()
      const pos = so.getTransform().getWorldPosition()
      const dist = pos.distance(head)
      check(Math.abs(dist - 55) <= 5, () => `run ${i + 1}: print ${dist.toFixed(1)} cm from the eyes`)
      const view = hero.getViewDir()
      const flat = new vec3(pos.x - head.x, 0, pos.z - head.z).normalize()
      check(flat.dot(view) > 0.95, () => `run ${i + 1}: print is not straight ahead (${flat.dot(view).toFixed(3)})`)
      const below = head.y - pos.y
      check(below > 5 && below < 25, () => `run ${i + 1}: print ${below.toFixed(1)} cm below the eyes`)
      const facing = so.getTransform().forward.dot(head.sub(pos).normalize())
      check(facing > 0.95, () => `run ${i + 1}: print faces the user only ${facing.toFixed(3)}`)
      appeared++
      report.push(`${i + 1}: ${dist.toFixed(1)} cm, ${below.toFixed(1)} below, facing ${facing.toFixed(3)}, "${p.tag}"`)
    }

    // It develops: blank at first, the image fully in 1.2 s later.
    const dev0 = hero.getPrint().developed
    await waitUntil(() => hero.getPrint().developed >= 1, 1600, () => `not developed: ${hero.getPrint().developed.toFixed(2)}`)
    const devT = hero.getPrint().age

    // The next photo replaces it (the old one is destroyed once it has faded, so compare ages).
    const firstAge = hero.getPrint().age
    await waitUntil(() => hero.getShotPhase() < 0, 1500)
    const n1 = phaseCount(main, "hero:print")
    await press("HeroPhoto")
    await waitUntil(() => phaseCount(main, "hero:print") > n1, 1000)
    await sleep(100)
    const second = hero.getPrintObject()
    check(second !== null && hero.getPrint().age < 1 && firstAge > 1.5, () => `the next photo did not make a new print (ages ${firstAge.toFixed(2)} → ${hero.getPrint().age.toFixed(2)})`)
    check(findSceneObjectsByName(HERO_PRINT_NAME).length === 1, "two live prints after the next photo")
    await sleep(400)
    check(findSceneObjectsByName(HERO_PRINT_NAME + "Old").length === 0, "the replaced print did not go")

    // Pinching it dismisses it.
    await waitUntil(() => hero.getPrint().age > 1, 2000)
    await press(HERO_PRINT_NAME)
    await sleep(300)
    check(!hero.getPrint().shown && hero.getPrintObject() === null, "pinching the print did not dismiss it")
    check(findSceneObjectsByName(HERO_PRINT_NAME).length === 0, "a print is still in the scene after the pinch")
    print(`P7: print appeared ${appeared}/${RUNS}; developed ${dev0.toFixed(2)} → 1 at ${devT.toFixed(2)} s; replaced and dismissed OK; ` + report.join("; "))
  }
}
