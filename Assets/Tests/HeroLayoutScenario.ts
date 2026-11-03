import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {getMain} from "./CutawayTestUtils"

const f = (v: vec3) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`

/**
 * Helper (not a done-criterion test): prints the hero stage's layout as world geometry, for the
 * state the stage is in (helper-demo-play with `layout` "1" prints it after its step; a separate
 * run restarts the lens). One "layout:" line per item:
 * camera, reset pill, sensor, rail, bubble, shell boxes, part boxes and label quads.
 */
@component
export class HeroLayoutScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(200)
    printLayout()
  }
}

/** Print the layout (see HeroLayoutScenario); helper-demo-play calls it with `layout` set. */
export function printLayout(): void {
  {
    const main = getMain()
    const camTr = WorldCameraFinderProvider.getInstance().getTransform()
    print(`layout: camera ${f(camTr.getWorldPosition())} fwd ${f(camTr.forward.uniformScale(-1))}`)
    print(`layout: reset ${main.getResetPillCorners().map(f).join(" ")}`)
    const hero = main.getHero()
    if (!hero) {
      print("layout: no hero")
      return
    }
    const l = hero.getLayout()
    print(`layout: sensor ${f(l.sensor)}`)
    print(`layout: rail ${f(l.rail)}`)
    print(`layout: bubble ${l.bubble ? f(l.bubble.center) + " r " + l.bubble.radius.toFixed(2) + " open " + l.bubble.open.toFixed(2) : "none"}`)
    for (const b of l.railBoxes) print(`layout: box rail ${b.map(f).join(" ")}`)
    for (const b of l.shell) print(`layout: box shell ${b.map(f).join(" ")}`)
    for (const p of l.parts) for (const b of p.boxes) print(`layout: box ${p.key} ${b.map(f).join(" ")}`)
    for (const q of l.labels) print(`layout: label ${q.id} ${q.corners.map(f).join(" ")} | ${q.text}`)
  }
}
