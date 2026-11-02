import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import {cleanStart, getMain, waitForPhase} from "./CutawayTestUtils"
import {check, landHero} from "./HeroTestUtils"

const PARTS = ["elements", "aperture", "mount", "mirror", "prism", "viewfinder", "shutter", "sensor"]
const MAX_REPLICA_TRIS = 80000

/**
 * P5 (camera hero pass 2, solid parts): taken apart, all eight interior parts show as solid
 * meshes (rendered with the solid PBR material, with real triangle counts), not only lines; the
 * whole replica stays at or under 80k triangles.
 */
@component
export class P5SolidPartsScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    const hero = await landHero(main)
    hero.setApart(0.985)
    await waitForPhase(main, "hero:hover", 1500)
    await sleep(1000)
    const r = hero.getSolidReport()
    const lines: string[] = []
    for (const key of PARTS) {
      const p = r.parts.find((q) => q.key === key)
      if (!p) throw new Error(`no report for ${key}`)
      lines.push(`${key} ${p.solidTris} solid + ${p.accentTris} accent tris, ${p.solidMeshes} solid meshes, fill ${p.fill.toFixed(2)}`)
      check(p.solidTris >= 40, () => `${key}: only ${p.solidTris} solid triangles`)
      check(p.solidMeshes >= 1, () => `${key}: no visible mesh in the solid material`)
      check(p.fill > 0.9, () => `${key}: solid fill ${p.fill.toFixed(2)} (not shown)`)
    }
    const total = r.partTris + r.shellTris
    print("P5: " + lines.join("; ") + `; parts ${r.partTris}, shell ${r.shellTris}, replica ${total} triangles`)
    check(r.shellTris > 0, "shell triangles not counted")
    check(total <= MAX_REPLICA_TRIS, () => `replica has ${total} triangles (max ${MAX_REPLICA_TRIS})`)
    hero.setApart(0)
    await sleep(1500)
  }
}
