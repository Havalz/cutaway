import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {RP_CUE_CM} from "../Scripts/CutawayRpDeck"
import {RecordPlayerHero} from "../Scripts/CutawayRpHero"
import {RP_GEOM} from "../Scripts/CutawayRecordPlayerModel"
import {drag, getMain, waitForPhase, waitUntil} from "./CutawayTestUtils"
import {check, phaseCount, soundsSince} from "./HeroTestUtils"
import {armSwingDir, landRp, measureRpm, PlatterMeter, rpCleanStart} from "./RpHeroTestUtils"

const RPM = 100 / 3

/**
 * R3 (record player hero, the needle drop). Dragging the tonearm by its finger lift changes only its
 * rotation about its pivot, within its limits (between its rest and the record's inner groove; lifted
 * no higher than the cueing height). Released over the record, the stylus lowers onto it (within 1 mm)
 * and the platter turns at 33⅓ rpm ±1% within 1.5 s. Released anywhere else, the arm goes back to its rest.
 */
@component
export class R3RpNeedleScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await rpCleanStart(main)
    const rp = await landRp(main)
    const deck = rp.getDeck()
    check(!!deck, "no deck on the copy")
    const meter = new PlatterMeter(this, rp)
    try {
      // On landing: the placement caption, and the rail's first row only.
      check(rp.getCaptionStage() === 0, () => `caption stage ${rp.getCaptionStage()} on landing`)
      const rv = main.getRpRailVisual()
      check(rv.apart && rv.putBack && !rv.loudness && !rv.pitch, () => `rail on landing: ${JSON.stringify(rv)}`)
      check(deck.atRest && deck.yaw === 0 && deck.lift === 0 && deck.omega === 0, "the arm is not on its rest at landing")
      const ref = snapshot(rp)

      // --- Released elsewhere: a drag away from the record (and up) only lifts it on its rest ---
      const away = armSwingDir(rp, false)
      const s1 = watchArm(rp, ref)
      await drag("RpArmGrab", away.uniformScale(0.25).add(new vec3(0, 0.06, 0)), 500)
      s1.stop()
      s1.check("away drag")
      check(s1.maxLift > 0.5, () => `the arm only rose ${s1.maxLift.toFixed(2)} cm when picked up`)
      check(s1.minYaw > -1e-6, () => `an away drag swung it to ${(s1.minYaw / (Math.PI / 180)).toFixed(2)}°`)
      await waitUntil(() => deck.atRest, 1500, () => `the arm did not go back to its rest (mode ${deck.mode})`)
      check(Math.abs(deck.yaw) < 1e-6 && Math.abs(deck.lift) < 1e-6, () => `back on its rest at yaw ${deck.yaw}, lift ${deck.lift}`)
      check(phaseCount(main, "rp:armReturn") === 1, "no rp:armReturn after a release off the record")
      check(phaseCount(main, "rp:needleDown") === 0, "the needle dropped after a release off the record")
      const still = await measureRpm(meter, 400)
      check(still < 0.01, () => `the platter turned at ${still.toFixed(3)} rpm with the arm on its rest`)
      print(`Cutaway R3: released off the record (lift ${s1.maxLift.toFixed(2)} cm): back on its rest, platter still`)

      // --- Over the record: swing it in (it stops at the inner groove), lowered by hand to its limit ---
      const toward = armSwingDir(rp, true)
      const s2 = watchArm(rp, ref)
      const t0 = getTime()
      await drag("RpArmGrab", toward.uniformScale(0.8).add(new vec3(0, -0.04, 0)), 1200)
      s2.stop()
      s2.check("swing over the record")
      check(Math.abs(s2.minYaw - deck.yawInner) < 1e-4, () => `the swing stopped at ${(s2.minYaw / (Math.PI / 180)).toFixed(2)}°, not the inner groove (${(deck.yawInner / (Math.PI / 180)).toFixed(2)}°)`)
      check(s2.minLift > 0.2 - 1e-6, () => `held, the stylus came down to ${(s2.minLift * 10).toFixed(2)} mm above the record`)
      check(phaseCount(main, "rp:armDrop") === 1, "no rp:armDrop on a release over the record")
      await waitForPhase(main, "rp:needleDown", 1500)
      const tDown = getTime()

      // The stylus is on the record (world, at the copy's scale) and over its grooves.
      const tip = rp.stylusWorld()
      const top = rp.recordTopWorld()
      const gap = tip.y - top.y
      check(gap >= -0.01 && gap <= 0.1, () => `stylus ${(gap * 10).toFixed(2)} mm from the record top`)
      const r = new vec3(tip.x - top.x, 0, tip.z - top.z).length / rp.getScale()
      check(r >= RP_GEOM.grooveInner - 0.01 && r <= RP_GEOM.grooveOuter + 0.01, () => `stylus at radius ${r.toFixed(2)} cm, off the grooves`)
      const crackle = soundsSince(main, "rp_crackle", t0)
      check(crackle.length === 1, () => `${crackle.length} needle-drop crackles`)
      check(crackle[0].position.distance(tip) < 0.5, () => `the crackle played ${crackle[0].position.distance(tip).toFixed(2)} cm from the stylus`)

      // 33⅓ rpm ±1% within 1.5 s of the touchdown (measured from the platter's transform), and steady.
      await sleep(Math.max(0, 1000 - (getTime() - tDown) * 1000))
      const rpm1 = await measureRpm(meter, 500)
      const by = getTime() - tDown
      check(by <= 1.55, () => `measured only by ${by.toFixed(2)} s`)
      check(Math.abs(rpm1 - RPM) / RPM <= 0.01, () => `${rpm1.toFixed(3)} rpm 1.0–${by.toFixed(2)} s after touchdown`)
      const rpm2 = await measureRpm(meter, 1500)
      check(Math.abs(rpm2 - RPM) / RPM <= 0.01, () => `${rpm2.toFixed(3)} rpm once running`)
      const tip2 = rp.stylusWorld()
      check(Math.abs(tip2.y - top.y) <= 0.1, () => `while playing the stylus is ${((tip2.y - top.y) * 10).toFixed(2)} mm from the record`)
      check(rp.getInfo().pose === "rest", "the copy left its rest")
      const after = snapshot(rp)
      check(after.foot.distance(ref.foot) < 1e-3 && after.yaw === ref.yaw, "the copy moved while the arm was dragged")
      print(`Cutaway R3: stylus ${(gap * 10).toFixed(2)} mm from the record at r = ${r.toFixed(2)} cm; ${rpm1.toFixed(3)} rpm by ${by.toFixed(2)} s, ${rpm2.toFixed(3)} rpm running`)
    } finally {
      meter.stop()
    }
  }
}

interface Snap {
  foot: vec3
  yaw: number
  armPos: vec3
  liftPos: vec3
  tipToPivot: number
}

function snapshot(rp: RecordPlayerHero): Snap {
  return {
    foot: rp.getInfo().foot,
    yaw: rp.getYawDeg(),
    armPos: rp.getPart("RpTonearm").getTransform().getLocalPosition(),
    liftPos: rp.getPart("RpTonearmLift").getTransform().getLocalPosition(),
    tipToPivot: rp.stylusWorld().distance(rp.pivotWorldForTest())
  }
}

/**
 * While a drag runs: the arm only turns about its pivot (yaw about the vertical, lift about the
 * bearing's horizontal axis), stays within its limits, and nothing else of the copy moves.
 */
function watchArm(rp: RecordPlayerHero, ref: Snap): {stop: () => void; check: (what: string) => void; minYaw: number; maxLift: number; minLift: number} {
  const deck = rp.getDeck()
  const out = {
    on: true,
    minYaw: 0,
    maxLift: 0,
    minLift: Infinity,
    errs: [] as string[],
    stop: () => (out.on = false),
    check: (what: string) => {
      if (out.errs.length) throw new Error(`${what}: ${out.errs[0]}`)
    }
  }
  let risen = false
  const loop = async () => {
    while (out.on) {
      const arm = rp.getPart("RpTonearm").getTransform()
      const lift = rp.getPart("RpTonearmLift").getTransform()
      const yawUp = arm.getLocalRotation().multiplyVec3(vec3.up())
      const liftX = lift.getLocalRotation().multiplyVec3(vec3.right())
      if (arm.getLocalPosition().distance(ref.armPos) > 1e-4 || lift.getLocalPosition().distance(ref.liftPos) > 1e-4) out.errs.push("the arm's pivot moved")
      if (yawUp.dot(vec3.up()) < 0.99999) out.errs.push(`the arm tilted about its yaw (up = ${yawUp})`)
      if (liftX.dot(vec3.right()) < 0.99999) out.errs.push(`the arm rolled about its lift (x = ${liftX})`)
      const d = rp.stylusWorld().distance(rp.pivotWorldForTest())
      if (Math.abs(d - ref.tipToPivot) > 0.01) out.errs.push(`the stylus is ${d.toFixed(3)} cm from the pivot, not ${ref.tipToPivot.toFixed(3)}`)
      if (deck.yaw > 1e-6 || deck.yaw < deck.yawInner - 1e-6) out.errs.push(`yaw ${deck.yaw} outside [${deck.yawInner}, 0]`)
      if (deck.lift > RP_CUE_CM + 1e-6 || deck.lift < -1e-6) out.errs.push(`lift ${deck.lift} outside [0, ${RP_CUE_CM}]`)
      const foot = rp.getInfo().foot
      if (foot.distance(ref.foot) > 1e-3 || rp.getYawDeg() !== ref.yaw) out.errs.push("the copy moved")
      out.minYaw = Math.min(out.minYaw, deck.yaw)
      out.maxLift = Math.max(out.maxLift, deck.lift)
      // Once risen from where it was picked up, the held stylus stays clear of the record.
      if (deck.mode === "held" && deck.lift >= 0.25 - 1e-6) risen = true
      if (deck.mode === "held" && risen) out.minLift = Math.min(out.minLift, deck.lift)
      await sleep(30)
    }
  }
  void loop()
  return out
}
