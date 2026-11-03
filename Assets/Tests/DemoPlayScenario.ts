import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {ScenarioConfig} from "Leaf.lspkg/Scenarios/scenario/ScenarioConfig"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {StationKey} from "../Scripts/CutawayMain"
import {imageDistance} from "../Scripts/CutawayHero"
import {cleanStart, drag, getMain, press, PREFIX, SETTLE_MS, startGuaranteedQuestion, waitForPhase} from "./CutawayTestUtils"
import {printLayout} from "./HeroLayoutScenario"

/**
 * Helper (not a done-criterion test): drives one object to a moment and returns, so the preview
 * holds it for screenshots / manual review.
 * - `station`: recordPlayer | camera | lamp.
 * - `step`:
 *     ""        start the guaranteed explanation and return at once (or wait for `untilPhase`).
 *     "chip"    look at the object: its dot stretches into the chip.
 *     "scan"    pinch the chip: scan sweep, brackets lock on, the questions fan out.
 *     "1".."5"  play the explanation and hold it frozen inside beat N (phase "beatN"); the next
 *               run or test releases the hold.
 *     "finish"  play it to the end: it folds into the dot, which gets its energy rings.
 * - `untilPhase` (with step ""): return once that phase has started.
 * - `extraMs`: extra wait before returning. For "1".."5" it defaults to 1300 ms into the beat.
 * "chip" and "scan" leave the test gaze override on (the chip needs the object looked at);
 * the next run or test clears it.
 * - `station` cameraHero (the camera's "Bring it closer" stage), `step`:
 *     launch  mid-flight (just after the bayonet click)     land   at rest on the table
 *     drag    held mid-drag (lifted 1.5 cm, sliding right)  hover  risen to hover, parts just parting
 *     apart   fully apart, labels on (held before the light path starts)
 *     light   the viewfinder beat                          focus  live view, focused sharp
 *     blurry  live view, out of focus                      photo  the print, sharp
 *     back    flying home
 *   Each holds the stage's timeline (setHoldHero); the next run or test releases it.
 *   `layout` "1": then print the stage's layout as world geometry (see HeroLayoutScenario).
 */
@component
export class DemoPlayScenario extends Scenario {
  async run(config?: ScenarioConfig): Promise<void> {
    await sleep(300)
    const main = getMain()
    const get = (k: string) => (config ? ((config.get(k) as string) ?? "") : "")
    const station = get("station") || "recordPlayer"
    if (station === "cameraHero") {
      await cleanStart(main)
      main.setHoldHero(false)
      await runHero(main, get("step").trim(), get("extraMs"))
      if (get("layout") === "1") {
        await sleep(400)
        printLayout()
      }
      const h = main.getHero()
      if (h) {
        const i = h.getInfo()
        print(`hero demo: state=${i.state} scale=${i.scale.toFixed(2)} pos=${i.position} up=${i.up} lowest=${i.lowestY.toFixed(1)} tableY=${i.tableY.toFixed(1)} table=${main.getTablePosition()} thread=${i.threadOk}`)
      }
      return
    }
    const key = station as StationKey
    const step = get("step").trim()
    const extraRaw = get("extraMs")
    const extra = Number(extraRaw || 0)
    await cleanStart(main)

    if (step === "chip" || step === "scan") {
      main.lookAt(key)
      await sleep(SETTLE_MS)
      if (step === "scan") {
        await press(PREFIX[key] + "Chip")
        await sleep(900)
      }
      if (extra > 0) await sleep(extra)
      return
    }

    await startGuaranteedQuestion(main, key)
    main.setGazeOverride(null)

    if (/^[1-5]$/.test(step)) {
      await waitForPhase(main, "beat" + step, 22000)
      await sleep(extraRaw ? extra : 1300)
      // Freeze the explanation here so a screenshot taken a few seconds later still shows this
      // beat. The next run or test (cleanStart) releases it.
      main.holdExplanation = true
      return
    }
    if (step === "finish") {
      await waitForPhase(main, "explained", 25000)
      await sleep(extraRaw ? extra : 450)
      return
    }
    const until = get("untilPhase")
    if (until) {
      await waitForPhase(main, until, 20000)
      if (extra > 0) await sleep(extra)
    }
  }
}

/** Drive the camera hero stage to `step` and freeze it there (see DemoPlayScenario). */
async function runHero(main: ReturnType<typeof getMain>, step: string, extraRaw: string): Promise<void> {
  const hero = main.getHero()
  if (!hero) throw new Error("camera hero stage is not wired")
  const extra = Number(extraRaw || 0)
  const wait = async (phase: string, ms: number) => waitForPhase(main, phase, ms)
  main.lookAt("camera")
  await sleep(SETTLE_MS)
  await press("CameraChip")
  await sleep(300)
  await press("CameraQ1")
  main.setGazeOverride(null)
  if (step === "launch") {
    await wait("hero:click", 3000)
    await sleep(extraRaw ? extra : 650)
    main.setHoldHero(true)
    return
  }
  await wait("hero:landed", 4000)
  await sleep(600)
  if (step === "land") {
    if (extra > 0) await sleep(extra)
    return
  }
  if (step === "back") {
    hero.setApart(0.45)
    await sleep(900)
    await press("HeroPutBack")
    await sleep(extraRaw ? extra : 1000)
    main.setHoldHero(true)
    return
  }
  if (step === "drag") {
    // Freeze once lifted, while the hand is still moving; the frozen stage keeps it held.
    const moving = drag("HeroGrab", new vec3(0.25, 0, 0.1), 900)
    await sleep(extraRaw ? extra : 700)
    main.setHoldHero(true)
    await moving
    return
  }
  if (step === "hover") {
    hero.setApart(0.12)
    await wait("hero:hover", 3000)
    await sleep(extraRaw ? extra : 900)
    main.setHoldHero(true)
    return
  }
  if (step === "apart") {
    // Pass 2: it rises to hover first, then the parts separate. Just short of the end, so the
    // light path does not start; frozen once the parts are out.
    hero.setApart(0.985)
    await wait("hero:hover", 3000)
    await sleep(900)
    if (extra > 0) await sleep(extra)
    main.setHoldHero(true)
    return
  }
  hero.setApart(1)
  await wait("hero:light", 3000)
  if (step === "light") {
    await sleep(extraRaw ? extra : 1500)
    main.setHoldHero(true)
    return
  }
  await wait("hero:live", 6000)
  const sharpL = imageDistance(50)
  hero.setSubjectDistance(50)
  if (step === "blurry") {
    hero.setFocusL(36)
    // The mirror-up caption reads for ~2 s before the sharp / blurry one takes over.
    await sleep(extraRaw ? extra : 2300)
    main.setHoldHero(true)
    return
  }
  hero.setFocusL(sharpL)
  await sleep(2300)
  if (step === "focus") {
    if (extra > 0) await sleep(extra)
    main.setHoldHero(true)
    return
  }
  if (step === "photo") {
    await press("HeroPhoto")
    // Pass 2: the print flies to the user and develops (1.2 s) before the frame is frozen.
    await wait("hero:printDeveloped", 4000)
    await sleep(extraRaw ? extra : 200)
    main.setHoldHero(true)
  }
}
