import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {LAMP_CAPTIONS} from "../Scripts/CutawayLampHero"
import {kelvinToWarmth, LampLightInfo} from "../Scripts/CutawayLampLight"
import {getMain, waitForPhase} from "./CutawayTestUtils"
import {check, phaseCount} from "./HeroTestUtils"
import {lampCleanStart, landLamp, pressLampSwitch} from "./LampHeroTestUtils"

/**
 * L5 (lamp hero, live sliders). Raising Brightness raises the pulses (rate and density), the LED,
 * the shade glow, the pool and the real lamp's glow and floor pool together; Brightness 0 draws
 * nothing (the same as off). At 2700, 4000 and 6500 K the emitted colour of the miniature (its shade
 * glow, the pool, the bubble's white light) and of the real lamp (glow and floor pool) matches the
 * reported formula within 2% per channel, checked against this file's own Kang et al. (2002)
 * implementation; the coating's share grows as the light warms; the first Warmth move shows
 * "More coating, warmer light." once.
 */
@component
export class L5LampSlidersScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await lampCleanStart(main)
    const lamp = await landLamp(main)
    const rail = main.getLampRail()
    await pressLampSwitch()
    await waitForPhase(main, "lamp:realOn", 4000)
    await waitForPhase(main, "lamp:scatter", 4000)
    await sleep(700)
    check(phaseCount(main, "lamp:warmCaption") === 0, "the Warmth caption showed before Warmth moved")
    check(lamp.getCaption() === LAMP_CAPTIONS.glow, () => `caption is "${lamp.getCaption()}"`)

    // ---------------- Brightness: everything rises together ----------------
    const levels: {b: number; li: LampLightInfo}[] = []
    for (const b of [0.25, 0.5, 0.75, 1]) {
      rail.setValue("brightness", b)
      await sleep(150)
      levels.push({b, li: lamp.getLight()})
    }
    const keys: [string, (li: LampLightInfo) => number][] = [
      ["LED", (li) => li.led],
      ["shade glow", (li) => li.shadeGlow],
      ["table pool", (li) => li.tablePool.level],
      ["real lamp glow", (li) => li.realGlow],
      ["floor pool", (li) => li.floorPool],
      ["pulse rate", (li) => li.pulseRate],
      ["pulse density", (li) => 1 / li.pulseSpacing]
    ]
    for (let i = 1; i < levels.length; i++) {
      const a = levels[i - 1]
      const c = levels[i]
      for (const [name, f] of keys) check(f(c.li) > f(a.li) + 1e-3, () => `the ${name} did not rise from Brightness ${a.b} to ${c.b}: ${f(a.li).toFixed(3)} → ${f(c.li).toFixed(3)}`)
      check(c.li.miniColor.distance(a.li.miniColor) < 1e-3, "Brightness changed the colour")
    }
    const top = levels[levels.length - 1].li
    check(top.led > 0.99 && top.shadeGlow > 0.99 && top.realGlow > 0.99, () => `at Brightness 1: LED ${top.led.toFixed(2)}, shade ${top.shadeGlow.toFixed(2)}, real ${top.realGlow.toFixed(2)}`)
    print(`Cutaway L5: Brightness ${levels.map((l) => l.b).join(" → ")}: LED ${levels.map((l) => l.li.led.toFixed(2)).join("/")}, shade ${levels.map((l) => l.li.shadeGlow.toFixed(2)).join("/")}, pool ${levels.map((l) => l.li.tablePool.level.toFixed(2)).join("/")}, real ${levels.map((l) => l.li.realGlow.toFixed(2)).join("/")}, pulses ${levels.map((l) => l.li.pulseRate.toFixed(2)).join("/")} per s`)

    // Brightness 0 looks the same as off: nothing of the light is drawn.
    rail.setValue("brightness", 0)
    await sleep(150)
    const z = lamp.getLight()
    const drawn = {led: z.led, shade: z.shadeGlow, pool: z.tablePool.level, real: z.realGlow, floor: z.floorPool, pulses: z.pulseLevel, thread: z.threadLevel, bubble: z.bubbleOpen, rays: z.rays, point: z.bulbPoint}
    check(Object.keys(drawn).every((k) => (drawn as {[k: string]: number})[k] === 0), () => `at Brightness 0 still drawn: ${JSON.stringify(drawn)}`)
    check(lamp.lightOn && z.phase === "lit", () => `Brightness 0 switched it ${z.phase}`)
    rail.setValue("brightness", 1)
    await sleep(150)
    check(lamp.getLight().led > 0.99 && lamp.getLight().realGlow > 0.99, "it did not come back up from Brightness 0")
    print(`Cutaway L5: Brightness 0 draws nothing (${Object.keys(drawn).join(", ")} all 0) and the lamp stays on; back at 1 it is lit again`)

    // ---------------- Warmth: the colour of all emitted light ----------------
    const shares: number[] = []
    const coats: vec3[] = []
    for (const T of [2700, 4000, 6500]) {
      rail.setValue("warmth", kelvinToWarmth(T))
      await sleep(150)
      check(Math.abs(lamp.getKelvin() - T) < 1, () => `Warmth at ${T} K reads ${lamp.getKelvin().toFixed(1)} K`)
      check(rail.getLabel("warmth") === `Warmth  ${T} K`, () => `label "${rail.getLabel("warmth")}"`)
      const want = kangRgb(T)
      const li = lamp.getLight()
      const drawnColors: [string, vec3][] = [
        ["the miniature's shade glow", li.miniColor],
        ["the pool on the table", li.poolColor],
        ["the bubble's white light", li.bubbleColor],
        ["the real lamp's glow", li.realColor],
        ["the real lamp's floor pool", li.floorColor]
      ]
      for (const [what, c] of drawnColors) {
        const err = Math.max(Math.abs(c.x - want.x), Math.abs(c.y - want.y), Math.abs(c.z - want.z))
        check(err <= 0.02, () => `${what} at ${T} K is ${fmt(c)}, the formula gives ${fmt(want)} (off by ${(err * 100).toFixed(2)}%)`)
      }
      shares.push(li.coatingShare)
      coats.push(li.coatColor)
      print(`Cutaway L5: ${T} K → formula ${fmt(want)}; drawn: shade ${fmt(li.miniColor)}, pool ${fmt(li.poolColor)}, bubble ${fmt(li.bubbleColor)}, real ${fmt(li.realColor)}, floor ${fmt(li.floorColor)}; coating share ${(li.coatingShare * 100).toFixed(0)}%, coat ${fmt(li.coatColor)}`)
      if (T === 2700) check(lamp.getCaption() === LAMP_CAPTIONS.warm, () => `after the first Warmth move the caption is "${lamp.getCaption()}"`)
    }
    // Warmer: more of the blue converted, and the converted light warmer (the red phosphor).
    check(shares[0] > shares[1] && shares[1] > shares[2], () => `the coating's share does not grow with warmth: ${shares.map((s) => s.toFixed(3)).join(", ")} at 2700/4000/6500 K`)
    check(coats[0].y < coats[2].y, () => `the coating's light is no warmer at 2700 K (${fmt(coats[0])}) than at 6500 K (${fmt(coats[2])})`)
    check(phaseCount(main, "lamp:warmCaption") === 1, () => `the Warmth caption showed ${phaseCount(main, "lamp:warmCaption")} times`)
  }
}

function fmt(c: vec3): string {
  return `(${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)})`
}

/**
 * The test's own implementation of the reported formula: Kang et al. (2002) cubic splines for the
 * Planckian locus (x, y), XYZ at Y = 1, linear sRGB (Lindbloom's D65 matrix), clipped, scaled to a
 * largest channel of 1, then the sRGB transfer curve.
 */
function kangRgb(T: number): vec3 {
  const a = 1e3 / T
  const x = T <= 4000 ? -0.2661239 * a * a * a - 0.2343589 * a * a + 0.8776956 * a + 0.17991 : -3.0258469 * a * a * a + 2.1070379 * a * a + 0.2226347 * a + 0.24039
  const y =
    T <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
  const X = x / y
  const Z = (1 - x - y) / y
  const lin = [3.2404542 * X - 1.5371385 - 0.4985314 * Z, -0.969266 * X + 1.8760108 + 0.041556 * Z, 0.0556434 * X - 0.2040259 + 1.0572252 * Z].map((v) => Math.max(0, v))
  const m = Math.max(...lin)
  const enc = lin.map((v) => {
    const u = v / m
    return u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055
  })
  return new vec3(enc[0], enc[1], enc[2])
}
