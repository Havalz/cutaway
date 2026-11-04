import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {LAMP_GEOM, lampShadeR, ROOM_LAMP} from "../Scripts/CutawayLampModel"
import {check} from "./HeroTestUtils"
import {buildLampModel, reportLampModel} from "./LampTestUtils"

/** The named parts lamp-hero.md asks for (base, stem, shade with rings and frame, socket, bulb, cord, switch, wiring). */
const PARTS = [
  "LampBase",
  "LampCollar",
  "LampStem",
  "LampShade",
  "LampPaper",
  "LampTopRing",
  "LampBottomRing",
  "LampFrame",
  "LampSocket",
  "LampBulb",
  "LampBulbBase",
  "LampBulbGlass",
  "LampLedBoard",
  "LampLedChips",
  "LampDriver",
  "LampCord",
  "LampSwitch",
  "LampSwitchButton",
  "LampPlug",
  "LampWires"
]
const INTERIOR = ["LampDriver", "LampWires"]
const MAX_TRIS = 30000
const TOL = 0.05

/**
 * L0 (lamp Phase A): the code-built model has every named part; its total height, the shade's
 * widest diameter and the base diameter are within 5% of the room's lamp at scale 1; the interior
 * is hidden until taken apart; the bulb sits in the socket inside the shade; 30k triangles or fewer.
 */
@component
export class L0LampModelScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(800)
    const m = buildLampModel(new vec3(40, 0, 45))
    await sleep(200)
    for (const name of PARTS) check(findSceneObjectByName(name) !== null, `part ${name} is missing`)
    for (const name of INTERIOR) check(!findSceneObjectByName(name).enabled, `${name} should be hidden until taken apart`)
    const r = reportLampModel(m)
    const near = (a: number, b: number, what: string) => check(Math.abs(a - b) / b <= TOL, () => `${what} ${a.toFixed(2)} vs room ${b.toFixed(2)} (${(((a - b) / b) * 100).toFixed(1)}%)`)
    near(r.height, ROOM_LAMP.height, "height")
    near(r.shadeWidth, ROOM_LAMP.shadeWidth, "shade width")
    near(r.baseDiameter, ROOM_LAMP.baseDiameter, "base diameter")
    // The bulb stands in the socket on the stem, inside the paper, clear of it.
    const g = LAMP_GEOM
    check(Math.abs(m.pivot("LampSocket").y - g.socketY) < 1e-3 && g.bulbY > g.socketY && g.bulbY < g.socketY + 4.4, "the bulb should sit in the socket")
    check(g.bulbTopY < g.paperY1 && g.socketY > g.paperY0, "the bulb and socket should be inside the shade")
    check(lampShadeR(g.bulbTopY - 2.6) - 3.0 > 2, "the bulb should stand clear of the paper")
    check(r.tris <= MAX_TRIS, () => `model has ${r.tris} triangles (max ${MAX_TRIS})`)
    print(`L0: ${PARTS.length} parts, ${r.tris} triangles, height ${r.height.toFixed(2)}, shade ${r.shadeWidth.toFixed(2)}, base ${r.baseDiameter.toFixed(2)}`)
    m.destroy()
  }
}
