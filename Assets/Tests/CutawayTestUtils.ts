/**
 * Shared helpers for the Cutaway LEAF scenarios.
 * Gaze is driven through CutawayMain's test hook (lookAt / lookAway) because LEAF cannot turn
 * the Interactive Preview head; everything else goes through the real UIKit buttons.
 */
import {expect} from "Leaf.lspkg/Utils/common/Expect"
import {findSceneObjectByName, sleep} from "Leaf.lspkg/Utils/common/Utils"
import {findInteractableByName} from "Leaf.lspkg/Interactors/InteractableUtils"
import {DefaultLeafInteractor} from "Leaf.lspkg/Interactors/interactor/DefaultLeafInteractor"
import {CutawayMain, StationKey} from "../Scripts/CutawayMain"

export const PREFIX: Record<StationKey, string> = {
  recordPlayer: "RecordPlayer",
  camera: "Camera",
  lamp: "Lamp"
}

export const CHIP_TEXT: Record<StationKey, string> = {
  recordPlayer: "Record player",
  camera: "Camera",
  lamp: "Lamp"
}

export const KEYS: StationKey[] = ["recordPlayer", "camera", "lamp"]

/** Spring animations settle in ~0.3 s; wait a bit longer before checking enabled state. */
export const SETTLE_MS = 650

export function getMain(): CutawayMain {
  const so = findSceneObjectByName("CutawayMain")
  if (!so) throw new Error("CutawayMain SceneObject not found")
  const main = so.getComponent(CutawayMain.getTypeName()) as CutawayMain
  if (!main) throw new Error("CutawayMain component not found")
  return main
}

// LEAF destroys its interactors when a scenario ends, so each scenario gets a fresh one
// (created in cleanStart, which every scenario calls first).
let interactor: DefaultLeafInteractor | null = null

/** Pinch a UIKit button by its SceneObject name (must be enabled). */
export async function press(name: string): Promise<void> {
  const it = findInteractableByName(name, undefined, true)
  if (!it) throw new Error(`Interactable "${name}" not found or not enabled`)
  if (!interactor) throw new Error("No LEAF interactor: call cleanStart() at the start of the scenario")
  await interactor.trigger(it)
  await sleep(350)
}

export function isEnabled(name: string): boolean {
  const so = findSceneObjectByName(name)
  return !!so && so.isEnabledInHierarchy
}

export function chipLabel(key: StationKey): string {
  const chip = findSceneObjectByName(PREFIX[key] + "Chip")
  if (!chip) return ""
  for (let i = 0; i < chip.getChildrenCount(); i++) {
    const c = chip.getChild(i)
    if (c.name === "ButtonLabel") {
      const t = c.getComponent("Component.Text") as Text
      return t ? t.text : ""
    }
  }
  return ""
}

/** Poll `predicate` every ~50 ms until it is true or `timeoutMs` passes (then throw). */
export async function waitUntil(predicate: () => boolean, timeoutMs: number, detail?: () => string): Promise<void> {
  const start = getTime()
  while (!predicate()) {
    if ((getTime() - start) * 1000 > timeoutMs) {
      throw new Error(`waitUntil timed out after ${timeoutMs}ms${detail ? ": " + detail() : ""}`)
    }
    await sleep(50)
  }
}

export async function waitForPhase(main: CutawayMain, phase: string, timeoutMs: number): Promise<void> {
  await waitUntil(
    () => main.getPhaseLog().indexOf(phase) >= 0,
    timeoutMs,
    () => `phase "${phase}" not reached; log = ${JSON.stringify(main.getPhaseLog())}`
  )
}

export function expectOrder(main: CutawayMain, phases: string[]): void {
  const log = main.getPhaseLog()
  let last = -1
  for (const p of phases) {
    const i = log.indexOf(p)
    if (i < 0) throw new Error(`phase "${p}" missing from ${JSON.stringify(log)}`)
    if (i <= last) throw new Error(`phase "${p}" out of order in ${JSON.stringify(log)}`)
    last = i
  }
}

/** Start from a clean slate: nothing explained, nothing running, looking at the ceiling. */
export async function cleanStart(main: CutawayMain): Promise<void> {
  interactor = new DefaultLeafInteractor()
  main.holdExplanation = false
  main.setHeadOverride(null)
  main.resetAll()
  main.lookAway()
  await sleep(SETTLE_MS)
}

/** Look at a station, open its chip and pinch its guaranteed question. */
export async function startGuaranteedQuestion(main: CutawayMain, key: StationKey): Promise<void> {
  main.lookAt(key)
  await sleep(SETTLE_MS)
  expect(main.getStationState(key)).toBe("chip")
  await press(PREFIX[key] + "Chip")
  await sleep(300)
  expect(main.getStationState(key)).toBe("questions")
  await press(PREFIX[key] + "Q0")
  expect(main.getStationState(key)).toBe("playing")
}

export function angleDeg(a: vec3, b: vec3): number {
  const d = Math.min(1, Math.max(-1, a.normalize().dot(b.normalize())))
  return (Math.acos(d) * 180) / Math.PI
}
