/**
 * Shared helpers for the record player model (recordplayer-hero.md, Phase A): build the code-made
 * model at scale 1 in the room, relative to the real deck, and print what it measures.
 */
import {findSceneObjectByName} from "Leaf.lspkg/Utils/common/Utils"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {RecordPlayerModel, ROOM_DECK} from "../Scripts/CutawayRecordPlayerModel"
import {getMain} from "./CutawayTestUtils"

const f2 = (v: number) => v.toFixed(2)
const fv = (v: vec3) => `${f2(v.x)},${f2(v.y)},${f2(v.z)}`

/**
 * Build the model with its footprint centre at the real deck's plus `offset` (world cm), unrotated;
 * or, with `place`, at that world point, turned `yawDeg` about +Y and scaled `scale`.
 */
export function buildRpModel(offset: vec3, place?: {at: vec3; scale: number; yawDeg: number}): RecordPlayerModel {
  const main = getMain()
  if (!main.recordPlayerShellMaterial) throw new Error("CutawayMain.recordPlayerShellMaterial is not wired")
  const old = findSceneObjectByName("RpModel")
  if (old) old.destroy()
  const cam = WorldCameraFinderProvider.getInstance().getComponent()
  const layer = LayerSet.makeUnique()
  cam.renderLayer = cam.renderLayer.union(layer)
  const m = new RecordPlayerModel({parent: main.getSceneObject(), shellMat: main.recordPlayerShellMaterial, glowMat: main.glowMaterial, layer})
  const tr = m.root.getTransform()
  tr.setWorldPosition(place ? place.at : ROOM_DECK.origin.add(offset))
  tr.setWorldRotation(place ? quat.angleAxis((place.yawDeg * Math.PI) / 180, vec3.up()) : quat.quatIdentity())
  tr.setWorldScale(vec3.one().uniformScale(place ? place.scale : 1))
  return m
}

export interface RpMeasure {
  overall: vec3
  plinth: vec3
  tris: number
}

/** Print the model's triangles, bounds and stylus height against the room's deck. */
export function reportRpModel(m: RecordPlayerModel): RpMeasure {
  const t = m.triangles()
  print(`rp-model: triangles ${t.total} (exterior ${t.exterior}, interior ${t.interior}, accent ${t.accent})`)
  print("rp-model: by part " + Object.keys(t.byPart).map((k) => `${k} ${t.byPart[k]}`).join(", "))
  const all = m.bounds()
  const pl = m.bounds((p) => p === "RpPlinth" || p === "RpFeet")
  const plinth = new vec3(pl.size.x, pl.max.y, pl.size.z)
  const pct = (a: number, b: number) => `${(((a - b) / b) * 100).toFixed(1)}%`
  const R = ROOM_DECK
  print(`rp-model: overall W ${f2(all.size.x)} H ${f2(all.size.y)} D ${f2(all.size.z)} | room ${f2(R.overall.x)} ${f2(R.overall.y)} ${f2(R.overall.z)} | diff ${pct(all.size.x, R.overall.x)} ${pct(all.size.y, R.overall.y)} ${pct(all.size.z, R.overall.z)}`)
  print(`rp-model: overall min ${fv(all.min)} max ${fv(all.max)}`)
  print(`rp-model: plinth W ${f2(plinth.x)} top ${f2(plinth.y)} D ${f2(plinth.z)} | room ${f2(R.plinth.x)} ${f2(R.plinth.y)} ${f2(R.plinth.z)} | diff ${pct(plinth.x, R.plinth.x)} ${pct(plinth.y, R.plinth.y)} ${pct(plinth.z, R.plinth.z)}`)
  const shelfY = m.root.getTransform().getWorldPosition().y
  print(`rp-model: stylus tip ${f2(m.stylusTip().y - shelfY)} cm above the shelf (record surface 7.60)`)
  // World points for the room's markers and the station outline (meaningful when built on the deck, dx 0).
  const wm = m.root.getTransform().getWorldTransform()
  const deck = m.bounds((p) => p !== "RpDustCover")
  const rec = m.parts["RpRecord"].getTransform().getWorldPosition()
  const recTop = m.parts["RpRecordLabel"].getTransform().getWorldPosition()
  print(`rp-model: world stylus tip ${fv(m.stylusTip())} | platter centre on the record ${fv(new vec3(rec.x, recTop.y, rec.z))}`)
  print(`rp-model: world deck without cover: centre ${fv(wm.multiplyPoint(deck.min.add(deck.max).uniformScale(0.5)))} size ${fv(deck.size)}`)
  return {overall: all.size, plinth, tris: t.total}
}
