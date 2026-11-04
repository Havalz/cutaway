import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {ROOM_DECK} from "../Scripts/CutawayRecordPlayerModel"
import {check} from "./HeroTestUtils"
import {buildRpModel, reportRpModel} from "./RpTestUtils"

/** The named parts recordplayer-hero.md asks for (plinth, cover, platter, record, tonearm, cartridge, interior). */
const PARTS = [
  "RpPlinth",
  "RpFeet",
  "RpStartStop",
  "RpSpeed33",
  "RpSpeed45",
  "RpDustCover",
  "RpPlatter",
  "RpMat",
  "RpRecord",
  "RpRecordLabel",
  "RpSpindle",
  "RpTonearmBase",
  "RpTonearm",
  "RpTonearmLift",
  "RpArmTube",
  "RpCounterweight",
  "RpArmRest",
  "RpArmClip",
  "RpCueLever",
  "RpAntiSkate",
  "RpHeadshell",
  "RpFingerLift",
  "RpCartridge",
  "RpStylus",
  "RpMotor",
  "RpSubPlatter",
  "RpBelt",
  "RpCartridgeMagnet",
  "RpCartridgeCoils",
  "RpSignalWires",
  "RpSignalWiresArm"
]
const INTERIOR = ["RpInterior", "RpCartridgeMagnet", "RpCartridgeCoils", "RpSignalWiresArm"]
const MAX_TRIS = 40000
const TOL = 0.05

/**
 * R0 (record player Phase A): the code-built model has every named part, its main width, depth and
 * height are within 5% of the room's deck at scale 1, the interior is hidden until taken apart,
 * the stylus tip sits at the record's surface, and the whole model is 40k triangles or fewer.
 */
@component
export class R0ModelScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(800)
    const m = buildRpModel(new vec3(50, 0, 0))
    await sleep(200)
    for (const name of PARTS) check(findSceneObjectByName(name) !== null, `part ${name} is missing`)
    for (const name of INTERIOR) check(!findSceneObjectByName(name).enabled, `${name} should be hidden until taken apart`)
    const r = reportRpModel(m)
    const near = (a: number, b: number, what: string) => check(Math.abs(a - b) / b <= TOL, () => `${what} ${a.toFixed(2)} vs room ${b.toFixed(2)} (${(((a - b) / b) * 100).toFixed(1)}%)`)
    near(r.overall.x, ROOM_DECK.overall.x, "width")
    near(r.overall.y, ROOM_DECK.overall.y, "height (cover open)")
    near(r.overall.z, ROOM_DECK.overall.z, "depth (cover open)")
    near(r.plinth.x, ROOM_DECK.plinth.x, "plinth width")
    near(r.plinth.y, ROOM_DECK.plinth.y, "plinth height")
    near(r.plinth.z, ROOM_DECK.plinth.z, "plinth depth")
    const tip = m.stylusTip().y - m.root.getTransform().getWorldPosition().y
    check(Math.abs(tip - 7.6) <= 0.1, () => `stylus tip ${tip.toFixed(3)} cm above the shelf, record surface is 7.60`)
    check(r.tris <= MAX_TRIS, () => `model has ${r.tris} triangles (max ${MAX_TRIS})`)
    print(`R0: ${PARTS.length} parts, ${r.tris} triangles, overall ${r.overall.x.toFixed(2)} x ${r.overall.y.toFixed(2)} x ${r.overall.z.toFixed(2)}`)
    m.destroy()
  }
}
