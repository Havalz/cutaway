import {Scenario} from "Leaf.lspkg/Scenarios/scenario/Scenario"
import {sleep} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {CameraHero, HeroLayout, imageDistance} from "../Scripts/CutawayHero"
import {circle2, hull2, polyGap, toView, ViewFrame, viewFrame} from "../Scripts/CutawayLayout"
import {cleanStart, getMain, waitForPhase} from "./CutawayTestUtils"
import {check, landHero} from "./HeroTestUtils"

/**
 * The two wall posters behind the console (world quads), measured from the default pose: World
 * Query hits on them (they lean on the wall: bottom z -496, top z -500.6) and their edges in the
 * preview at that pose.
 */
const POSTERS: vec3[][] = [
  [new vec3(-104, -132.6, -496), new vec3(-16.5, -132.6, -496), new vec3(-16.5, -24.6, -500.6), new vec3(-104, -24.6, -500.6)],
  [new vec3(-8.5, -132.6, -496), new vec3(79.3, -132.6, -496), new vec3(79.3, -24.6, -500.6), new vec3(-8.5, -24.6, -500.6)]
]

const f1 = (x: number) => x.toFixed(1)

/**
 * P8 (camera hero pass 2, §9 clean-up), from the default preview pose. Overlap is judged as the user
 * sees it: shapes projected from the eye (mesh boxes, text quads, the bubble's circle).
 * - The Reset pill is fully inside the view (all four corners on screen).
 * - Labels: none overlaps another label, a part or the rail, taken apart, in the viewfinder beat
 *   and in live view.
 * - Sensor bubble: at sensor height, at most 25 cm from the sensor, clear of the shell and the wall
 *   posters (and of the labels, caption, rail and parts).
 */
@component
export class P8CleanUpScenario extends Scenario {
  async run(): Promise<void> {
    await sleep(1500)
    const main = getMain()
    await cleanStart(main)
    await sleep(1200)
    const notes: string[] = []

    // ---- Reset pill fully in view. ----
    const cam = WorldCameraFinderProvider.getInstance().getComponent()
    const camTr = WorldCameraFinderProvider.getInstance().getTransform()
    const fwd = camTr.forward.uniformScale(-1)
    let umin = 1
    let umax = 0
    let vmin = 1
    let vmax = 0
    for (const c of main.getResetPillCorners()) {
      check(c.sub(camTr.getWorldPosition()).dot(fwd) > 0, "Reset pill corner behind the camera")
      const sp = cam.worldSpaceToScreenSpace(c)
      umin = Math.min(umin, sp.x)
      umax = Math.max(umax, sp.x)
      vmin = Math.min(vmin, sp.y)
      vmax = Math.max(vmax, sp.y)
    }
    notes.push(`reset pill on screen x ${umin.toFixed(3)}..${umax.toFixed(3)}, y ${vmin.toFixed(3)}..${vmax.toFixed(3)}`)
    check(umin > 0.01 && umax < 0.99 && vmin > 0.01 && vmax < 0.99, () => `Reset pill not fully in view: ${notes[notes.length - 1]}`)

    // ---- Labels taken apart. ----
    const hero = await landHero(main)
    hero.setApart(0.985)
    await waitForPhase(main, "hero:hover", 3000)
    await sleep(1600)
    notes.push("apart: " + checkLabels(hero, 8))

    // ---- Viewfinder beat. ----
    hero.setApart(1)
    await waitForPhase(main, "hero:light", 3000)
    await sleep(1500)
    notes.push("viewfinder beat: " + checkLabels(hero, 8))

    // ---- Live view: labels and the bubble. ----
    await waitForPhase(main, "hero:live", 6000)
    hero.setSubjectDistance(50)
    hero.setFocusL(imageDistance(50))
    await sleep(2300)
    notes.push("live: " + checkLabels(hero, 2))
    notes.push("bubble: " + checkBubble(hero))
    print("P8: " + notes.join("; "))
    hero.setApart(0)
    await sleep(1200)
  }
}

function eyeFrame(l: HeroLayout): ViewFrame {
  return viewFrame(WorldCameraFinderProvider.getInstance().getTransform().getWorldPosition(), l.sensor)
}

/** Labels: each pair of label quads, and each label against each part mesh and the rail. */
function checkLabels(hero: CameraHero, expect: number): string {
  const l = hero.getLayout()
  const F = eyeFrame(l)
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const labels = l.labels.filter((q) => q.id.startsWith("hero_")).map((q) => ({id: q.id, text: q.text, h: view(q.corners)}))
  check(labels.length === expect, () => `${labels.length} part labels shown (${labels.map((x) => x.text).join(", ")}), expected ${expect}`)
  const cap = l.labels.find((q) => q.id === "caption")
  const all = cap ? labels.concat([{id: "caption", text: cap.text, h: view(cap.corners)}]) : labels
  let minLabel = 1e9
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const g = polyGap(all[i].h, all[j].h)
      minLabel = Math.min(minLabel, g)
      check(g > 0, () => `label "${all[i].text}" overlaps label "${all[j].text}" (by ${f1(-g)} cm)`)
    }
  }
  let minPart = 1e9
  for (const q of labels) {
    for (const p of l.parts) {
      for (const b of p.boxes) {
        const g = polyGap(q.h, view(b))
        minPart = Math.min(minPart, g)
        check(g > 0, () => `label "${q.text}" overlaps the ${p.label.toLowerCase()} (by ${f1(-g)} cm)`)
      }
    }
    for (const b of l.railBoxes) {
      const g = polyGap(q.h, view(b))
      check(g > 0, () => `label "${q.text}" overlaps the rail (by ${f1(-g)} cm)`)
    }
  }
  return `${labels.length} labels, closest label-label ${f1(minLabel)} cm, label-part ${f1(minPart)} cm`
}

/** The bubble: at sensor height, within 25 cm, clear of the shell, the posters and the rest. */
function checkBubble(hero: CameraHero): string {
  const l = hero.getLayout()
  check(!!l.bubble && l.bubble.open > 0.99, "the bubble is not open in live view")
  const b = l.bubble!
  const F = eyeFrame(l)
  const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
  const dy = b.center.y - l.sensor.y
  const dist = b.center.distance(l.sensor)
  check(Math.abs(dy) < 0.5, () => `bubble centre ${f1(dy)} cm off sensor height`)
  check(dist <= 25, () => `bubble centre ${f1(dist)} cm from the sensor (max 25)`)
  const k = F.D / b.center.sub(F.eye).dot(F.f)
  const circle = circle2(toView(F, b.center), b.radius * k, 32)
  const gap = (what: string, shapes: vec3[][]) => {
    let m = 1e9
    for (const s of shapes) m = Math.min(m, polyGap(circle, view(s)))
    check(m > 0, () => `the bubble overlaps the ${what} (by ${f1(-m)} cm)`)
    return m
  }
  const gShell = gap("shell", l.shell)
  const gPoster = gap("wall poster", POSTERS)
  const gLabels = gap("labels", l.labels.map((q) => q.corners))
  const gRail = gap("rail", l.railBoxes)
  const parts: vec3[][] = []
  for (const p of l.parts) for (const x of p.boxes) parts.push(x)
  const gParts = gap("parts", parts)
  return `centre ${f1(dist)} cm from the sensor, ${dy.toFixed(2)} cm off its height, radius ${f1(b.radius)} cm; gaps: shell ${f1(gShell)}, poster ${f1(gPoster)}, labels ${f1(gLabels)}, rail ${f1(gRail)}, parts ${f1(gParts)} cm`
}

