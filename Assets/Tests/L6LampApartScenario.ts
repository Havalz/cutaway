import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {boxCorners, hull2, polyGap, toView, viewFrame, ViewFrame} from "../Scripts/CutawayLayout"
import {LAMP_CAPTIONS, LampHero} from "../Scripts/CutawayLampHero"
import {LAMP_GEOM} from "../Scripts/CutawayLampModel"
import {CutawayMain} from "../Scripts/CutawayMain"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, phaseCount} from "./HeroTestUtils"
import {checkLampContact, lampCleanStart, landLamp, pressLampSwitch, waitLampRest} from "./LampHeroTestUtils"

const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => x.toFixed(2)

/**
 * L6 (lamp hero, take it apart). Above 0 the copy hovers 12 cm (±1) over the disc of light, the cord
 * and switch staying on the table; at least 8 labelled solid parts separate (labels of four words or
 * fewer, clear of each other, the caption, the rail and the parts); the paper opens left and right
 * as the user sees it, the driver slides out on the side away from the rail and turns to the user.
 * With the lamp switched on while apart, the driver detail runs (a flowing sine in, a flat steady
 * current out) with its caption. Back at 0 every part is within 1 mm of its rest and the copy stands
 * on the table at L1 accuracy.
 */
@component
export class L6LampApartScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    const lamp = await landLamp(main)
    const rail = main.getLampRail()
    const tableY = lamp.getInfo().tableY
    const sw = lamp.getPart("LampSwitch").getTransform()
    const cord = lamp.getPart("LampCord").getTransform()
    const sw0 = sw.getWorldPosition()
    const cord0 = cord.getWorldPosition()

    // ---------------- Apart with the lamp off ----------------
    rail.setValue("apart", 1)
    await waitForPhase(main, "lamp:hover", 2000)
    await sleep(150)
    const i = lamp.getInfo()
    const h = i.lowestY - i.tableY
    check(Math.abs(h - 12) <= 1, () => `hovers ${h.toFixed(2)} cm over the disc`)
    check(i.discShown, "no disc of light under it")
    const swMove = sw.getWorldPosition().distance(sw0)
    const cordMove = cord.getWorldPosition().distance(cord0)
    check(swMove < 0.05 && cordMove < 0.05, () => `hovering, the switch moved ${f2(swMove)} cm and the cord ${f2(cordMove)} cm (they stay on the table)`)
    check(Math.abs(sw.getWorldPosition().y - tableY - (sw0.y - tableY)) < 0.05, "the switch left the table")

    await waitUntil(() => lamp.getApart().live, 3000, () => `not fully apart: s = ${lamp.getApart().s.toFixed(2)}`)
    await sleep(700)
    const a = lamp.getApart()
    const sep = a.parts.filter((p) => p.moved > 1 && p.labelShown && p.solid)
    check(sep.length >= 8, () => `${sep.length} labelled solid parts separated: ${a.parts.map((p) => `${p.label} ${p.moved.toFixed(1)}cm${p.labelShown ? "" : " (no label)"}${p.solid ? "" : " (not solid)"}`).join(", ")}`)
    for (const p of a.parts) {
      check(p.label.split(" ").length <= 4, () => `label "${p.label}" is more than four words`)
      if (p.labelShown) check(p.solid, () => `"${p.label}" labels a part that is not solid`)
    }
    const shown = a.parts.filter((p) => p.labelShown)
    check(shown.length >= 8, () => `only ${shown.length} labels shown: ${shown.map((p) => p.label).join(", ")}`)
    check(a.interiorShown, "the driver board is not shown")
    check(a.detail === 0, () => `the driver detail runs with the lamp off (${a.detail.toFixed(2)})`)
    check(lamp.getCaption() === LAMP_CAPTIONS.press, () => `caption "${lamp.getCaption()}" apart with the lamp off`)
    check(sw.getWorldPosition().distance(sw0) < 0.05 && cord.getWorldPosition().distance(cord0) < 0.05, "apart, the cord or switch left its place on the table")
    const view = checkView(main, lamp)
    const layout = checkLabels(main, lamp)
    print(`Cutaway L6: hover ${h.toFixed(2)} cm, cord and switch on the table (moved ${f2(swMove)} / ${f2(cordMove)} cm); separated: ${sep.map((p) => `${p.label} ${f1(p.moved)}`).join(", ")} cm; ${view}; ${layout}`)

    // ---------------- Switched on while apart: the driver detail ----------------
    await pressLampSwitch()
    await waitForPhase(main, "lamp:on", 1000)
    await waitForPhase(main, "lamp:bulb", 4000)
    await waitForPhase(main, "lamp:driverCaption", 1500)
    await sleep(500)
    const d0 = lamp.getApart()
    let waveMax = 0
    let flatMax = 0
    for (let k = 0; k < 20; k++) {
      const x = lamp.getApart()
      waveMax = Math.max(waveMax, x.waveDev)
      flatMax = Math.max(flatMax, x.flatDev)
      await sleep(25)
    }
    const d1 = lamp.getApart()
    check(d1.detail > 0.9, () => `the driver detail is at ${d1.detail.toFixed(2)} with the lamp on`)
    check(waveMax > 0.2, () => `the wall power's wave is only ${f2(waveMax)} cm high`)
    check(flatMax < 1e-6, () => `the current out of the driver is not flat (${flatMax})`)
    check(d1.wavePhase > d0.wavePhase + 0.3, () => `the wave did not flow: phase ${f2(d0.wavePhase)} → ${f2(d1.wavePhase)}`)
    for (const n of ["LampDriverWave", "LampDriverFlat"]) {
      const so = findSceneObjectByName(n)
      check(!!so && so.isEnabledInHierarchy, () => `${n} is not drawn`)
    }
    check(lamp.getCaption() === LAMP_CAPTIONS.driver, () => `caption "${lamp.getCaption()}" with the driver live`)
    check(phaseCount(main, "lamp:driverCaption") === 1, () => `the driver caption showed ${phaseCount(main, "lamp:driverCaption")} times`)
    const li = lamp.getLight()
    check(li.led > 0.99, () => `the LED is at ${li.led.toFixed(2)} apart`)
    check(li.pulseLevel === 0 && li.shadeGlow === 0 && li.tablePool.level === 0 && li.rays === 0, () => `apart, the whole lamp's light still shows: pulses ${li.pulseLevel}, shade ${li.shadeGlow}, pool ${li.tablePool.level}, rays ${li.rays}`)
    checkLabels(main, lamp)
    print(`Cutaway L6: on while apart: LED ${li.led.toFixed(2)}, driver detail ${d1.detail.toFixed(2)}: wave ${f2(waveMax)} cm high flowing ${f2((d1.wavePhase - d0.wavePhase) / 0.5)} waves/s in, flat current out; caption "${lamp.getCaption()}"`)

    // ---------------- Back to 0: every part home exactly, then it stands on the table ----------------
    rail.setValue("apart", 0)
    await waitForPhase(main, "lamp:descend", 3000)
    await waitLampRest(lamp, 3000, "after reassembly")
    await sleep(300)
    const c = lamp.getApart()
    check(c.s === 0, () => `parts still apart: ${c.s}`)
    check(c.maxRestError <= 0.1, () => `a part is ${(c.maxRestError * 10).toFixed(2)} mm from its rest`)
    check(!c.interiorShown, "the driver board is still shown")
    check(c.parts.every((p) => !p.labelShown), "labels still shown")
    check(c.detail === 0, "the driver detail still runs")
    check(main.labelsUI.shownIds().filter((id) => id.startsWith("lamp_")).length === 0, "a part label is still up")
    checkLampContact(lamp, "after reassembly")
    check(lamp.getCordDrop() === 0, () => `the cord is still ${lamp.getCordDrop()} cm down`)
    check(lamp.getCaption() === LAMP_CAPTIONS.glow, () => `caption "${lamp.getCaption()}" after reassembly with the lamp on`)
    const back = lamp.getLight()
    check(back.shadeGlow > 0.99 && back.pulseLevel > 0.5, () => `whole again, the shade glows ${f2(back.shadeGlow)} and the pulses ${f2(back.pulseLevel)}`)
    print(`Cutaway L6: reassembled; furthest part ${(c.maxRestError * 10).toFixed(3)} mm from rest; standing at L1 accuracy; the shade glows again ("${lamp.getCaption()}")`)
  }
}

function frame(lamp: LampHero): ViewFrame {
  const eye = WorldCameraFinderProvider.getInstance().getTransform().getWorldPosition()
  return viewFrame(eye, lamp.getReplica().getTransform().getWorldPosition())
}

/** The paper opens left and right as the user sees it; the driver is out on the side away from the rail, facing the user. */
function checkView(main: CutawayMain, lamp: LampHero): string {
  const F = frame(lamp)
  const axis = toView(F, lamp.getReplica().getTransform().getWorldPosition()).x
  const halves = lamp.getModel().paperHalves()
  const xa = toView(F, halves[0].so.getTransform().getWorldPosition()).x - axis
  const xb = toView(F, halves[1].so.getTransform().getWorldPosition()).x - axis
  check(xa > 3 && xb < -3, () => `the paper's halves are at ${f1(xa)} and ${f1(xb)} cm from the axis as the user sees it (not right and left)`)
  const open = lamp.getApart().open
  check(open > LAMP_GEOM.shadeMaxR, () => `the halves opened only ${f1(open)} cm each (the frame is ${f1(LAMP_GEOM.shadeMaxR)} cm round)`)
  const boxes = main.getLampRail().getBoxes()
  let rx = 0
  let n = 0
  for (const b of boxes)
    for (const q of b) {
      rx += toView(F, q).x
      n++
    }
  const railSide = n && rx / n - axis >= 0 ? 1 : -1
  const drv = lamp.getPart("LampDriver").getTransform()
  const xd = toView(F, drv.getWorldPosition()).x - axis
  check(Math.sign(xd) === -railSide && Math.abs(xd) > 1, () => `the driver is ${f1(xd)} cm from the axis, the rail on the ${railSide > 0 ? "right" : "left"}`)
  const face = drv.getWorldRotation().multiplyVec3(vec3.forward())
  const toEye = F.eye.sub(drv.getWorldPosition())
  const cosF = new vec3(face.x, 0, face.z).normalize().dot(new vec3(toEye.x, 0, toEye.z).normalize())
  check(cosF > 0.9, () => `the driver's components face ${f1((Math.acos(cosF) * 180) / Math.PI)}° away from the user`)
  return `paper open ${f1(xa)} / ${f1(xb)} cm either side, driver ${f1(Math.abs(xd))} cm out away from the rail facing the user (${f1((Math.acos(Math.min(1, cosF)) * 180) / Math.PI)}°)`
}

/** Each pair of labels (and the caption) apart, and each label clear of the rail and every visible part. */
function checkLabels(main: CutawayMain, lamp: LampHero): string {
  const F = frame(lamp)
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const quads = main.labelsUI.getTextQuads()
  const labels = quads.filter((q) => q.id.startsWith("lamp_")).map((q) => ({text: q.text, h: view(q.corners)}))
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
  const rail = main.getLampRail()
  let minPart = 1e9
  const parts = lamp
    .getModel()
    .meshList()
    .filter((m) => m.part !== "LampCord" && m.part !== "LampWires" && m.rmv.getSceneObject().isEnabledInHierarchy)
  for (const q of labels) {
    for (const b of rail.getBoxes()) check(polyGap(q.h, view(b)) > 0, () => `label "${q.text}" overlaps the rail`)
    for (const m of parts) {
      const g = polyGap(q.h, view(boxCorners(m.rmv.getSceneObject().getTransform().getWorldTransform(), m.lo, m.hi)))
      minPart = Math.min(minPart, g)
      check(g > 0, () => `label "${q.text}" overlaps ${m.part} (by ${f1(-g)} cm)`)
    }
  }
  return `${labels.length} labels, closest label-label ${f1(minLabel)} cm, label-part ${f1(minPart)} cm`
}
