import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {LAMP_CAPTIONS, LampHero} from "../Scripts/CutawayLampHero"
import {ROOM_LAMP} from "../Scripts/CutawayLampModel"
import {drag, getMain, isEnabled, KEYS, press, SETTLE_MS, softReset, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check} from "./HeroTestUtils"
import {expectLampGone, getLamp, lampCleanStart, landLamp, launchLampViaQuestion, pressLampSwitch, waitLampHome} from "./LampHeroTestUtils"

const f2 = (x: number) => x.toFixed(2)

/**
 * L7 (lamp hero, put it back and Reset; the same as the camera's H6). "Put it back" first switches
 * the lamp off (the shade's glow, the pool, the real lamp's glow and floor pool fade out) and brings
 * everything home (the parts together, the shade on its seat); only then the copy lifts, flies home
 * growing back to scale 1 and melts into the real lamp: no copy, light, real-lamp glow, floor pool,
 * labels, rail or caption remain, and the lamp stays explained. Reset from each step (launching, lit,
 * apart and lit, the shade coming down, flying home) clears the stage the same way and every object
 * goes back to idle; a fresh copy then starts whole and dark.
 */
@component
export class L7LampPutBackResetScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)

    // ---------------- Put it back while lit, the real lamp on ----------------
    let lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:realOn", 4000)
    await sleep(800)
    const lit = lamp.getLight()
    check(lit.realGlow > 0.99 && lit.floorPool > 0.99 && lit.shadeGlow > 0.99, () => `not fully lit before Put it back: real ${f2(lit.realGlow)}, floor ${f2(lit.floorPool)}, shade ${f2(lit.shadeGlow)}`)
    const watch = watchReturn(main, lamp)
    await press("LampRailPutBack")
    await waitForPhase(main, "lamp:putBack", 500)
    await waitForPhase(main, "lamp:ready", 3000)
    watch.atReady()
    await waitLampHome(main)
    watch.stop()
    watch.check()
    expectLampGone(main)
    expectNoLampCaption(main)
    expectExplained(main)
    print(`Cutaway L7: put back while lit: dark ${f2(watch.readyAfter())} s after the pinch (glows fading ${watch.fadeSummary()}), then lifted, flew home and grew to scale ${watch.maxScale().toFixed(3)}, melting ${f2(watch.endGap())} cm from the real lamp's origin`)

    // ---------------- Put it back from apart, lit: the parts gather first ----------------
    await softReset(main)
    lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    main.getLampRail().setValue("apart", 1)
    await waitUntil(() => lamp.getApart().live, 4000)
    await waitForPhase(main, "lamp:driverCaption", 1500)
    const watch2 = watchReturn(main, lamp)
    await press("LampRailPutBack")
    check(main.labelsUI.shownIds().filter((id) => id.startsWith("lamp_")).length === 0, "the part labels stayed up after Put it back")
    await waitForPhase(main, "lamp:ready", 4000)
    watch2.atReady()
    const g = lamp.getApart()
    check(g.s === 0 && !g.interiorShown && g.detail === 0, () => `not together before the flight: s ${g.s}, interior ${g.interiorShown}, driver detail ${g.detail}`)
    await waitLampHome(main)
    watch2.stop()
    watch2.check()
    expectLampGone(main)
    expectNoLampCaption(main)
    expectExplained(main)
    print(`Cutaway L7: put back from apart: parts together and dark ${f2(watch2.readyAfter())} s after the pinch, the copy still at its hover until then; then home at scale ${watch2.maxScale().toFixed(3)}`)

    // ---------------- Put it back as the shade comes down: it is seated first ----------------
    // The simulated hand has just let go of the shade and is still finishing its drag (it cannot
    // pinch the pill until then), so this calls what the rail's "Put it back" pill calls.
    await softReset(main)
    lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    const lifting = drag("LampTurnGrab", new vec3(0, 1.2, 0), 900)
    await waitUntil(() => lamp.getShade().settling, 2500, () => `the shade was not let go (lift ${f2(lamp.getShade().lift)})`)
    const up = lamp.getShade().lift
    check(up > 0, "the shade was already seated")
    lamp.putBack()
    await handFree(lifting)
    await waitForPhase(main, "lamp:ready", 3000)
    const log = main.getPhaseLog()
    check(log.indexOf("lamp:shadeSeated") >= 0 && log.indexOf("lamp:shadeSeated") < log.indexOf("lamp:ready"), "the shade was not seated before the copy lifted")
    check(lamp.getShade().lift === 0 && !lamp.getShade().settling, () => `the shade is ${f2(lamp.getShade().lift)} cm up as it lifts off`)
    await waitLampHome(main)
    expectLampGone(main)
    print(`Cutaway L7: put back with the shade coming down (${f2(up)} cm up): seated before the flight, then home`)

    // ---------------- Reset from each step ----------------
    await softReset(main)
    await launchLampViaQuestion(main)
    await waitForPhase(main, "lamp:flight", 2500)
    await resetAndCheck(main, "launching")

    await softReset(main)
    lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:realOn", 4000)
    await resetAndCheck(main, "lit with the real lamp on")

    await softReset(main)
    lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:bulb", 4000)
    main.getLampRail().setValue("apart", 0.7)
    await waitForPhase(main, "lamp:hover", 2000)
    await sleep(600)
    await resetAndCheck(main, "apart and lit")

    await softReset(main)
    lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:scatter", 6000)
    // As above, the hand is still finishing its drag: this calls what the Reset pill calls.
    const raising = drag("LampTurnGrab", new vec3(0, 1.2, 0), 900)
    await waitUntil(() => lamp.getShade().settling, 2500, () => `the shade was not let go (lift ${f2(lamp.getShade().lift)})`)
    const sh = lamp.getShade()
    check(sh.lift > 0, "the shade was already seated")
    main.resetAll()
    await handFree(raising)
    await resetNow(main, `the shade coming down (${f2(sh.lift)} cm up)`, false)

    await softReset(main)
    lamp = await landLamp(main)
    await press("LampRailPutBack")
    await waitForPhase(main, "lamp:ready", 2000)
    await sleep(700)
    check(lamp.state === "returning", () => `not flying home (${lamp.state})`)
    await resetAndCheck(main, "flying home")

    // And the stage launches again cleanly afterwards: whole, dark, on the table.
    await softReset(main)
    lamp = await landLamp(main)
    expect(lamp.state).toBe("landed")
    const fresh = lamp.getLight()
    check(!lamp.lightOn && fresh.phase === "off" && lamp.getApart().s === 0 && lamp.getShade().lift === 0 && lamp.getCordDrop() === 0, () => `a fresh copy did not start whole and dark: light ${fresh.phase}, apart ${lamp.getApart().s}, shade ${lamp.getShade().lift}`)
    check(lamp.getCaption() === LAMP_CAPTIONS.press, () => `a fresh copy's caption is "${lamp.getCaption()}"`)
    print(`Cutaway L7: Reset cleared the stage while launching, lit, apart, with the shade coming down and flying home; a fresh copy starts whole and dark`)
  }
}

/** The simulated hand's drag finishing (at most 1.5 s: its target may be gone by then). */
async function handFree(p: Promise<void>): Promise<void> {
  await Promise.race([p, sleep(1500)])
}

function expectExplained(main: CutawayMain): void {
  expect(main.getStationState("lamp")).toBe("explained")
  check(main.isExplained("lamp"), "the lamp is not explained after Put it back")
  check(main.getStationVisual("lamp").explainedDot, "the lamp has no explained dot")
}

function expectNoLampCaption(main: CutawayMain): void {
  const c = main.labelsUI.captionText()
  const mine = Object.keys(LAMP_CAPTIONS).map((k) => (LAMP_CAPTIONS as {[k: string]: string})[k])
  check(c === null || mine.indexOf(c) < 0, () => `the lamp's caption "${c}" is still up`)
}

async function resetAndCheck(main: CutawayMain, what: string): Promise<void> {
  main.lookAway()
  await sleep(300)
  await resetNow(main, what)
}

/** Pinch Reset (already showing; `pinch` false: already reset) and check everything is gone and idle. */
async function resetNow(main: CutawayMain, what: string, pinch: boolean = true): Promise<void> {
  if (pinch) {
    check(isEnabled("ResetPill"), () => `${what}: the Reset pill is not shown`)
    await press("ResetPill")
  }
  await sleep(SETTLE_MS)
  expectLampGone(main)
  expectNoLampCaption(main)
  for (const key of KEYS) expect(main.getStationState(key)).toBe("idle")
  main.setGazeOverride(null)
}

/**
 * From the pinch on: until "lamp:ready" the copy stays where it is and the light fades (the real
 * lamp's glow and floor pool and the shade's glow never brighten, and are gone at "lamp:ready");
 * after it the copy grows back to scale 1 (never shrinking) and ends at the real lamp.
 */
function watchReturn(
  main: CutawayMain,
  lamp: LampHero
): {atReady: () => void; stop: () => void; check: () => void; readyAfter: () => number; maxScale: () => number; endGap: () => number; fadeSummary: () => string} {
  const errs: string[] = []
  // Where the copy is when "Put it back" is pinched (it may be bobbing at its hover until then).
  let at: vec3 | null = null
  let on = true
  let t0 = -1
  let tReady = -1
  let prev = {real: 2, floor: 2, shade: 2}
  let first: {real: number; floor: number; shade: number} | null = null
  let sPrev = 0
  let sMax = 0
  let last: vec3 | null = null
  const loop = async () => {
    while (on) {
      const log = main.getPhaseLog()
      const rep = lamp.getReplica()
      if (t0 < 0 && log.indexOf("lamp:putBack") >= 0) {
        t0 = getTime()
        if (rep) at = rep.getTransform().getWorldPosition()
      }
      const ready = log.indexOf("lamp:ready") >= 0
      if (t0 >= 0 && !ready && rep && at) {
        const p = rep.getTransform().getWorldPosition()
        if (p.distance(at) > 0.01) errs.push(`the copy moved ${p.distance(at).toFixed(2)} cm before the light was off`)
        const li = lamp.getLight()
        if (li) {
          const now = {real: li.realGlow, floor: li.floorPool, shade: li.shadeGlow}
          if (!first) first = now
          for (const k of ["real", "floor", "shade"] as ("real" | "floor" | "shade")[]) if (now[k] > prev[k] + 1e-3) errs.push(`the ${k} glow brightened (${prev[k].toFixed(3)} → ${now[k].toFixed(3)}) while it was switching off`)
          prev = now
        }
      }
      if (ready && rep) {
        const s = rep.getTransform().getWorldScale().x
        if (s < sPrev - 1e-4) errs.push(`the copy shrank on the way home (${sPrev.toFixed(4)} → ${s.toFixed(4)})`)
        sPrev = s
        sMax = Math.max(sMax, s)
        last = rep.getTransform().getWorldPosition()
      }
      await sleep(16)
    }
  }
  void loop()
  return {
    atReady: () => {
      tReady = getTime()
      const li = lamp.getLight()
      if (!li || li.phase !== "off" || li.realGlow !== 0 || li.floorPool !== 0 || li.shadeGlow !== 0 || li.led !== 0) errs.push(`at lamp:ready the light is ${li ? li.phase : "?"} (real ${li ? li.realGlow : "?"}, floor ${li ? li.floorPool : "?"})`)
      for (const n of ["LampRealGlow", "LampRealBloom", "LampFloorPool", "LampShadeGlow", "LampTablePool"]) if (findSceneObjectByName(n) !== undefined) errs.push(`${n} is still in the scene as it lifts`)
    },
    stop: () => (on = false),
    check: () => {
      if (errs.length) throw new Error(errs[0])
      if (sMax < 0.99) throw new Error(`it grew only to scale ${sMax.toFixed(3)} on the way home`)
      if (!last || last.distance(ROOM_LAMP.origin) > 1) throw new Error(`it ended ${last ? last.distance(ROOM_LAMP.origin).toFixed(2) : "?"} cm from the real lamp`)
      const log = main.getPhaseLog()
      if (log.indexOf("lamp:off") < 0 || log.indexOf("lamp:off") > log.indexOf("lamp:ready")) throw new Error("the lamp did not switch off before the copy lifted")
    },
    readyAfter: () => tReady - t0,
    maxScale: () => sMax,
    endGap: () => (last ? last.distance(ROOM_LAMP.origin) : -1),
    fadeSummary: () => (first ? `real ${f2(first.real)}, floor ${f2(first.floor)}, shade ${f2(first.shade)} → 0` : "-")
  }
}
