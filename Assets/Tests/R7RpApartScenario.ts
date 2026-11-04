import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {hull2, meshBoxes, polyGap, toView, viewFrame} from "../Scripts/CutawayLayout"
import {CutawayMain} from "../Scripts/CutawayMain"
import {RecordPlayerHero} from "../Scripts/CutawayRpHero"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {checkRpContact, landRp, rpCleanStart, waitRpRest} from "./RpHeroTestUtils"

const f1 = (x: number) => x.toFixed(1)

/**
 * R7 (record player hero, take it apart). Above 0 the copy hovers 12 cm (±1) over the disc of
 * light; at least 8 labelled solid parts separate (labels of four words or fewer, clear of each
 * other, the caption, the rail and the parts); the plinth is an outline at about 15%; the motor
 * turns the belt and sub-platter, and the magnet wiggles between the coils as they pulse. Back at 0
 * every part is within 1 mm of its rest and the copy rests on the table at P2 accuracy.
 */
@component
export class R7RpApartScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    const rail = main.getRpRail()

    rail.setValue("apart", 1)
    await waitForPhase(main, "rp:hover", 2000)
    await sleep(150)
    const i = rp.getInfo()
    const h = i.lowestY - i.tableY
    check(Math.abs(h - 12) <= 1, () => `hovers ${h.toFixed(2)} cm over the disc`)
    check(i.discShown, "no disc of light under it")

    await waitUntil(() => rp.getApartInfo().live, 3000, () => `not fully apart: s = ${rp.getApartInfo().s.toFixed(2)}`)
    await sleep(700)
    const a = rp.getApartInfo()
    const sep = a.parts.filter((p) => p.moved > 1 && p.labelShown && p.solid)
    check(sep.length >= 8, () => `${sep.length} labelled solid parts separated: ${a.parts.map((p) => `${p.label} ${p.moved.toFixed(1)}cm${p.labelShown ? "" : " (no label)"}${p.solid ? "" : " (not solid)"}`).join(", ")}`)
    for (const p of a.parts) {
      check(p.label.split(" ").length <= 4, () => `label "${p.label}" is more than four words`)
      if (p.labelShown) check(p.solid, () => `"${p.label}" labels a part that is not solid`)
    }
    const shown = a.parts.filter((p) => p.labelShown)
    check(shown.length >= 8, () => `only ${shown.length} labels shown`)
    check(Math.abs(a.plinthFill - 0.15) < 0.01, () => `the plinth is at ${(a.plinthFill * 100).toFixed(0)}%, not an outline at 15%`)
    check(a.interiorShown, "the belt, sub-platter and motor are not shown")
    check(rp.getCaptionStage() === 4, () => `caption stage ${rp.getCaptionStage()} while apart`)
    const layout = checkLabels(main, rp)

    // Live detail: the motor drives the belt and sub-platter; the magnet wiggles, the coils pulse.
    const pul = rp.getPart("RpMotorPulley").getTransform()
    const sub = rp.getPart("RpSubPlatter").getTransform()
    const q0 = {p: pul.getLocalRotation(), s: sub.getLocalRotation(), d: a.driveAngle, b: a.beltTravel}
    let mLo = Infinity
    let mHi = -Infinity
    let gLo = Infinity
    let gHi = -Infinity
    for (let k = 0; k < 40; k++) {
      const x = rp.getApartInfo()
      mLo = Math.min(mLo, x.magnetOffset)
      mHi = Math.max(mHi, x.magnetOffset)
      gLo = Math.min(gLo, x.coilGlow)
      gHi = Math.max(gHi, x.coilGlow)
      await sleep(25)
    }
    const b = rp.getApartInfo()
    check(b.driveOmega > 3, () => `the motor drive runs at ${b.driveOmega.toFixed(2)} rad/s`)
    check(b.driveAngle - q0.d > 2, () => `the sub-platter turned only ${(b.driveAngle - q0.d).toFixed(2)} rad`)
    check(angleBetween(q0.s, sub.getLocalRotation()) > 0.2, "the sub-platter's transform did not turn")
    check(angleBetween(q0.p, pul.getLocalRotation()) > 0.05 || b.driveOmega > 3, "the motor pulley's transform did not turn")
    check(b.beltTravel !== q0.b, "the belt did not run")
    check(mHi - mLo > 0.06, () => `the magnet moved only ${(mHi - mLo).toFixed(3)} cm`)
    check(gHi - gLo > 0.3 && gHi > 0.6, () => `the coils' glow ranged ${gLo.toFixed(2)}–${gHi.toFixed(2)}`)
    print(`Cutaway R7: hover ${h.toFixed(2)} cm; separated: ${sep.map((p) => p.label).join(", ")}; ${layout}; magnet ${(mHi - mLo).toFixed(3)} cm p-p, coils ${gLo.toFixed(2)}–${gHi.toFixed(2)}, motor ${b.driveOmega.toFixed(2)} rad/s`)

    // Back to 0: every part home exactly, then it sets down on the table.
    rail.setValue("apart", 0)
    await waitForPhase(main, "rp:descend", 3000)
    await waitRpRest(rp, 3000, "after reassembly")
    await sleep(300)
    const c = rp.getApartInfo()
    check(c.s === 0, () => `parts still apart: ${c.s}`)
    check(c.maxRestError <= 0.1, () => `a part is ${(c.maxRestError * 10).toFixed(2)} mm from its rest`)
    check(!c.interiorShown, "the interior is still shown")
    check(c.parts.every((p) => !p.labelShown), "labels still shown")
    check(Math.abs(c.plinthFill - 1) < 1e-6, "the plinth is still an outline")
    checkRpContact(rp, "after reassembly")
    check(rp.getCaptionStage() === 0, () => `caption stage ${rp.getCaptionStage()} after reassembly`)
    print(`Cutaway R7: reassembled; furthest part ${(c.maxRestError * 10).toFixed(3)} mm from rest; resting at P2 accuracy`)
  }
}

function angleBetween(a: quat, b: quat): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)
  return 2 * Math.acos(Math.min(1, d))
}

/** Each pair of labels (and the caption) apart, and each label clear of the rail and the parts it names. */
function checkLabels(main: CutawayMain, rp: RecordPlayerHero): string {
  const eye = WorldCameraFinderProvider.getInstance().getTransform().getWorldPosition()
  const F = viewFrame(eye, rp.getReplica().getTransform().getWorldPosition())
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const quads = main.labelsUI.getTextQuads()
  const labels = quads.filter((q) => q.id.startsWith("rp_")).map((q) => ({text: q.text, h: view(q.corners)}))
  const cap = quads.find((q) => q.id === "caption")
  const all = cap ? labels.concat([{text: cap.text, h: view(cap.corners)}]) : labels
  let minLabel = 1e9
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const g = polyGap(all[i].h, all[j].h)
      minLabel = Math.min(minLabel, g)
      check(g > 0, () => `label "${all[i].text}" overlaps "${all[j].text}" (by ${f1(-g)} cm)`)
    }
  }
  const rail = main.getRpRail()
  let minPart = 1e9
  for (const q of labels) {
    for (const b of rail.getBoxes()) check(polyGap(q.h, view(b)) > 0, () => `label "${q.text}" overlaps the rail`)
    for (const name of ["RpDustCover", "RpRecord", "RpPlatter", "RpTonearm", "RpMotor", "RpBelt", "RpSubPlatter"]) {
      for (const b of meshBoxes(rp.getPart(name))) {
        const g = polyGap(q.h, view(b))
        minPart = Math.min(minPart, g)
        check(g > 0, () => `label "${q.text}" overlaps ${name} (by ${f1(-g)} cm)`)
      }
    }
  }
  return `${labels.length} labels, closest label-label ${f1(minLabel)} cm, label-part ${f1(minPart)} cm`
}
