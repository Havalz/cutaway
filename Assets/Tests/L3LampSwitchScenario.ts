import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {CutawayMain} from "../Scripts/CutawayMain"
import {LAMP_CAPTIONS, LampHero} from "../Scripts/CutawayLampHero"
import {LAMP_GEOM} from "../Scripts/CutawayLampModel"
import {getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, soundsSince} from "./HeroTestUtils"
import {expectLampDark, getLamp, lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"

/**
 * L3 (lamp hero, the switch): pinching the copy's foot switch turns the lamp on. The button goes
 * down with a click from the switch; the pulses run from the switch along the cord (and up the stem
 * into the bulb); the bubble opens at the LED chips and shows the blue chip, its coating and the
 * light; the shade glows (brightest level with the bulb, fading with height); the thread runs from
 * the copy's cord to the real lamp, and the real lamp's glow and its floor pool come on. Pinching
 * it again turns all of these off within 0.5 s.
 */
@component
export class L3LampSwitchScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    const lamp = await landLamp(main)
    check(!lamp.lightOn, "the lamp is on before the switch was pinched")
    check(lamp.getCaption() === LAMP_CAPTIONS.press, () => `caption is "${lamp.getCaption()}"`)
    const rail0 = main.getLampRailVisual()
    check(!rail0.brightness && !rail0.warmth, "Brightness or Warmth shows before the lamp is on")

    // ---------------- On ----------------
    const btn = lamp.getPart("LampSwitchButton").getTransform()
    const yUp = btn.getWorldPosition().y
    const t0 = getTime()
    // The button goes down (stroke), then rests a little lower (latched on); a click from the switch.
    let yMin = yUp
    let sampling = true
    const watch = async () => {
      while (sampling) {
        yMin = Math.min(yMin, btn.getWorldPosition().y)
        await sleep(10)
      }
    }
    void watch()
    await pressLampSwitch()
    await waitForPhase(main, "lamp:on", 500)
    // The current: two looks 150 ms apart, its front moving out from the switch.
    const a = lamp.getLight()
    await sleep(150)
    const b = lamp.getLight()
    const tb = getTime() - lamp.getLightTimes().on
    await sleep(200)
    sampling = false
    const S = lamp.getScale()
    check(yUp - yMin > 0.3 * S, () => `the button moved down only ${((yUp - yMin) / S).toFixed(3)} cm (model)`)
    check(btn.getWorldPosition().y < yUp - 0.05 * S && lamp.getButtonDepth() > 0.05, () => `the button is not latched down while on (depth ${lamp.getButtonDepth().toFixed(3)})`)
    const clicks = soundsSince(main, "lamp_click", t0)
    check(clicks.length === 1, () => `clicks: ${clicks.length}`)
    const swTop = lamp.getModel().switchButtonTop()
    check(clicks[0].position.distance(swTop) < 1.5, () => `the click is ${clicks[0].position.distance(swTop).toFixed(2)} cm from the switch`)
    await waitUntil(() => main.getLampRailVisual().brightness && main.getLampRailVisual().warmth, 1000, () => `the rail does not show Brightness and Warmth: ${JSON.stringify(main.getLampRailVisual())}`)
    check(lamp.getCaption() === LAMP_CAPTIONS.flow, () => `caption is "${lamp.getCaption()}"`)

    // The current: from the switch, its front moving along the cord, packets on the cord.
    check(b.phase === "flow" || b.phase === "lit", () => `phase ${b.phase}`)
    check(b.front > a.front && b.front > 0, () => `the current's front is not moving (${a.front.toFixed(3)} → ${b.front.toFixed(3)})`)
    const sw = lamp.getPart("LampSwitch").getTransform().getWorldPosition()
    check(b.pathStart.distance(sw) < 4 * S + 1, () => `the current starts ${b.pathStart.distance(sw).toFixed(2)} cm from the switch`)
    check(b.pathEnd.distance(lamp.getModel().ledCenter()) < 0.5, () => `the current ends ${b.pathEnd.distance(lamp.getModel().ledCenter()).toFixed(2)} cm from the LED chips`)
    check(b.packets.length >= 1 && b.pulseLevel > 0.9, () => `no pulses on the cord (${b.packets.length} packets, level ${b.pulseLevel.toFixed(2)})`)
    // Every pulse is on the current's path (cord, base, stem); at least one is still on the cord.
    const cord = cordWorld(lamp)
    const whole = pathWorld(lamp)
    for (const p of b.packets) {
      const d = nearest(whole, p)
      check(d < 0.8, () => `a pulse is ${d.toFixed(2)} cm off the current's path`)
    }
    check(b.packets.some((p) => nearest(cord, p) < 0.8), "no pulse on the cord")
    print(`Cutaway L3: current leaves the switch; ${tb.toFixed(2)} s after it: front ${(b.front * 100).toFixed(0)}% of ${b.pathLength.toFixed(1)} cm (was ${(a.front * 100).toFixed(0)}% 150 ms before), ${b.packets.length} pulse(s) on the path`)

    // ---------------- The bulb lights, the bubble shows the chip ----------------
    await waitForPhase(main, "lamp:bulb", 3000)
    const tBulb = lamp.getLightTimes().bulb - lamp.getLightTimes().on
    const rise = soundsSince(main, "lamp_rise", t0)
    check(rise.length === 1, () => `power-up tones: ${rise.length}`)
    check(rise[0].position.distance(lamp.getModel().ledCenter()) < 1, () => `the power-up tone is ${rise[0].position.distance(lamp.getModel().ledCenter()).toFixed(2)} cm from the bulb`)
    check(lamp.getCaption() === LAMP_CAPTIONS.chip, () => `caption is "${lamp.getCaption()}"`)
    await waitUntil(() => lamp.getLight().bubbleOpen > 0.99, 600, () => `the bubble is ${lamp.getLight().bubbleOpen.toFixed(2)} open`)
    await sleep(700)
    const c = lamp.getLight()
    check(c.chipShown, "the bubble does not show the chip")
    check(c.chipColor.z > 0.9 && c.chipColor.z > c.chipColor.x + 0.4, () => `the chip is not blue: ${c.chipColor}`)
    check(c.photonsBlue > 0 && c.photonsYellow > 0, () => `photons in the bubble: ${c.photonsBlue} blue, ${c.photonsYellow} yellow`)
    check(c.led > 0.99, () => `LED at ${c.led.toFixed(2)}`)
    // The shade glows: fully on, brightest level with the bulb, fading with height up the paper.
    check(c.shadeGlow > 0.99, () => `the shade glow is at ${c.shadeGlow.toFixed(2)}`)
    const pr = c.shadeProfile
    check(pr.bulb > 3 * pr.top && pr.bulb > pr.bottom, () => `the glow is not brightest near the bulb: ${JSON.stringify(pr)}`)
    check(c.tablePool.level > 0.99, () => `the pool on the table is at ${c.tablePool.level.toFixed(2)}`)
    print(`Cutaway L3: bulb lit ${tBulb.toFixed(2)} s after the pinch; bubble: chip ${c.chipColor}, ${c.photonsBlue} blue and ${c.photonsYellow} yellow photons; shade glow at the bulb ${pr.bulb.toFixed(2)}, top ${pr.top.toFixed(2)}, bottom ring ${pr.bottom.toFixed(2)}`)

    // ---------------- The real lamp ----------------
    await waitForPhase(main, "lamp:realOn", 3000)
    await sleep(700)
    const d = lamp.getLight()
    check(d.threadReached && d.threadFront > 0.999, () => `the thread has covered ${(d.threadFront * 100).toFixed(0)}%`)
    const plug = lamp.getReplica().getTransform().getWorldTransform().multiplyPoint(LAMP_GEOM.plugAt)
    check(d.threadStart.distance(plug) < 2, () => `the thread starts ${d.threadStart.distance(plug).toFixed(2)} cm from the copy's plug`)
    const bulb = realBulb(main)
    check(d.threadEnd.distance(bulb) < 2, () => `the thread ends ${d.threadEnd.distance(bulb).toFixed(2)} cm from the real lamp's bulb`)
    check(d.realGlow > 0.99 && d.floorPool > 0.99, () => `the real lamp: glow ${d.realGlow.toFixed(2)}, floor pool ${d.floorPool.toFixed(2)}`)
    await waitUntil(() => lamp.getCaption() === LAMP_CAPTIONS.glow, 3000, () => `caption is "${lamp.getCaption()}"`)
    const lt = lamp.getLightTimes()
    print(`Cutaway L3: the real lamp on ${(lt.realOn - lt.on).toFixed(2)} s after the pinch; thread from the plug to ${d.threadEnd.distance(bulb).toFixed(2)} cm of the real bulb`)

    // ---------------- Off within 0.5 s ----------------
    const t1 = getTime()
    await pressLampSwitch()
    await waitForPhase(main, "lamp:off", 300)
    await waitUntil(() => lamp.getLight().phase === "off", 700, () => `still ${lamp.getLight().phase} after the pinch`)
    const ot = lamp.getLightTimes()
    const tOff = ot.dark - ot.off
    check(ot.off >= t1 && tOff > 0 && tOff <= 0.5, () => `dark ${(tOff * 1000).toFixed(0)} ms after the switch was pinched off (max 500)`)
    expectLampDark(main, "after switching off")
    check(soundsSince(main, "lamp_click", t1).length === 1, "no click on switching off")
    await sleep(300)
    check(lamp.getButtonDepth() < 1e-3, () => `the button stays down (${lamp.getButtonDepth().toFixed(3)} cm) after switching off`)
    check(lamp.getCaption() === LAMP_CAPTIONS.press, () => `caption is "${lamp.getCaption()}"`)
    print(`Cutaway L3: off ${(tOff * 1000).toFixed(0)} ms after the pinch: pulses, bubble, glows, thread, real lamp and floor pool gone`)
  }
}

/** The cord's centre line in world space (base to switch to plug). */
function cordWorld(lamp: LampHero): vec3[] {
  const m = lamp.getReplica().getTransform().getWorldTransform()
  const path = lamp.getModel().currentPath()
  const out: vec3[] = []
  // The current's path on the table: the points that lie on the cord (below the base's rim).
  for (const p of path) if (p.y < 1) out.push(m.multiplyPoint(p))
  for (const p of lamp.getModel().plugRun()) out.push(m.multiplyPoint(p))
  return out
}

/** The current's whole path in world space (switch, cord, base, stem, bulb). */
function pathWorld(lamp: LampHero): vec3[] {
  const m = lamp.getReplica().getTransform().getWorldTransform()
  return lamp.getModel().currentPath().map((p) => m.multiplyPoint(p))
}

/** Distance from p to a polyline. */
function nearest(pts: vec3[], p: vec3): number {
  let best = 1e9
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const ab = pts[i].sub(a)
    const L2 = ab.dot(ab)
    const t = L2 > 1e-9 ? Math.max(0, Math.min(1, p.sub(a).dot(ab) / L2)) : 0
    best = Math.min(best, a.add(ab.uniformScale(t)).distance(p))
  }
  return best
}

function realBulb(main: CutawayMain): vec3 {
  return main.getMarkerPosition("bulb")
}
