import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectsByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CameraHero, HERO_PRINT_NAME, imageDistance} from "../Scripts/CutawayHero"
import {CutawayMain} from "../Scripts/CutawayMain"
import {hull2, polyGap, toView, ViewFrame, viewFrame} from "../Scripts/CutawayLayout"
import {cleanStart, getMain, press, softReset, waitUntil} from "./CutawayTestUtils"
import {check, landHero, phaseCount, toLive} from "./HeroTestUtils"

const RUNS = 10
const f1 = (x: number) => x.toFixed(1)

/**
 * P7 (camera hero pass 2, photo; print fix pass), from the default preview pose. In a 10-run loop
 * (each a fresh launch, landing and light path, sharp and blurry in turn) the print appears every
 * time and is the only print in the scene. It faces the user and floats 75 cm (±5) from their eyes,
 * a little below eye level, beside the replica: as the user sees it, it covers neither the replica
 * nor the rail. Its picture has exactly the sensor's relative blur; its tag says Sharp or Out of
 * focus, in words about 1.2 cm tall inside the bottom border; the caption is hidden while it
 * develops. Then: it develops (blank → picture in 1.2 s) and the caption comes back below the
 * print without touching it; the next photo replaces it, and pinching it dismisses it.
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
      check(p.developed < 1, () => `run ${i + 1}: already developed (${p.developed.toFixed(2)}) when checked`)
      check(Math.abs(p.blur - o.c) < 1e-4, () => `run ${i + 1}: print blur ${p.blur} vs sensor ${o.c}`)
      const rel = p.imageBlur / p.imageHeight
      check(Math.abs(rel - o.c / o.h_i) < 1e-6, () => `run ${i + 1}: print relative blur ${rel} vs sensor ${o.c / o.h_i}`)
      check(p.tag === (o.sharp ? "Sharp" : "Out of focus"), () => `run ${i + 1}: tag "${p.tag}" for c ${o.c.toFixed(3)}`)
      const head = main.getCameraPosition()
      const pos = so.getTransform().getWorldPosition()
      const dist = pos.distance(head)
      check(Math.abs(dist - 75) <= 5, () => `run ${i + 1}: print ${f1(dist)} cm from the eyes`)
      const below = head.y - pos.y
      check(below > 5 && below < 25, () => `run ${i + 1}: print ${f1(below)} cm below the eyes`)
      const facing = so.getTransform().forward.dot(head.sub(pos).normalize())
      check(facing > 0.95, () => `run ${i + 1}: print faces the user only ${facing.toFixed(3)}`)
      const clear = checkClear(hero, head, i + 1)
      const tag = checkTag(hero, i + 1)
      check(main.labelsUI.captionText() === null, () => `run ${i + 1}: caption "${main.labelsUI.captionText()}" shows while the print develops`)
      appeared++
      report.push(`${i + 1}: ${f1(dist)} cm, ${f1(below)} below, facing ${facing.toFixed(3)}, ${clear}, "${p.tag}" ${tag}`)
    }

    // It develops: blank at first, the picture fully in 1.2 s later.
    const dev0 = hero.getPrint().developed
    await waitUntil(() => hero.getPrint().developed >= 1, 1600, () => `not developed: ${hero.getPrint().developed.toFixed(2)}`)
    const devT = hero.getPrint().age
    // Then the caption comes back, below the print and clear of it.
    await sleep(500)
    const cap = checkCaption(main, hero)

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
    check(main.labelsUI.captionText() === null, () => `caption "${main.labelsUI.captionText()}" shows while the new print develops`)
    await sleep(400)
    check(findSceneObjectsByName(HERO_PRINT_NAME + "Old").length === 0, "the replaced print did not go")

    // Pinching it dismisses it.
    await waitUntil(() => hero.getPrint().age > 1, 2000)
    await press(HERO_PRINT_NAME)
    await sleep(300)
    check(!hero.getPrint().shown && hero.getPrintObject() === null, "pinching the print did not dismiss it")
    check(findSceneObjectsByName(HERO_PRINT_NAME).length === 0, "a print is still in the scene after the pinch")
    print(`P7: print appeared ${appeared}/${RUNS}; developed ${dev0.toFixed(2)} → 1 at ${devT.toFixed(2)} s; ${cap}; replaced and dismissed OK; ` + report.join("; "))
  }
}

function frame(hero: CameraHero, eye: vec3): ViewFrame {
  return viewFrame(eye, hero.getLayout().sensor)
}

/** As the user sees it, the print's card clears every part, the shell and the rail. */
function checkClear(hero: CameraHero, eye: vec3, run: number): string {
  const l = hero.getLayout()
  const pl = hero.getPrintLayout()
  check(pl !== null, `run ${run}: no print layout`)
  const F = frame(hero, eye)
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const card = view(pl.card)
  let minReplica = 1e9
  for (const part of l.parts) {
    for (const b of part.boxes) {
      const g = polyGap(card, view(b))
      minReplica = Math.min(minReplica, g)
      check(g > 0, () => `run ${run}: the print covers the ${part.label.toLowerCase()} (by ${f1(-g)} cm)`)
    }
  }
  for (const b of l.shell) {
    const g = polyGap(card, view(b))
    minReplica = Math.min(minReplica, g)
    check(g > 0, () => `run ${run}: the print covers the replica's shell (by ${f1(-g)} cm)`)
  }
  check(l.railBoxes.length > 0, `run ${run}: the rail is not showing`)
  let minRail = 1e9
  for (const b of l.railBoxes) {
    const g = polyGap(card, view(b))
    minRail = Math.min(minRail, g)
    check(g > 0, () => `run ${run}: the print covers the rail (by ${f1(-g)} cm)`)
  }
  // Which side of the replica it is on, as the user sees it.
  const cx = card.reduce((s, q) => s + q.x, 0) / card.length
  return `clear of replica ${f1(minReplica)} / rail ${f1(minRail)} (view cm), centre x ${f1(cx)}`
}

/**
 * The note font's letters, ascender to descender, fill this share of its line box (what
 * getBoundingBox measures, the same for "Sharp" and "Out of focus"): 0.98 cm letters in a 1.49 cm
 * box, measured on a preview capture.
 */
const LETTERS_OF_LINE = 0.66

/** The tag's words sit inside the bottom border, the letters about 1.2 cm tall. */
function checkTag(hero: CameraHero, run: number): string {
  const pl = hero.getPrintLayout()
  check(pl !== null && pl.tag !== null, `run ${run}: no tag on the print`)
  const t = pl.tag
  const W = pl.w / 2
  const H = pl.h / 2
  const bottom = -H
  const top = -H + pl.chin
  check(t.y0 > bottom && t.y1 < top && t.x0 > -W && t.x1 < W, () => `run ${run}: tag x ${f1(t.x0)}..${f1(t.x1)}, y ${t.y0.toFixed(2)}..${t.y1.toFixed(2)} is not inside the bottom border (y ${bottom.toFixed(2)}..${top.toFixed(2)})`)
  const line = t.y1 - t.y0
  const letters = line * LETTERS_OF_LINE
  check(letters >= 1.0 && letters <= 1.4, () => `run ${run}: tag letters ${letters.toFixed(2)} cm tall (line box ${line.toFixed(2)} cm)`)
  return `tag letters ${letters.toFixed(2)} cm (line box ${line.toFixed(2)}) in the ${pl.chin} cm border`
}

/** The caption shows again once the print has developed: below the print, not touching it. */
function checkCaption(main: CutawayMain, hero: CameraHero): string {
  const text = main.labelsUI.captionText()
  check(text !== null, "no caption after the print developed")
  const l = hero.getLayout()
  const q = l.labels.find((x) => x.id === "caption")
  check(!!q, "the caption has no quad")
  const pl = hero.getPrintLayout()
  check(pl !== null, "no print layout")
  const F = frame(hero, main.getCameraPosition())
  const view = (pts: vec3[]) => hull2(pts.map((p) => toView(F, p)))
  const card = view(pl.card)
  const words = view(q.corners)
  const gap = polyGap(card, words)
  check(gap > 0, () => `the caption overlaps the print (by ${f1(-gap)} cm)`)
  const cardBottom = Math.min(...card.map((p) => p.y))
  const capTop = Math.max(...words.map((p) => p.y))
  check(capTop < cardBottom, () => `the caption (top ${f1(capTop)}) is not below the print (bottom ${f1(cardBottom)})`)
  return `caption "${text}" below the print, ${f1(cardBottom - capTop)} view cm under it`
}
