import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {hull2, polyGap, toView, ViewFrame, viewFrame} from "../Scripts/CutawayLayout"
import {RailColumn} from "../Scripts/CutawayRail"
import {CutawayLabelsUI} from "../Scripts/CutawayLabelsUI"
import {RAIL} from "../Scripts/CutawayStyle"
import {check} from "./HeroTestUtils"

const f1 = (x: number) => x.toFixed(1)

export function frameOn(so: SceneObject): ViewFrame {
  const eye = WorldCameraFinderProvider.getInstance().getTransform().getWorldPosition()
  return viewFrame(eye, so.getTransform().getWorldPosition())
}

/** The rail outside the outline of the copy taken apart, as the user sees them, by how much. */
export function checkRailClear(F: ViewFrame, rail: RailColumn, exploded: vec3[][]): string {
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const all: vec3[] = []
  for (const b of exploded) for (const q of b) all.push(q)
  const outline = view(all)
  const boxes = rail.getBoxes()
  check(boxes.length > 0, "the rail is not showing")
  const gap = polyGap(view(boxes[0]), outline)
  check(gap > 0, () => `the rail's glass covers the copy taken apart by ${f1(-gap)} cm as the user sees it`)
  return `the rail ${f1(gap)} cm outside the copy's outline`
}

/** No label over another, the caption, the rail, Reset or a gaze chip. */
export function checkLabelsClear(F: ViewFrame, labelsUI: CutawayLabelsUI, prefix: string, rail: RailColumn): string {
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const quads = labelsUI.getTextQuads()
  const labels = quads.filter((q) => q.id.startsWith(prefix)).map((q) => ({text: q.text, h: view(q.corners)}))
  const cap = quads.find((q) => q.id === "caption")
  const all = cap ? labels.concat([{text: cap.text, h: view(cap.corners)}]) : labels
  let least = 1e9
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const g = polyGap(all[i].h, all[j].h)
      least = Math.min(least, g)
      check(g > 0, () => `label "${all[i].text}" overlaps "${all[j].text}" (by ${f1(-g)} cm)`)
    }
  }
  const plate = view(rail.getBoxes()[0])
  const reset = rail.keepClearOf ? view(rail.keepClearOf()) : null
  const chips = rail.labelsKeepClearOf ? rail.labelsKeepClearOf().map(view) : []
  for (const q of labels) {
    const g = polyGap(q.h, plate)
    least = Math.min(least, g)
    check(g > 0, () => `label "${q.text}" overlaps the rail (by ${f1(-g)} cm)`)
    if (reset) {
      const r = polyGap(q.h, reset)
      least = Math.min(least, r)
      check(r > 0, () => `label "${q.text}" overlaps Reset (by ${f1(-r)} cm)`)
    }
    for (const c of chips) {
      const r = polyGap(q.h, c)
      least = Math.min(least, r)
      check(r > 0, () => `label "${q.text}" overlaps a gaze chip (by ${f1(-r)} cm)`)
    }
  }
  return `${labels.length} labels, nothing nearer than ${f1(least)} cm`
}

/** The glass fits what is on it: its rows and the caption's lines, no empty slot. */
export function checkGlassFits(rail: RailColumn, layout: string, labelsUI: CutawayLabelsUI): string {
  const full = rail.topOf(layout)
  const top = rail.getPlateTop()
  const quad = labelsUI.getCaptionQuad()
  const rows = full - RAIL.captionSlot - RAIL.padding
  check(top < full - 0.5 && top > rows - RAIL.gap - 0.01, () => `the glass's top is at ${f1(top)} (rows end at ${f1(rows)}, the full slot at ${f1(full)})`)
  return `glass top ${f1(top)}, ${f1(full - top)} cm less than the old fixed slot${quad ? " with a caption on it" : ""}`
}
