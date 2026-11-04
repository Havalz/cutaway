/**
 * Shared helpers for the lamp model (lamp-hero.md, Phase A): build the code-made model at scale 1
 * in the room, relative to the real lamp, and print what it measures.
 */
import {findSceneObjectByName} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {LAMP_GEOM, LampModel, ROOM_LAMP} from "../Scripts/CutawayLampModel"
import {getMain} from "./CutawayTestUtils"

const f2 = (v: number) => v.toFixed(2)
const fv = (v: vec3) => `${f2(v.x)},${f2(v.y)},${f2(v.z)}`

/**
 * Build the model with its footprint centre at the real lamp's plus `offset` (world cm), unrotated;
 * or, with `place`, at that world point, turned `yawDeg` about +Y and scaled `scale`.
 */
export function buildLampModel(offset: vec3, place?: {at: vec3; scale: number; yawDeg: number}): LampModel {
  const main = getMain()
  if (!main.lampShellMaterial) throw new Error("CutawayMain.lampShellMaterial is not wired")
  const old = findSceneObjectByName("LampModel")
  if (old) old.destroy()
  const cam = WorldCameraFinderProvider.getInstance().getComponent()
  const layer = LayerSet.makeUnique()
  cam.renderLayer = cam.renderLayer.union(layer)
  const m = new LampModel({parent: main.getSceneObject(), shellMat: main.lampShellMaterial, layer})
  const tr = m.root.getTransform()
  tr.setWorldPosition(place ? place.at : ROOM_LAMP.origin.add(offset))
  tr.setWorldRotation(place ? quat.angleAxis((place.yawDeg * Math.PI) / 180, vec3.up()) : quat.quatIdentity())
  tr.setWorldScale(vec3.one().uniformScale(place ? place.scale : 1))
  return m
}

export interface LampMeasure {
  height: number
  shadeWidth: number
  baseDiameter: number
  tris: number
}

/** Print the model's triangles and its main dimensions against the room's lamp. */
export function reportLampModel(m: LampModel): LampMeasure {
  const t = m.triangles()
  print(`lamp-model: triangles ${t.total} (exterior ${t.exterior}, interior ${t.interior})`)
  print("lamp-model: by part " + Object.keys(t.byPart).map((k) => `${k} ${t.byPart[k]}`).join(", "))
  const all = m.bounds()
  const paper = m.bounds((p) => p === "LampPaper")
  const base = m.bounds((p) => p === "LampBase")
  const R = ROOM_LAMP
  const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(1)}%`
  const height = all.size.y
  const shadeWidth = (paper.size.x + paper.size.z) / 2
  const baseDiameter = (base.size.x + base.size.z) / 2
  print(`lamp-model: height ${f2(height)} vs room ${f2(R.height)} (${pct(height, R.height)}) | shade width ${f2(shadeWidth)} vs ${f2(R.shadeWidth)} (${pct(shadeWidth, R.shadeWidth)}) | base diameter ${f2(baseDiameter)} vs ${f2(R.baseDiameter)} (${pct(baseDiameter, R.baseDiameter)})`)
  print(`lamp-model: overall min ${fv(all.min)} max ${fv(all.max)} | paper y ${f2(paper.min.y)}..${f2(paper.max.y)}`)
  const wt = m.root.getTransform()
  print(`lamp-model: world origin ${fv(wt.getWorldPosition())} scale ${f2(wt.getWorldScale().x)} | LED chips ${fv(m.ledCenter())} | switch button ${fv(m.switchButtonTop())} | top ${f2(wt.getWorldPosition().y + LAMP_GEOM.height * wt.getWorldScale().y)}`)
  return {height, shadeWidth, baseDiameter, tris: t.total}
}
