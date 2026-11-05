import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {LAMP_CAPTIONS, LampHero} from "../Scripts/CutawayLampHero"
import {RAYS_FROM, SHADE_LIFT_CM} from "../Scripts/CutawayLampLight"
import {LAMP_GEOM} from "../Scripts/CutawayLampModel"
import {drag, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, soundsSince} from "./HeroTestUtils"
import {lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"

/**
 * L4 (lamp hero, the shade): with the lamp on, grabbing the shade lifts it straight up. Only its
 * height changes (it stays on the lamp's axis and level, nothing else moves, the lamp does not
 * turn), always within 0 to 25 cm above its seat. As it rises the pool on the table gets smaller
 * and its edge sharper; the bare bulb's rays appear only above 60% of the lift; the harsh-light
 * caption shows. A faint rustle as it leaves the seat and as it sets down; released, it rests on its
 * seat within 1 mm.
 */
@component
export class L4LampShadeScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    const lamp = await landLamp(main)
    await pressLampSwitch()
    await waitForPhase(main, "lamp:bulb", 3000)
    await sleep(900)
    const S = lamp.getScale()
    const shade = lamp.getPart("LampShade").getTransform()
    const seat = shade.getWorldPosition()
    const rot0 = shade.getWorldRotation()
    const fixed = ["LampBase", "LampStem", "LampSocket", "LampBulb", "LampCord", "LampSwitch"].map((n) => ({n, p: lamp.getPart(n).getTransform().getWorldPosition()}))
    const foot0 = lamp.getInfo().foot
    const yaw0 = lamp.getYawDeg()
    const rest = lamp.getLight()
    check(lamp.getShade().lift === 0 && rest.lift === 0 && rest.rays === 0, () => `before the grab: lift ${lamp.getShade().lift}, rays ${rest.rays}`)
    const restEdge = rest.tablePool.edge * rest.tablePool.radius

    // ---------------- Pushing it down: it stays on its seat ----------------
    const tDown = getTime()
    let downMax = 0
    let sampling = true
    const watchDown = async () => {
      while (sampling) {
        downMax = Math.max(downMax, shade.getWorldPosition().distance(seat), Math.abs(lamp.getShade().lift))
        await sleep(10)
      }
    }
    void watchDown()
    await drag("LampTurnGrab", new vec3(0, -0.5, 0), 500)
    sampling = false
    check(downMax < 1e-3, () => `pushed down, the shade moved ${downMax.toFixed(4)} cm`)
    check(soundsSince(main, "lamp_rustle", tDown).length === 0, "a rustle with the shade on its seat")
    check(Math.abs(lamp.getYawDeg() - yaw0) < 1e-3, () => `the lamp turned ${(lamp.getYawDeg() - yaw0).toFixed(3)}° (the shade's grab lifts while it is on)`)

    // ---------------- The lift: sampled every frame while held ----------------
    type Sample = {lift: number; radius: number; edge: number; rays: number; peak: number; caption: string | null}
    const samples: Sample[] = []
    let worst = {flat: 0, dy: 0, rot: 0, other: 0, otherName: ""}
    let held = 0
    sampling = true
    const watch = async () => {
      while (sampling) {
        const s = lamp.getShade()
        const li = lamp.getLight()
        const p = shade.getWorldPosition()
        if (s.held) {
          held++
          samples.push({lift: s.lift, radius: li.tablePool.radius, edge: li.tablePool.edge * li.tablePool.radius, rays: li.rays, peak: li.shadePeak, caption: lamp.getCaption()})
        }
        worst.flat = Math.max(worst.flat, new vec3(p.x - seat.x, 0, p.z - seat.z).length)
        worst.dy = Math.max(worst.dy, Math.abs(p.y - seat.y - s.lift))
        worst.rot = Math.max(worst.rot, 1 - Math.abs(shade.getWorldRotation().dot(rot0)))
        for (const f of fixed) {
          const d = lamp.getPart(f.n).getTransform().getWorldPosition().distance(f.p)
          if (d > worst.other) worst = {...worst, other: d, otherName: f.n}
        }
        await sleep(10)
      }
    }
    const t0 = getTime()
    void watch()
    // An upward drag well past the top (it stops at 25 cm).
    await drag("LampTurnGrab", new vec3(0, 1.2, 0), 2000)
    const tRel = lamp.getShade().releasedAt
    sampling = false
    check(held > 8 && tRel >= t0, () => `only ${held} samples while held (released at ${tRel})`)
    check(worst.flat < 0.01 && worst.rot < 1e-6, () => `the shade left its axis: ${worst.flat.toFixed(4)} cm sideways, rotation off by ${worst.rot.toExponential(2)}`)
    check(worst.dy < 0.02, () => `the shade's height and its lift disagree by ${worst.dy.toFixed(4)} cm`)
    check(worst.other < 0.01, () => `${worst.otherName} moved ${worst.other.toFixed(4)} cm while the shade lifted`)
    const lf = lamp.getInfo().foot
    check(new vec3(lf.x - foot0.x, 0, lf.z - foot0.z).length < 0.01 && Math.abs(lamp.getYawDeg() - yaw0) < 1e-3, "the lamp moved or turned while the shade lifted")
    const maxLift = Math.max(...samples.map((s) => s.lift))
    const minLift = Math.min(...samples.map((s) => s.lift))
    check(minLift >= 0 && maxLift <= SHADE_LIFT_CM + 1e-3, () => `the lift left 0…${SHADE_LIFT_CM} cm: ${minLift.toFixed(3)} … ${maxLift.toFixed(3)}`)
    check(maxLift > SHADE_LIFT_CM - 0.01, () => `it lifted only ${maxLift.toFixed(2)} cm`)

    // The pool: as the lift grows, it shrinks and its edge sharpens (never the other way).
    const byLift = samples.slice().sort((a, b) => a.lift - b.lift)
    for (let i = 1; i < byLift.length; i++) {
      const a = byLift[i - 1]
      const b = byLift[i]
      if (b.lift - a.lift < 0.05) continue
      check(b.radius < a.radius + 1e-4, () => `the pool grew from ${a.radius.toFixed(2)} to ${b.radius.toFixed(2)} cm as the lift rose ${a.lift.toFixed(2)} → ${b.lift.toFixed(2)} cm`)
      check(b.edge < a.edge + 1e-4, () => `the pool's edge widened from ${a.edge.toFixed(2)} to ${b.edge.toFixed(2)} cm as the lift rose ${a.lift.toFixed(2)} → ${b.lift.toFixed(2)} cm`)
    }
    const top = byLift[byLift.length - 1]
    check(top.radius < rest.tablePool.radius - 5 && top.edge < 0.3 * restEdge, () => `at the top the pool is ${top.radius.toFixed(1)} cm, edge ${top.edge.toFixed(2)} cm (seated ${rest.tablePool.radius.toFixed(1)}, ${restEdge.toFixed(2)})`)

    // The rays: none up to 60% of the lift, there above it, full at the top.
    for (const s of samples) {
      if (s.lift <= RAYS_FROM * SHADE_LIFT_CM) check(s.rays === 0, () => `rays at ${(s.rays * 100).toFixed(1)}% with the lift at ${((s.lift / SHADE_LIFT_CM) * 100).toFixed(1)}%`)
      else check(s.rays > 0, () => `no rays with the lift at ${((s.lift / SHADE_LIFT_CM) * 100).toFixed(1)}%`)
    }
    const above = samples.filter((s) => s.lift > RAYS_FROM * SHADE_LIFT_CM)
    const firstRays = byLift.find((s) => s.rays > 0)
    check(above.length >= 3 && top.rays > 0.9, () => `rays at the top ${top.rays.toFixed(2)} (${above.length} samples above 60%)`)
    // The paper glows less as it leaves the bulb; the harsh-light caption is up.
    check(top.peak < 0.35, () => `the paper still glows at ${top.peak.toFixed(2)} lifted`)
    check(above.some((s) => s.caption === LAMP_CAPTIONS.harsh), () => `caption lifted: "${above.length ? above[above.length - 1].caption : lamp.getCaption()}"`)
    // A rustle as it left the seat, from the shade.
    const up = soundsSince(main, "lamp_rustle", t0).filter((s) => s.time < tRel)
    check(up.length === 1, () => `rustles on lifting: ${up.length}`)
    const ax = new vec3(up[0].position.x - foot0.x, 0, up[0].position.z - foot0.z).length
    check(ax < 1 && up[0].position.y > seat.y && up[0].position.y < seat.y + (LAMP_GEOM.height - LAMP_GEOM.shadeSeatY) * S + 2, () => `the rustle came from ${up[0].position} (${ax.toFixed(2)} cm off the axis)`)
    print(`Cutaway L4: lifted 0 → ${maxLift.toFixed(2)} cm (held ${samples.length} frames): pool ${rest.tablePool.radius.toFixed(1)} → ${top.radius.toFixed(1)} cm, edge ${restEdge.toFixed(2)} → ${top.edge.toFixed(2)} cm; rays from ${firstRays ? ((firstRays.lift / SHADE_LIFT_CM) * 100).toFixed(1) : "-"}% of the lift (${top.rays.toFixed(2)} at the top); paper glow ${top.peak.toFixed(2)} of seated; off-axis ${worst.flat.toFixed(4)} cm`)

    // ---------------- Released: lowered back onto its seat ----------------
    await waitUntil(() => !lamp.getShade().settling && lamp.getShade().lift === 0, 800, () => `still ${lamp.getShade().lift.toFixed(3)} cm up`)
    const tSeat = getTime()
    await sleep(150)
    const gap = shade.getWorldPosition().distance(seat)
    check(gap < 0.1, () => `the shade rests ${(gap * 10).toFixed(2)} mm from its seat`)
    const down = soundsSince(main, "lamp_rustle", tRel)
    check(down.length === 1, () => `rustles on setting down: ${down.length}`)
    const li = lamp.getLight()
    check(li.lift === 0 && li.rays === 0 && Math.abs(li.tablePool.radius - rest.tablePool.radius) < 1e-3 && Math.abs(li.tablePool.edge - rest.tablePool.edge) < 1e-3, () => `seated again: lift ${li.lift}, rays ${li.rays}, pool ${li.tablePool.radius.toFixed(2)} cm edge ${li.tablePool.edge.toFixed(3)}`)
    check(li.shadePeak > 0.999, () => `seated again, the paper glows at ${li.shadePeak.toFixed(3)}`)
    check(lamp.getCaption() !== LAMP_CAPTIONS.harsh, "the harsh-light caption stayed with the shade back on")
    print(`Cutaway L4: released, seated ${((tSeat - tRel) * 1000).toFixed(0)} ms later, ${(gap * 10).toFixed(3)} mm from its seat; rustle on setting down; the light soft again ("${lamp.getCaption()}")`)
    checkWhole(lamp)
  }
}

/** The lamp still on and whole after the lift. */
function checkWhole(lamp: LampHero): void {
  check(lamp.lightOn && lamp.state === "landed", () => `after the lift: light on ${lamp.lightOn}, state ${lamp.state}`)
}
