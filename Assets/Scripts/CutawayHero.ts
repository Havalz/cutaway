/**
 * Camera hero stage ("Bring it closer"), see devpost/camera-hero.md.
 *
 * A glowing copy of the DSLR peels off the real camera, the lens rises out of its bag and
 * twists onto the body in mid-air, and the assembled copy flies to the coffee table, growing
 * from 1x to 3x. There the user turns it (yaw only), takes it apart with a slider, focuses a
 * live thin-lens light path and takes a photo whose blur is the sensor's blur. "Put it back"
 * flies it home; Reset clears it from any state.
 *
 * Units: replica parts are authored in the replica's local space at 1x (cm, pivot at the lens
 * mount, lens along +Z, Y up). The landed replica is scaled 3x, so world cm = 3 × local cm.
 * The optics (f, d_o, d_i, L, h, c) are in world cm, measured along the optical axis.
 */
import {Interactable} from "SpectaclesInteractionKit.lspkg/Components/Interaction/Interactable/Interactable"
import {CutawayHeroUI} from "./CutawayHeroUI"
import {CutawayLabelsUI} from "./CutawayLabelsUI"
import {MeshKit, setFade, spawnMesh, TrailRibbon} from "./CutawayGeometry"
import {TableSurface} from "./CutawayHeroSurface"
import {addPoly, bevelBox, bevelFrame, Blade, chamferRect, clipPoly, extrudeStrip, extrudeX, irisBlades, irisOpening, latheLoop, latheSmooth, lensProfile, lensRim, ringPts} from "./CutawayHeroParts"
import {circle2, hull2, meshBoxes, polyGap, rect2, toView, viewFrame} from "./CutawayLayout"
import {BODY_BOX_CENTER, BODY_BOX_SIZE, BODY_MIN_Y, FOOT_CENTER, FOOT_SIZE, FOOTPRINT, footReach, HeroPhysics, hullLowestY, LENS_LENGTH, LENS_RADIUS, LENS_Z0, maxFootDistance} from "./CutawayHeroPhysics"
import {applyType, ENERGY, ink, keyWord, INK} from "./CutawayStyle"
import {clamp01, easeIn, easeInOutCubic, easeOutCubic, faceToward} from "./CutawayTween"

export type HeroSound = "lift" | "bayonet" | "flight" | "land" | "tap" | "part" | "mirror" | "shutter" | "print"
export type HeroState = "none" | "launch" | "landed" | "light" | "returning"
/**
 * Where the replica is on the table (pass 2): flying in, dropping under physics, at rest, rising to
 * hover, hovering for the experiment, coming back down, or lifting off to go home.
 */
export type HeroPose = "fly" | "drop" | "rest" | "rise" | "hover" | "descend" | "lift"

export interface HeroContext {
  parent: SceneObject
  glowMat: Material
  shellMat: Material
  /** Solid code-built parts: PBR without textures, rim highlight (fresnel), additive. Null = glow look. */
  solidMat: Material | null
  bodyMesh: RenderMesh
  lensMesh: RenderMesh
  labels: CutawayLabelsUI
  rail: CutawayHeroUI
  camPos: () => vec3
  camera: Camera | null
  /** The real camera's bounds (world center + size). */
  realBounds: () => {center: vec3; size: vec3}
  /** Direction the real camera's lens points (horizontal). */
  realFacing: vec3
  /** The table top in use (hit test or fallback); its centre is the landing spot. */
  surface: () => TableSurface
  /** Survey the table now (World Query hit test); `done` gets the surface in use afterwards. */
  survey: (done: (s: TableSurface) => void) => void
  /** Matter for the table and the replica (high friction, low bounce); null = engine default. */
  matter: Matter | null
  /** The lens inside its bag. */
  bag: () => vec3
  sound: (s: HeroSound, p: vec3) => void
  /** Move a (looping) sound with its source without restarting it. */
  moveSound: (s: HeroSound, p: vec3) => void
  log: (p: string) => void
  /** The one caption: on the rail, or hanging below `topCenter` when one is given. */
  caption: (text: string | null, topCenter?: vec3) => void
  /** Other UI the photo print keeps clear of when there is room (world quads: the Reset pill). */
  avoid?: () => vec3[][]
}

export interface HeroOptics {
  d_o: number
  d_i: number
  L: number
  h_i: number
  c: number
  sharp: boolean
}

/** §9 clean-up (tests): what the user sees, as world geometry. */
export interface HeroLayout {
  /** Each visible interior part: one box (8 world corners) per mesh. */
  parts: {key: string; label: string; boxes: vec3[][]}[]
  /** The body shell (the ghost of the body): its mesh's box. */
  shell: vec3[][]
  /** The shown labels' text quads (4 world corners) and the caption's. */
  labels: {id: string; text: string; corners: vec3[]}[]
  sensor: vec3
  /** The rail's anchor (world) and its visible boxes. */
  rail: vec3
  railBoxes: vec3[][]
  /** The magnify bubble, if open: centre and radius (world cm). */
  bubble: {center: vec3; radius: number; open: number} | null
}

export interface HeroPartInfo {
  key: string
  label: string
  /** World displacement from the part's assembled position (cm). */
  offset: number
  /** The displacement's component along the optical axis (cm). */
  alongAxis: number
  labelShown: boolean
}

// ---------------- Optics (world cm, replica space at 3x) ----------------
export const HERO_F = 15
export const HERO_N = 2.8
export const HERO_A = HERO_F / HERO_N
/** The subject's height (a candle: base to flame tip), world cm. */
export const HERO_H_O = 6
export const HERO_D_MIN = 25
export const HERO_D_MAX = 90
export const HERO_L_MIN = 16
export const HERO_L_MAX = 40
/** The photo print's SceneObject name (tests import it, so the two can never disagree). */
export const HERO_PRINT_NAME = "HeroPhotoPrint"
/** Blur circles at or under this read as sharp (cm on the 3x sensor, ≈ 0.1 mm on a real one). */
const SHARP_C = 0.3

export function imageDistance(d_o: number): number {
  return 1 / (1 / HERO_F - 1 / d_o)
}
export function blurCircle(d_o: number, L: number): number {
  const di = imageDistance(d_o)
  return (HERO_A * Math.abs(L - di)) / di
}

// ---------------- Replica geometry (local cm at 1x) ----------------
const SCALE = 3
const BODY_CENTER = BODY_BOX_CENTER
const LENS_CENTER_Z = LENS_Z0 + LENS_LENGTH / 2
/** The flight ends with the lowest point this high above the table centre; then it drops. */
const DROP_CM = 20
/** Lift while held, hover height for the experiment, lift before flying home (cm). */
const HOLD_CM = 1.5
const HOVER_CM = 12
const PUTBACK_LIFT_CM = 3
/** Hover bob: ±2 mm (4 mm travel) over 4 s. */
const BOB_CM = 0.2
const BOB_PERIOD = 4
const RISE_DUR = 0.5
const DESCEND_DUR = 0.45
const HOLD_DUR = 0.18
/** The parts follow the take-apart slider at most this fast once hovering (slider units per s). */
const APART_RATE = 1.6
/** Soft resistance near the table edge (cm) and the margin kept from it. */
const EDGE_SOFT = 4
const EDGE_MARGIN = 0.3
/** Glow and disc sit this far above the table top (cm), so they never z-fight. */
const ON_TABLE = 0.2
/** At rest: speed under this (cm/s) and spin under this (rad/s). */
const STILL_SPEED = 0.5
const STILL_SPIN = 0.02
/** Thin-lens plane, measured from the barrel's rear. */
const PLANE_IN_BARREL = 2.0
const BARREL_MIN = 0.9
const BARREL_APART = 3.0
const SENSOR_Z = -4.4
const SENSOR_APART_Z = -5.6
const L_APART = SCALE * (BARREL_APART + PLANE_IN_BARREL - SENSOR_APART_Z)
const MIRROR_Z = -2.0
const MIRROR_HALF = 2.0
const SENSOR_W = 3.6
const SENSOR_H = 2.4
/** Mirror: half width, the direction down the plate from the hinge, the silvered face's normal. */
const MIRROR_W = 1.9
const MIRROR_DOWN = new vec3(0, -Math.SQRT1_2, Math.SQRT1_2)
const MIRROR_FACE = new vec3(0, Math.SQRT1_2, Math.SQRT1_2)
/** The sheen takes SHEEN_SWEEP s to cross the mirror, once every SHEEN_PERIOD s. */
const SHEEN_PERIOD = 3.4
const SHEEN_SWEEP = 2.2
/**
 * Lens elements, rear to front, around the thin-lens plane: radius, centre thickness, front and
 * rear surface radii (positive = convex), position. Biconvex rear, positive meniscus, biconvex front.
 */
const ELEMENTS = [
  {name: "Rear", r: 2.3, t: 0.98, R1: 8, R2: 5.5, z: -0.9},
  {name: "Meniscus", r: 2.6, t: 0.55, R1: 4.2, R2: -6.5, z: 0.9},
  {name: "Front", r: 2.4, t: 0.9, R1: 6.5, R2: 10, z: 2.0}
]
/**
 * Roof pentaprism side outline (z, y), centred: entry face at the bottom and exit face at the back
 * meet at 90°, the other corners are 112.5°. Its front-top face (index 2 → 3) is the roof.
 */
const PRISM_OUTLINE = [new vec2(-1.3, -1.0), new vec2(1.1, -1.0), new vec2(1.291, -0.538), new vec2(-0.265, 1.018), new vec2(-1.3, 0.589)]
const PRISM_HX = 1.2
const PRISM_BOTTOM = -1.0
const PRISM_CENTER = new vec3(0, 3.0, -2.0)
/** Shutter gate half extents and its slats (five per curtain). */
const SHUTTER_HW = 1.85
const SHUTTER_HH = 1.25
const SLATS = 5
const SLAT_HH = 0.31
/** Body shell offset when taken apart, and in the light path: up and back, clear of every part. */
const BODY_APART = new vec3(0, 5.5, -3.0)
const BODY_FAR = new vec3(0, 11.2, -4.5)
/**
 * Sensor magnify bubble (§9): radius (world cm), magnification of the sensor in it (a round window
 * onto the sensor's middle), and its centre beside the sensor at sensor height: along the user's
 * right, and toward the user (cm). The sensor's left is the light path and above it hang the shell
 * ghost and the eyepiece, so the clear spot beside it, at its height, is on its right: level with
 * it on screen, between it and the rail's top row, clear of both.
 */
const BUBBLE_R = 8.5
const BUBBLE_SIDE = 11.5
const BUBBLE_TOWARD = 0
const BUBBLE_M = 1.6
/** Shell fill in the light path. */
const BODY_LIGHT_FILL = 0.06

/** Solid looks: the HeroSolid PBR (texture-free, rim highlight) with these settings. */
type SolidKind = "glass" | "mirror" | "metal" | "chrome" | "blade" | "dark" | "sensor" | "wax"
const SOLID: Record<SolidKind, {base: vec3; metallic: number; roughness: number; rimColor: vec3; rimExp: number; rim: number}> = {
  glass: {base: new vec3(0.085, 0.09, 0.1), metallic: 0, roughness: 0.12, rimColor: new vec3(0.9, 0.95, 1), rimExp: 3, rim: 1.0},
  mirror: {base: new vec3(0.15, 0.15, 0.16), metallic: 0.25, roughness: 0.08, rimColor: new vec3(0.95, 0.97, 1), rimExp: 3, rim: 0.9},
  metal: {base: new vec3(0.3, 0.3, 0.32), metallic: 0.35, roughness: 0.4, rimColor: new vec3(1, 0.95, 0.86), rimExp: 2.5, rim: 0.5},
  chrome: {base: new vec3(0.46, 0.46, 0.48), metallic: 0.5, roughness: 0.25, rimColor: new vec3(1, 0.97, 0.92), rimExp: 2.5, rim: 0.6},
  blade: {base: new vec3(0.09, 0.09, 0.1), metallic: 0.3, roughness: 0.35, rimColor: new vec3(1, 0.95, 0.86), rimExp: 2.5, rim: 0.45},
  dark: {base: new vec3(0.13, 0.13, 0.14), metallic: 0.2, roughness: 0.55, rimColor: new vec3(0.9, 0.93, 1), rimExp: 2.5, rim: 0.45},
  sensor: {base: new vec3(0.05, 0.09, 0.1), metallic: 0.3, roughness: 0.2, rimColor: new vec3(0.55, 0.95, 1), rimExp: 2.5, rim: 0.6},
  wax: {base: new vec3(0.62, 0.6, 0.55), metallic: 0, roughness: 0.6, rimColor: new vec3(1, 0.84, 0.62), rimExp: 2.2, rim: 0.35}
}

// ---------------- Candle (subject-local cm at 1x: base at -1, flame tip at +1 on the axis) ----------------
const CANDLE_R = 0.333
const CANDLE_TOP = 0.3
const WICK_TOP = 0.43
/** The rail's leader stops this far short of the replica's centre (cm). */
const RAIL_LEADER_STOP = 20
const DISTANCE_LABEL = "candle_d"
const DISTANCE_LABEL_LIFT = 4
const FLAME_BASE = 0.33
const FLAME_W = 0.15
const FLAME_WHITE = new vec4(1, 0.94, 0.82, 1)
const FLAME_AMBER = new vec4(1, 0.56, 0.16, 1)
const WAX_GLOW = new vec4(1, 0.72, 0.4, 1)

// ---------------- Light pulses ----------------
/** Pulse speed along the rays (local cm/s) and the time between pulses on one ray (s). */
const PULSE_SPEED = 22
const PULSE_PERIOD = 0.6
const PULSE_POOL = 48
/** The steady rays' light relative to the pulses (setFade factor). */
const RAY_STEADY = 0.72

// ---------------- Photo print (world cm) ----------------
/** The image area (the sensor's 3:2 frame enlarged) and its white border. */
const PRINT_IMG_W = 12
const PRINT_IMG_H = 8
const PRINT_BORDER = 0.8
/** The bottom border is wider, instant-film style: the tag sits in it. */
const PRINT_CHIN = 2
const PRINT_W = PRINT_IMG_W + 2 * PRINT_BORDER
const PRINT_H = PRINT_IMG_H + PRINT_BORDER + PRINT_CHIN
/** The image area's centre above the card's centre. */
const PRINT_IMG_Y = (PRINT_CHIN - PRINT_BORDER) / 2
/** Where it floats: 75 cm from the eyes, a little below eye level (these drops first, cm). */
const PRINT_DIST = 75
const PRINT_DROPS = [12, 10, 14, 8, 16]
/** Its slow bob once it is there (cm, up and down). */
const PRINT_BOB = 0.35
/** The caption hangs this far below the print's bottom edge (cm, beyond the bob). */
const PRINT_CAPTION_GAP = 0.6
/**
 * Blur copies on the print: rings of the sunflower spiral (1 + 3R(R+1) copies). The bright flame
 * gets more, so a wide blur reads as one smooth patch of light rather than a cluster of flames.
 */
const PRINT_RINGS = 4
const PRINT_FLAME_RINGS = 6
/** The flame's light on the print, × the wax's: it stays the brightest thing even when blurred. */
const PRINT_FLAME_BOOST = 8
const PRINT_SLIDE = 0.3
const PRINT_RISE = 0.25
const PRINT_FLY = 0.35
const PRINT_DEVELOP = 1.2
const PRINT_ARRIVE = PRINT_SLIDE + PRINT_RISE + PRINT_FLY
/**
 * The tag's text scale (note style): letters about 1.2 cm tall from ascender to descender (the
 * note font's line box is ~1.5× that, 1.8 cm), centred in the 2 cm bottom border.
 */
const PRINT_TAG_SCALE = 1.8
/** The tag's ink on the white paper: deep enough to read as print, never black (additive display). */
const TAG_INK_SHARP = new vec4(0.04, 0.46, 0.6, 1)
const TAG_INK_BLURRY = new vec4(0.66, 0.35, 0.06, 1)
/** The print's picture: the warm glow behind the candle (light, additive), and the wax. */
const PRINT_GLOW_EDGE = new vec3(0.34, 0.19, 0.07)
const PRINT_GLOW_PEAK = new vec3(0.6, 0.38, 0.16)
const PRINT_WAX = new vec4(1, 0.96, 0.86, 1)
const PRINT_WAX_K = 0.9

// ---------------- Timeline (s) ----------------
const T_RISE = 0.7
const T_SEAT = 0.9
const T_TWIST = 1.1
const T_FLY0 = 1.12
const T_FLY1 = 2.72
const T_FILL = 0.4
const VF_BEAT = 3.0
const MIRROR_UP_DUR = 0.3
const LIVE_AT = VF_BEAT + 0.4
const RET_ASSEMBLE = 0.6
/** "Put it back" lifts 3 cm in 0.25 s, then flies. */
const RET_FLY0 = RET_ASSEMBLE + 0.25
const RET_FLY1 = RET_FLY0 + 1.6
const RET_END = RET_FLY1 + 0.7

/** Points along the thread from the real camera to the replica. */
const THREAD_N = 48

const LIGHT = ENERGY.light
const SIGNAL = ENERGY.signal
const DEG = Math.PI / 180
const ROOT2 = Math.SQRT1_2

interface Part {
  key: string
  label: string
  so: SceneObject
  rest: vec3
  apart: vec3
  a: number
  w: number
  e: number
  freed: boolean
  /** Materials the part fades with (none for the imported lens and body). */
  looks: Look[]
  /** Label anchor on the part (part-local) and where the words go (replica-local offset from the anchor). */
  anchor: vec3
  labelOff: vec3
}

/** A part material: a solid (fill and rim fade together) or a glow accent. */
interface Look {
  mat: Material
  solid: boolean
  base: vec3
  rim: number
}

interface Beam {
  so: SceneObject
  rmv: RenderMeshVisual
}

function setLayerDeep(so: SceneObject, layer: LayerSet): void {
  so.layer = layer
  for (let i = 0; i < so.getChildrenCount(); i++) setLayerDeep(so.getChild(i), layer)
}

function flatDir(v: vec3): vec3 {
  const f = new vec3(v.x, 0, v.z)
  return f.length > 1e-4 ? f.normalize() : new vec3(0, 0, -1)
}

/**
 * A soft band around a closed outline (XY, facing +Z): rows at the given outward offsets, each with
 * its colour (bright at the edge, fading to nothing). Corners use mitred offsets.
 */
function softOutline(k: MeshKit, pts: vec2[], offsets: number[], colors: vec4[]): void {
  const n = pts.length
  let area = 0
  for (let i = 0; i < n; i++) area += pts[i].x * pts[(i + 1) % n].y - pts[(i + 1) % n].x * pts[i].y
  const sgn = area > 0 ? 1 : -1
  const out = (a: vec2, b: vec2) => {
    const d = b.sub(a).normalize()
    return new vec2(d.y * sgn, -d.x * sgn)
  }
  const miter: vec2[] = []
  for (let i = 0; i < n; i++) {
    const n1 = out(pts[(i - 1 + n) % n], pts[i])
    const n2 = out(pts[i], pts[(i + 1) % n])
    const m = n1.add(n2).normalize()
    miter.push(m.uniformScale(1 / Math.max(0.35, m.dot(n1))))
  }
  const nz = new vec3(0, 0, 1)
  const base: number[] = []
  offsets.forEach((o, r) => {
    base.push(k.vert(new vec3(pts[0].x + miter[0].x * o, pts[0].y + miter[0].y * o, 0), nz, colors[r]))
    for (let i = 1; i < n; i++) k.vert(new vec3(pts[i].x + miter[i].x * o, pts[i].y + miter[i].y * o, 0), nz, colors[r])
  })
  for (let r = 0; r < offsets.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = base[r] + i
      const b = base[r] + ((i + 1) % n)
      const c = base[r + 1] + ((i + 1) % n)
      const d = base[r + 1] + i
      k.tri(a, b, c)
      k.tri(a, c, d)
    }
}

function bezier(a: vec3, c: vec3, b: vec3, t: number): vec3 {
  const u = 1 - t
  return a.uniformScale(u * u).add(c.uniformScale(2 * u * t)).add(b.uniformScale(t * t))
}

function circle(center: vec3, u: vec3, v: vec3, r: number, n: number): vec3[] {
  const pts: vec3[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push(center.add(u.uniformScale(Math.cos(a) * r)).add(v.uniformScale(Math.sin(a) * r)))
  }
  return pts
}

/**
 * A flame outline (XY, counter-clockwise): round bottom at y0, pointed tip at y1, widest
 * (half-width w) about a third of the way up.
 */
function flameOutline(y0: number, y1: number, w: number, n: number = 14): vec2[] {
  const right: vec2[] = []
  for (let i = 0; i <= n; i++) {
    const s = Math.pow(i / n, 1.4)
    right.push(new vec2((w * Math.sqrt(s) * Math.pow(1 - s, 1.2)) / 0.357, y0 + (y1 - y0) * s))
  }
  const pts = right.slice()
  for (let i = n - 1; i >= 1; i--) pts.push(new vec2(-right[i].x, right[i].y))
  return pts
}

/**
 * A soft glow filling a closed outline: concentric copies scaled about `c` (scales ascending, the
 * last usually 1 with a transparent colour), each with its colour; the centre point gets `cc`.
 */
function addGlowFan(k: MeshKit, pts: vec2[], c: vec2, rings: {s: number; col: vec4}[], cc: vec4, z: number = 0): void {
  const nz = new vec3(0, 0, 1)
  const n = pts.length
  const ci = k.vert(new vec3(c.x, c.y, z), nz, cc)
  const starts = rings.map((r) => {
    const b = k.vertexCount
    for (const p of pts) k.vert(new vec3(c.x + (p.x - c.x) * r.s, c.y + (p.y - c.y) * r.s, z), nz, r.col)
    return b
  })
  for (let i = 0; i < n; i++) k.tri(ci, starts[0] + i, starts[0] + ((i + 1) % n))
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = starts[r] + i
      const b = starts[r] + ((i + 1) % n)
      const c2 = starts[r + 1] + ((i + 1) % n)
      const d = starts[r + 1] + i
      k.tri(a, b, c2)
      k.tri(a, c2, d)
    }
}

/** The outer flame: warm white, brightest a little inside its edge, dimmer in the middle (the core shows there). */
function addOuterFlame(k: MeshKit, y0: number, y1: number, w: number, m: number, mono: vec4 | null, z: number = 0): void {
  const col = mono ?? FLAME_WHITE
  const H = y1 - y0
  addGlowFan(k, flameOutline(y0, y1, w), new vec2(0, y0 + 0.3 * H), [{s: 0.45, col: ink(col, 0.5 * m)}, {s: 0.8, col: ink(col, 0.95 * m)}, {s: 1, col: ink(col, 0)}], ink(col, 0.28 * m), z)
}

/** The flame's amber core, low in the flame. */
function addFlameCore(k: MeshKit, y0: number, y1: number, w: number, m: number, mono: vec4 | null, z: number = 0): void {
  const col = mono ?? FLAME_AMBER
  const H = y1 - y0
  addGlowFan(k, flameOutline(y0 + 0.03 * H, y0 + 0.56 * H, 0.62 * w), new vec2(0, y0 + 0.22 * H), [{s: 0.55, col: ink(col, 0.95 * m)}, {s: 1, col: ink(col, 0)}], ink(col, m), z)
}

/**
 * The candle as an image (XY, facing +Z), base at y = -0.5 and flame tip at +0.5 (height 1): what
 * the lens projects. `m` scales its light; `mono` draws it in one colour (the sensor's signal glow).
 */
function addCandleImage(k: MeshKit, m: number, mono: vec4 | null): void {
  const h = HERO_H_O / SCALE
  const u = (y: number) => y / h
  const r = CANDLE_R / h
  const top = u(CANDLE_TOP)
  const wax = mono ?? new vec4(0.95, 0.92, 0.85, 1)
  const glow = mono ?? WAX_GLOW
  k.addRectXY(-r, -0.5, r, top - 0.02, ink(wax, 0.6 * m))
  // Rounded shoulders, and the top of the wax lit warm by the flame.
  k.addRectXY(-r * 0.9, top - 0.02, r * 0.9, top, ink(wax, 0.6 * m))
  k.addRectXY(-r, top - 0.2, r, top - 0.02, ink(glow, 0), ink(glow, 0), ink(glow, 0.3 * m), ink(glow, 0.3 * m))
  k.addRectXY(-0.008, top, 0.008, u(WICK_TOP), ink(mono ?? new vec4(0.55, 0.38, 0.22, 1), 0.6 * m))
  // The flame's own soft glow around it, then the flame.
  const fy = u(FLAME_BASE) + 0.3 * (0.5 - u(FLAME_BASE))
  k.addFanXY(0, fy, 0.2, 0, Math.PI * 2, ink(mono ?? WAX_GLOW, 0.3 * m), ink(mono ?? WAX_GLOW, 0), 24)
  addOuterFlame(k, u(FLAME_BASE), 0.5, FLAME_W / h, m, mono)
  addFlameCore(k, u(FLAME_BASE), 0.5, FLAME_W / h, m, mono)
}

/** The print tag's words in their ink colour at opacity `a`. */
function setTagInk(t: Text, c: vec4, a: number): void {
  t.textFill.color = new vec4(c.x, c.y, c.z, clamp01(a))
}

/** Points spread evenly over the unit disc on a sunflower spiral (even density, no lattice): 1 + 3R(R+1). */
function spiralOffsets(rings: number): vec2[] {
  const count = 1 + 3 * rings * (rings + 1)
  const out: vec2[] = []
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count)
    const a = i * 2.399963
    out.push(new vec2(Math.cos(a) * r, Math.sin(a) * r))
  }
  return out
}

/**
 * The candle as the print shows it (same frame as addCandleImage), in two parts drawn with their own
 * copy counts: the wax (light cream, its top lit warm by the flame), and the wick and flame, the
 * flame `flameBoost` times brighter than in addCandleImage so it stays the brightest thing in the
 * photo even when the blur spreads it wide. `m` scales each part's light (1/√copies).
 */
function addPrintWax(k: MeshKit, m: number): void {
  const h = HERO_H_O / SCALE
  const r = CANDLE_R / h
  const top = CANDLE_TOP / h
  const wax = ink(PRINT_WAX, PRINT_WAX_K * m)
  k.addRectXY(-r, -0.5, r, top - 0.02, wax)
  k.addRectXY(-r * 0.9, top - 0.02, r * 0.9, top, wax)
  k.addRectXY(-r, top - 0.2, r, top - 0.02, ink(WAX_GLOW, 0), ink(WAX_GLOW, 0), ink(WAX_GLOW, 0.3 * m), ink(WAX_GLOW, 0.3 * m))
}

function addPrintFlame(k: MeshKit, m: number, flameBoost: number): void {
  const h = HERO_H_O / SCALE
  const u = (y: number) => y / h
  const top = u(CANDLE_TOP)
  k.addRectXY(-0.008, top, 0.008, u(WICK_TOP), ink(new vec4(0.55, 0.38, 0.22, 1), 0.6 * m))
  const fy = u(FLAME_BASE) + 0.3 * (0.5 - u(FLAME_BASE))
  k.addFanXY(0, fy, 0.2, 0, Math.PI * 2, ink(WAX_GLOW, 0.3 * m * Math.SQRT2), ink(WAX_GLOW, 0), 24)
  const f = m * Math.sqrt(flameBoost)
  addOuterFlame(k, u(FLAME_BASE), 0.5, FLAME_W / h, f, null)
  addFlameCore(k, u(FLAME_BASE), 0.5, FLAME_W / h, f, null)
}

/**
 * The photo on the print (fix pass): what the sensor recorded, filling the image area `w` × `h`
 * (centred on the origin, XY facing +Z) as one static mesh. Nothing in it is black, so all of it
 * reads on an additive display.
 * - A soft warm glow fills the frame: dim amber at the edges, brightest around the flame.
 * - The candle stands in it upright, `ch` cm tall and centred: light cream wax; the flame is the
 *   brightest thing.
 * - The sensor's blur (`c` cm on the print) applies to the whole picture. The candle is drawn as
 *   copies spread evenly over the blur disc (each 1/N of the light), the glow is widened by the same
 *   disc (variance c²/16 per axis, its light kept), and the wax hides the glow behind it in the
 *   proportion its copies cover each point, so sharp or blurred it reads as wax in front of the glow.
 *   Every copy is clipped to the image area, which keeps the photo's edge crisp.
 */
function buildPrintPicture(w: number, h: number, ch: number, c: number, rings: number, flameRings: number): RenderMesh {
  const offsets = spiralOffsets(rings).map((o) => o.uniformScale(c / 2))
  const N = offsets.length
  const hw = w / 2
  const hh = h / 2
  const unit = HERO_H_O / SCALE
  // The wax's outline (cm): x within ±wr, y from wy0 to wy1.
  const wr = (CANDLE_R / unit) * ch
  const wy0 = -0.5 * ch
  const wy1 = (CANDLE_TOP / unit) * ch
  const R = c / 2
  const cover = (x: number, y: number): number => {
    if (x + R < -wr || x - R > wr || y + R < wy0 || y - R > wy1) return 0
    if (x - R >= -wr && x + R <= wr && y - R >= wy0 && y + R <= wy1) return 1
    let n = 0
    for (const o of offsets) {
      const px = x - o.x
      const py = y - o.y
      if (px >= -wr && px <= wr && py >= wy0 && py <= wy1) n++
    }
    return n / N
  }
  // The glow, centred on the flame.
  const fy = ((FLAME_BASE + 0.35 * (unit / 2 - FLAME_BASE)) / unit) * ch
  const s0 = Math.min(3.2, Math.max(1.6, 0.75 * ch))
  const s2 = s0 * s0 + (c * c) / 16
  const amp = (s0 * s0) / s2
  // Grid lines every 0.25 cm, plus the wax's edges and, when blurred, the band the blur spreads them over.
  const lines = (lo: number, hi: number, edges: number[]): number[] => {
    const out: number[] = []
    const n = Math.ceil((hi - lo) / 0.25)
    for (let i = 0; i <= n; i++) out.push(lo + ((hi - lo) * i) / n)
    for (const e of edges) {
      out.push(e)
      if (c > 0.02) {
        const m = Math.min(24, Math.max(2, Math.ceil(c / 0.1)))
        for (let i = 0; i <= m; i++) out.push(e - R + (c * i) / m)
      }
    }
    const sorted = out.filter((v) => v >= lo && v <= hi).sort((a, b) => a - b)
    return sorted.filter((v, i) => i === 0 || v - sorted[i - 1] > 1e-3)
  }
  const xs = lines(-hw, hw, [-wr, wr])
  const ys = lines(-hh, hh, [wy0, wy1])
  const k = new MeshKit()
  const nz = new vec3(0, 0, 1)
  const g0 = k.vertexCount
  // Glow light per vertex (alpha 1, so the additive light is the colour itself).
  for (const y of ys)
    for (const x of xs) {
      const g = amp * Math.exp(-(x * x + (y - fy) * (y - fy)) / (2 * s2))
      const keep = 1 - cover(x, y)
      k.vert(new vec3(x, y, 0), nz, new vec4((PRINT_GLOW_EDGE.x + PRINT_GLOW_PEAK.x * g) * keep, (PRINT_GLOW_EDGE.y + PRINT_GLOW_PEAK.y * g) * keep, (PRINT_GLOW_EDGE.z + PRINT_GLOW_PEAK.z * g) * keep, 1))
    }
  const nx = xs.length
  for (let j = 0; j + 1 < ys.length; j++)
    for (let i = 0; i + 1 < nx; i++) {
      const a = g0 + j * nx + i
      k.tri(a, a + 1, a + nx + 1)
      k.tri(a, a + nx + 1, a + nx)
    }
  // The candle: copies over the blur disc, each clipped to the image area. The wax uses the same
  // copies its hole in the glow was cut with; the flame has its own, denser set.
  const wax = new MeshKit()
  addPrintWax(wax, 1 / Math.sqrt(N))
  for (const o of offsets) k.addClippedXY(wax, ch, o.x, o.y, -hw, -hh, hw, hh)
  const flameOffsets = spiralOffsets(flameRings).map((o) => o.uniformScale(c / 2))
  const flame = new MeshKit()
  addPrintFlame(flame, 1 / Math.sqrt(flameOffsets.length), PRINT_FLAME_BOOST)
  for (const o of flameOffsets) k.addClippedXY(flame, ch, o.x, o.y, -hw, -hh, hw, hh)
  return k.build()
}

/** The candle image's outline (same frame as addCandleImage): the wax body and the flame. */
function candleOutline(): vec2[][] {
  const h = HERO_H_O / SCALE
  const r = CANDLE_R / h
  const top = CANDLE_TOP / h
  const flame = flameOutline(FLAME_BASE / h, 0.5, FLAME_W / h)
  return [[new vec2(-r, -0.5), new vec2(r, -0.5), new vec2(r, top), new vec2(-r, top), new vec2(-r, -0.5)], flame.concat([flame[0]])]
}

/**
 * The subject's image (the candle and its flame, base at -0.5, tip at +0.5) drawn as N additive
 * copies spread over a disc. Moving the copies apart is the blur; only transforms change.
 * `mono` = one colour (the signal glow and flash); null = the candle's own colours.
 */
class BlurImage {
  readonly so: SceneObject
  readonly mat: Material
  private copies: SceneObject[] = []
  private offsets: vec2[] = []

  constructor(parent: SceneObject, name: string, material: Material, mono: vec4 | null, rings: number) {
    this.so = global.scene.createSceneObject(name)
    this.so.setParent(parent)
    // Copies spread evenly over the blur disk.
    this.offsets = spiralOffsets(rings)
    const k = new MeshKit()
    // The glow material blends Add with source alpha, and ink() premultiplies, so a copy's light
    // goes with k²: k = 1/√N gives each copy 1/N of the light and N stacked copies exactly 1.
    addCandleImage(k, 1 / Math.sqrt(this.offsets.length), mono)
    const mesh = k.build()
    this.mat = material.clone()
    this.mat.mainPass.twoSided = true
    this.offsets.forEach((_, i) => {
      const so = global.scene.createSceneObject(name + "Copy" + i)
      so.setParent(this.so)
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = mesh
      rmv.mainMaterial = this.mat
      this.copies.push(so)
    })
    setFade(this.mat, 0)
  }

  /** Height `h` (negative = upside down), blur circle diameter `c`, in the parent's units. */
  update(h: number, c: number, alpha: number): void {
    const s = Math.max(1e-4, Math.abs(h))
    this.copies.forEach((so, i) => {
      const o = this.offsets[i]
      const tr = so.getTransform()
      tr.setLocalPosition(new vec3((o.x * c) / 2, (o.y * c) / 2, 0))
      tr.setLocalScale(new vec3(s, h >= 0 ? s : -s, 1))
    })
    // Each copy carries 1/N of the light, so a sharp image adds up to full brightness. Spread
    // wide, the same light becomes too faint to read on an additive display, so the copies get
    // brighter as the blur grows (up to 4x when the blur circle is as big as the image).
    // setFade's factor also lands squared, hence √gain.
    const gain = 1 + 3 * Math.min(1, c / Math.max(1e-3, s))
    setFade(this.mat, alpha * Math.sqrt(gain))
  }
}

/** A spring that settles in about the given duration (critically damped), 0..1 → 0..1. */
function springOut(u: number): number {
  const x = clamp01(u)
  const w = 7
  return (1 - (1 + w * x) * Math.exp(-w * x)) / (1 - (1 + w) * Math.exp(-w))
}

/** The part of segment a-b inside the disc of radius r at the origin (x0, y0, x1, y1), or null. */
function clipToDisc(ax: number, ay: number, bx: number, by: number, r: number): number[] | null {
  const dx = bx - ax
  const dy = by - ay
  const A = dx * dx + dy * dy
  const B = 2 * (ax * dx + ay * dy)
  const C = ax * ax + ay * ay - r * r
  const disc = B * B - 4 * A * C
  if (A < 1e-12 || disc <= 0) return null
  const q = Math.sqrt(disc)
  const t0 = Math.max(0, (-B - q) / (2 * A))
  const t1 = Math.min(1, (-B + q) / (2 * A))
  if (t1 <= t0) return null
  return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1]
}

/** The camera hero stage. Owned by CutawayMain; one instance, created on launch, cleared on finish/Reset. */
export class CameraHero {
  state: HeroState = "none"
  /** Test hook: freeze the stage's timeline (for screenshots of one beat). */
  hold = false

  private root: SceneObject
  private replica: SceneObject
  private layer: LayerSet
  private layerMade = false
  private bodySo: SceneObject
  private bodyMat: Material
  private barrelSo: SceneObject
  private barrelMat: Material
  private elementsSo: SceneObject
  private elementSos: SceneObject[] = []
  private apertureSo: SceneObject
  private blades: Blade[] = []
  private bladeSos: SceneObject[] = []
  private irisOpen = 0
  private parts: Part[] = []
  private lensPart: Part
  private elementsPart: Part
  private aperturePart: Part
  private bodyPart: Part
  private mirrorPart: Part
  private prismPart: Part
  private viewfinderPart: Part
  private shutterPart: Part
  private sensorPart: Part
  private mirrorPlate: SceneObject
  private curtains: SceneObject[] = []
  private slats: SceneObject[][] = []
  private sheen: SceneObject | null = null
  private sheenMat: Material | null = null
  private partTris: {[key: string]: {solid: number; accent: number}} = {}
  private shellTris = 0
  /** 0..1: how far the shell has moved toward its light-path place (eased). */
  private farK = 0
  private sensorGlow: BlurImage
  private sensorImage: BlurImage
  private sensorFlash: BlurImage

  private t = 0
  private s = 0
  private shellFill = 0
  private shellRim = 0.9
  private globalFade = 1
  // Launch / flight geometry (world)
  private head0: vec3
  private realCenter: vec3
  private rStart: quat
  private pStart: vec3
  private pMeet: vec3
  private pLand: vec3
  private ctrl: vec3
  private rLand: quat
  private yaw = 0
  private bagRot: quat
  private trail: TrailRibbon | null = null
  private trailPts: vec3[] = []
  private thread: TrailRibbon | null = null
  private threadPts: vec3[] = []
  private threadCum: number[] = []
  private threadT = -1
  private pulse: SceneObject | null = null
  private pulseMat: Material | null = null
  // Pass 2: the table, physics, pose on the table, grabs, contact glow and hover disc.
  private physics: HeroPhysics | null = null
  private surf: TableSurface
  private pose: HeroPose = "fly"
  private poseT = 0
  /** Footprint centre (world; y unused) and the lowest point's height above the table top (cm). */
  private foot = vec3.zero()
  private h = 0
  private h0 = 0
  private restGap = 0
  private holdK = 0
  private sEff = 0
  private discK = 0
  private firstRest = true
  private drop = {t: 0, touched: false, touchT: -1, stillT: 0, bounce: 0, settle: -1, contact: null as vec3 | null}
  private lastDrop: {bounce: number; settle: number; restGap: number; tiltDeg: number} | null = null
  private lastPivot: vec3 | null = null
  private speed = 0
  private grabs: {slide: SceneObject; turn: SceneObject} | null = null
  private grab: {kind: "slide" | "turn"; p0: vec3; usePlane: boolean; foot0: vec3; yaw0: number; angPrev: number; turned: number; accum: vec3} | null = null
  private contactGlow: SceneObject | null = null
  private contactGlowMat: Material | null = null
  private disc: SceneObject | null = null
  private discMat: Material | null = null
  private retPos: vec3 | null = null
  private retH = 0
  private brackets: SceneObject | null = null
  private bracketMat: Material | null = null
  private landed = false
  // Returning
  private retFrom: {s: number; rot: quat; lightK: number} | null = null
  // Light path
  private lightT = 0
  private live = false
  private d_o = 50
  private L = L_APART
  private mirrorUp = 0
  private subject: SceneObject | null = null
  private subjectMat: Material | null = null
  // Candle (the subject): wax look, the flame billboard and its flicker nodes, optics markers.
  private waxLook: Look | null = null
  private flameSo: SceneObject | null = null
  private flickerSo: SceneObject | null = null
  private coreSo: SceneObject | null = null
  private haloSo: SceneObject | null = null
  private flameMat: Material | null = null
  private haloMat: Material | null = null
  private candleTip: SceneObject | null = null
  private candleBase: SceneObject | null = null
  private flameA = 0
  private flameScaleY = 1
  // Light pulses along the rays, and where the rays start (replica-local).
  private rayPulses: SceneObject[] = []
  private rayPulseMat: Material | null = null
  private rayPulseCount = 0
  private rayStarts: vec3[] = []
  private raysSo: SceneObject | null = null
  private beams: Beam[] = []
  private beamMesh: RenderMesh | null = null
  private rayMat: Material | null = null
  private rayFaintMat: Material | null = null
  private bubble: SceneObject | null = null
  private bubbleFace: SceneObject | null = null
  private bubbleMat: Material | null = null
  private bubbleImage: BlurImage | null = null
  private bubbleFlash: BlurImage | null = null
  private bubbleSharp: SceneObject | null = null
  private bubbleSharpMat: Material | null = null
  private bubbleLeader: Beam | null = null
  private bubbleOpen = 0
  private sharpK = 0
  private captionKey = ""
  private captionHoldT = 0
  // Photo
  private shotT = -1
  private print: SceneObject | null = null
  private printT = 0
  private printBlur = -1
  private printH = 0
  /** The print's image on the card: candle height and blur circle (cm), and its tag. */
  private printImgH = 0
  private printImgC = 0
  private printTagText = ""
  private printTag: Text | null = null
  private printTagInk = TAG_INK_SHARP
  private printBlankMat: Material | null = null
  private printTarget: vec3 | null = null
  private printFrom: {pos: vec3; rot: quat} | null = null
  private printLogged = {shown: false, developed: false}
  private oldPrints: {so: SceneObject; t: number; mats: Material[]; tag: Text | null; ink: vec4}[] = []
  private printMats: Material[] = []
  /** The picture's material (it fades in as the print develops). */
  private printPicMat: Material | null = null
  /** Prints taken off the stage, destroyed a couple of frames later (see buryPrints). */
  private grave: {so: SceneObject; frames: number}[] = []
  private flashT = -1
  // Subject drag
  private subjectDrag: {p: vec3; d: number; axis: vec3} | null = null
  private subjectAccum = vec3.zero()
  private landTime = -1
  private lastLandPos: vec3 | null = null
  // Leaving the light path (the take-apart slider dragged back below 1)
  private exitT = -1
  private exitMirror = 0
  // Test hooks: when the launch started and the replica came to rest (getTime()).
  private launchedAt = -1
  private landedAt = -1

  constructor(private ctx: HeroContext) {}

  // =====================================================================================
  // Public API
  // =====================================================================================

  get isOut(): boolean {
    return this.state !== "none"
  }

  /** Pinch "Bring it closer": build the copy at the real camera and start the launch. */
  launch(): void {
    if (this.state !== "none") return
    this.build()
    this.state = "launch"
    this.t = 0
    this.landed = false
    this.flags = {click: false, flight: false}
    this.retFlags = {click: false, flight: false}
    this.shotFlags = {flash: false, print: false}
    this.globalFade = 1
    this.trailPts = []
    this.landTime = -1
    this.lastLandPos = null
    this.exitT = -1
    this.launchedAt = getTime()
    this.landedAt = -1
    this.s = 0
    this.barrelFill = 1
    this.bodyFill = 1
    this.captionHoldT = 0
    this.sharpK = 0
    this.head0 = this.ctx.camPos()
    const real = this.realPose()
    const rb = this.ctx.realBounds()
    const facing = flatDir(this.ctx.realFacing)
    this.realCenter = rb.center
    this.rStart = real.rotation
    this.pStart = real.position
    const bag = this.ctx.bag()
    this.pMeet = this.clearOfHead(vec3.lerp(this.realCenter, bag, 0.5).add(new vec3(0, 30, 0)), 40)
    this.surf = this.ctx.surface()
    const table = this.surf.center
    // Facing rule: the optical axis runs across the view (lens to the user's left), so the light
    // path later reads sideways, never toward the eye.
    const F = flatDir(table.sub(this.head0))
    const right = F.cross(vec3.up()).normalize()
    this.rLand = quat.lookAt(right.uniformScale(-1), vec3.up())
    this.yaw = 0
    // The flight ends 20 cm above the table centre (footprint centre over it), then it drops.
    this.foot = new vec3(table.x, table.y, table.z)
    this.pose = "fly"
    this.firstRest = true
    this.sEff = 0
    this.discK = 0
    this.holdK = 0
    this.grab = null
    this.lastDrop = null
    this.lastPivot = null
    this.speed = 0
    this.physics = new HeroPhysics(this.root, this.surf, {matter: this.ctx.matter, log: (m) => this.ctx.log(m)})
    this.physics.onContact((p, imp) => this.onContact(p, imp))
    this.pLand = this.pivotFor(this.foot, 0, DROP_CM)
    this.ctrl = this.flightControl()
    this.bagRot = quat.lookAt(vec3.up(), facing)
    this.ctx.sound("lift", this.realCenter)
    this.flashBrackets(rb)
    this.ctx.rail.setMode("none", true)
    this.ctx.log("hero:launch")
    this.applyLaunch()
    // Find the real table top now (World Query hit test, or the fallback); the flight's end and the
    // table collider follow whatever the survey finds.
    this.ctx.survey((s) => this.onSurface(s))
  }

  /** A survey finished: aim the flight at the table centre it found, and rebuild the collider. */
  private onSurface(s: TableSurface): void {
    if (this.state === "none") return
    this.surf = s
    if (this.physics) this.physics.setSurface(s)
    this.ctx.log("hero:surface:" + s.method)
    if (this.state === "launch") {
      this.foot = new vec3(s.center.x, s.height, s.center.z)
      this.pLand = this.pivotFor(this.foot, 0, DROP_CM)
    } else if (this.pose === "rest" && !this.grab) {
      this.foot = this.clampFoot(this.foot, this.rot())
      this.startDrop()
    }
  }

  /** "Put it back": reassemble, fly home, melt into the real camera. */
  putBack(): void {
    if (this.state !== "landed" && this.state !== "light") return
    if (this.physics) {
      // Whatever it was doing (settling, hovering, held), it is kinematic from here on.
      if (this.pose === "drop") this.toRest(true)
      this.physics.freeze()
    }
    this.grab = null
    this.pose = "lift"
    this.retH = this.h
    this.retFrom = {s: this.s, rot: this.replica.getTransform().getWorldRotation(), lightK: this.state === "light" ? 1 : 0}
    this.state = "returning"
    this.t = 0
    this.ctx.rail.setMode("none")
    this.hideAllLabels()
    this.ctx.caption(null)
    this.captionKey = ""
    this.ctx.log("hero:putBack")
  }

  /** Take a photo (live view only). */
  photo(): void {
    if (this.state !== "light" || !this.live || this.shotT >= 0) return
    this.shotT = 0
    this.ctx.sound("shutter", this.partWorld(this.shutterPart))
    this.ctx.log("hero:photo")
  }

  /** Reset: remove everything instantly, from any state. */
  clear(): void {
    this.buryPrints()
    if (this.root) this.root.destroy()
    this.root = null
    this.state = "none"
    this.trail = null
    this.thread = null
    this.threadPts = []
    this.pulse = null
    this.physics = null
    this.grabs = null
    this.grab = null
    this.contactGlow = null
    this.disc = null
    this.pose = "fly"
    this.brackets = null
    this.subject = null
    this.raysSo = null
    this.beams = []
    this.bubble = null
    this.bubbleLeader = null
    this.print = null
    this.printPicMat = null
    this.printTag = null
    this.printBlankMat = null
    this.printMats = []
    this.oldPrints = []
    this.resetCandle()
    this.parts = []
    this.elementSos = []
    this.curtains = []
    this.slats = []
    this.blades = []
    this.bladeSos = []
    this.sheen = null
    this.sheenMat = null
    this.partTris = {}
    this.farK = 0
    this.shotT = -1
    this.flashT = -1
    this.printBlur = -1
    this.live = false
    this.exitT = -1
    this.ctx.rail.setMode("none", true)
    this.ctx.caption(null)
    this.captionKey = ""
  }

  update(dt: number): void {
    this.updateGrave()
    if (this.state === "none") return
    if (this.hold) dt = 0
    this.t += dt
    switch (this.state) {
      case "launch":
        this.applyLaunch()
        if (this.t >= T_FLY1) this.endFlight()
        break
      case "landed":
        this.updateLanded(dt)
        break
      case "light":
        this.updateLight(dt)
        break
      case "returning":
        this.updateReturn(dt)
        break
    }
    // updateReturn may have cleared the stage.
    if ((this.state as HeroState) === "none") return
    this.syncGrabs()
    this.updateGlowAndDisc(dt)
    this.updateThread(dt)
    this.updateTrail()
    this.updateBrackets()
    this.updateShell()
    this.updatePrints(dt)
    this.placeRail()
    const piv = this.replica.getTransform().getWorldPosition()
    if (this.lastPivot && dt > 0) this.speed = piv.distance(this.lastPivot) / dt
    this.lastPivot = piv
  }

  // ---------------- Test hooks / read-only state ----------------

  setApart(v: number): void {
    this.ctx.rail.setApartValue(v)
  }

  setFocusL(L: number): void {
    this.ctx.rail.setFocusValue((L - HERO_L_MIN) / (HERO_L_MAX - HERO_L_MIN))
    this.L = Math.max(HERO_L_MIN, Math.min(HERO_L_MAX, L))
  }

  setSubjectDistance(d: number): void {
    this.d_o = Math.max(HERO_D_MIN, Math.min(HERO_D_MAX, d))
  }

  getLightPhase(): "none" | "viewfinder" | "mirrorUp" | "live" {
    if (this.state !== "light") return "none"
    if (this.lightT < VF_BEAT) return "viewfinder"
    return this.live ? "live" : "mirrorUp"
  }

  /** True when the rays end on the sensor (mirror up), false while the mirror sends them up. */
  raysReachSensor(): boolean {
    return this.state === "light" && this.mirrorUp > 0.5
  }

  isSubjectShown(): boolean {
    return !!this.subject && this.subject.enabled
  }

  getOptics(): HeroOptics {
    const di = imageDistance(this.d_o)
    const c = blurCircle(this.d_o, this.L)
    return {d_o: this.d_o, d_i: di, L: this.L, h_i: (HERO_H_O * this.L) / this.d_o, c, sharp: c <= SHARP_C}
  }

  /**
   * The live print: the sensor's blur and image height when it was taken, the image's blur and
   * height on the card, the tag, how far it has developed (0..1) and how long it has been out.
   */
  getPrint(): {shown: boolean; blur: number; height: number; imageBlur: number; imageHeight: number; tag: string; developed: number; age: number} {
    const shown = !!this.print && this.print.enabled
    return {
      shown,
      blur: this.printBlur,
      height: this.printH,
      imageBlur: shown ? this.printImgC : -1,
      imageHeight: shown ? this.printImgH : 0,
      tag: shown ? this.printTagText : "",
      developed: shown ? clamp01((this.printT - PRINT_ARRIVE) / PRINT_DEVELOP) : 0,
      age: shown ? this.printT : -1
    }
  }

  /** The live print's SceneObject (the one named HERO_PRINT_NAME), or null. */
  getPrintObject(): SceneObject | null {
    return this.print
  }

  /**
   * The live print's layout (tests): its card's 4 world corners, the card's size and borders (cm),
   * and the tag's words in the card's own cm (origin at the card's centre, x right, y up).
   */
  getPrintLayout(): {card: vec3[]; w: number; h: number; border: number; chin: number; tag: {x0: number; x1: number; y0: number; y1: number} | null} | null {
    if (!this.print) return null
    const m = this.print.getTransform().getWorldTransform()
    const W = PRINT_W / 2
    const H = PRINT_H / 2
    const card = [new vec3(-W, -H, 0), new vec3(W, -H, 0), new vec3(W, H, 0), new vec3(-W, H, 0)].map((q) => m.multiplyPoint(q))
    let tag: {x0: number; x1: number; y0: number; y1: number} | null = null
    if (this.printTag) {
      try {
        const r = this.printTag.getBoundingBox()
        const tr = this.printTag.getSceneObject().getTransform()
        const p = tr.getLocalPosition()
        const s = tr.getLocalScale().x
        tag = {x0: p.x + r.left * s, x1: p.x + r.right * s, y0: p.y + r.bottom * s, y1: p.y + r.top * s}
      } catch (e) {
        tag = null
      }
    }
    return {card, w: PRINT_W, h: PRINT_H, border: PRINT_BORDER, chin: PRINT_CHIN, tag}
  }

  /** The candle: flame tip and base (world), the rays' start points (world), the flame's stretch. */
  getCandleReport(): {tip: vec3; base: vec3; up: vec3; rayStarts: vec3[]; flameScaleY: number; flameShown: boolean} | null {
    if (!this.subject || !this.candleTip || !this.candleBase) return null
    const m = this.replica.getTransform().getWorldTransform()
    return {
      tip: this.candleTip.getTransform().getWorldPosition(),
      base: this.candleBase.getTransform().getWorldPosition(),
      up: this.replica.getTransform().up,
      rayStarts: this.rayStarts.map((p) => m.multiplyPoint(p)),
      flameScaleY: this.flameScaleY,
      flameShown: !!this.flameSo && this.flameSo.isEnabledInHierarchy && this.flameA > 0.5
    }
  }

  /** Visible light pulses (world positions). */
  getPulses(): vec3[] {
    const out: vec3[] = []
    for (let i = 0; i < this.rayPulseCount && i < this.rayPulses.length; i++) if (this.rayPulses[i].enabled) out.push(this.rayPulses[i].getTransform().getWorldPosition())
    return out
  }

  getShotPhase(): number {
    return this.shotT
  }

  isSensorFlashing(): boolean {
    return this.flashT >= 0 && this.flashT < 0.6
  }

  getReplica(): SceneObject | null {
    return this.state === "none" ? null : this.replica
  }

  getInfo(): {
    state: HeroState
    pose: HeroPose
    scale: number
    position: vec3
    up: vec3
    lowestY: number
    tableY: number
    threadOk: boolean
    landSound: vec3 | null
    foot: vec3
    tableCenter: vec3
    tableRadius: number
    footReach: number
    speed: number
    held: boolean
    discShown: boolean
    glowShown: boolean
    lastDrop: {bounce: number; settle: number; restGap: number; tiltDeg: number} | null
  } {
    const live = !!this.replica && this.state !== "none"
    const tr = live ? this.replica.getTransform() : null
    const s = this.surf ?? this.ctx.surface()
    const foot = tr ? tr.getWorldTransform().multiplyPoint(new vec3(FOOT_CENTER.x, BODY_MIN_Y, FOOT_CENTER.y)) : vec3.zero()
    return {
      state: this.state,
      pose: this.pose,
      scale: tr ? tr.getWorldScale().x : 0,
      position: tr ? tr.getWorldPosition() : vec3.zero(),
      up: tr ? tr.up : vec3.up(),
      lowestY: tr ? this.lowestWorldY() : 0,
      tableY: s.height,
      threadOk: this.threadConnected(),
      landSound: this.lastLandPos,
      foot,
      tableCenter: s.center,
      tableRadius: s.safeRadius,
      footReach: tr ? footReach(foot, tr.getWorldRotation(), s.center) : 0,
      speed: this.speed,
      held: !!this.grab,
      discShown: !!this.disc && this.disc.enabled && this.discK > 0.95,
      glowShown: !!this.contactGlow && this.contactGlow.enabled,
      lastDrop: this.lastDrop
    }
  }

  /** The table top in use for this launch (hit test or fallback). */
  getSurface(): TableSurface {
    return this.surf ?? this.ctx.surface()
  }

  /** Every named part: how far it moved from its assembled place, and whether its label shows. */
  getParts(): HeroPartInfo[] {
    if (this.state === "none") return []
    const axis = this.replica.getTransform().forward
    const named = [this.elementsPart, this.aperturePart, this.parts.find((p) => p.key === "mount"), this.mirrorPart, this.prismPart, this.viewfinderPart, this.shutterPart, this.sensorPart]
    const out: HeroPartInfo[] = []
    for (const p of named) {
      if (!p) continue
      const now = this.partWorld(p)
      const rest = this.restWorld(p)
      const d = now.sub(rest)
      out.push({key: p.key, label: p.label, offset: d.length, alongAxis: d.dot(axis), labelShown: this.ctx.labels.isShown("hero_" + p.key)})
    }
    // The barrel and body (not labelled) are reported too, for the "back to rest" check.
    for (const p of [this.lensPart, this.bodyPart]) {
      const d = this.partWorld(p).sub(this.restWorld(p))
      out.push({key: p.key, label: p.label, offset: d.length, alongAxis: d.dot(axis), labelShown: false})
    }
    return out
  }

  getApart(): number {
    return this.s
  }

  /**
   * P5: for each interior part, the triangles of its solid meshes and of its line accents, how many
   * of its visible meshes render with the solid PBR material, and how much of its fill shows.
   */
  getSolidReport(): {parts: {key: string; solidTris: number; accentTris: number; solidMeshes: number; fill: number}[]; partTris: number; shellTris: number} {
    const keys = ["elements", "aperture", "mount", "mirror", "prism", "viewfinder", "shutter", "sensor"]
    const parts = keys.map((key) => {
      const p = this.parts.find((q) => q.key === key)
      const t = this.partTris[key] ?? {solid: 0, accent: 0}
      const solids = p ? p.looks.filter((l) => l.solid) : []
      let solidMeshes = 0
      const walk = (so: SceneObject) => {
        if (!so.enabled) return
        const rmv = so.getComponent("Component.RenderMeshVisual") as RenderMeshVisual
        if (rmv && rmv.enabled && solids.some((l) => l.mat === rmv.mainMaterial)) solidMeshes++
        for (let i = 0; i < so.getChildrenCount(); i++) walk(so.getChild(i))
      }
      if (p) walk(p.so)
      const l = solids[0]
      const fill = l ? l.mat.mainPass.baseColor.x / Math.max(1e-6, l.base.x) : 0
      return {key, solidTris: t.solid, accentTris: t.accent, solidMeshes, fill}
    })
    let partTris = 0
    for (const k of Object.keys(this.partTris)) partTris += this.partTris[k].solid + this.partTris[k].accent
    return {parts, partTris, shellTris: this.shellTris}
  }

  /** §9 clean-up (tests): the parts, shell, labels and bubble as the user sees them (world). */
  getLayout(): HeroLayout {
    const boxes = meshBoxes
    const parts = this.parts.filter((p) => p.looks.length && p.so.enabled).map((p) => ({key: p.key, label: p.label, boxes: boxes(p.so)}))
    const rail = this.railAnchor()
    let bubble: HeroLayout["bubble"] = null
    if (this.bubble && this.bubbleOpen > 0.01) bubble = {center: this.bubble.getTransform().getWorldPosition(), radius: BUBBLE_R * this.bubble.getTransform().getWorldScale().x, open: this.bubbleOpen}
    const labels = this.ctx.labels.getTextQuads().filter((q) => q.id.startsWith("hero_") || q.id === "caption")
    const railBoxes = this.ctx.rail.isVisible() ? this.ctx.rail.getBoxes() : []
    return {parts, shell: boxes(this.bodySo, this.bodyMat), labels, sensor: this.partWorld(this.sensorPart), rail, railBoxes, bubble}
  }

  /** When the last launch started and when the replica came to rest (getTime(), -1 if not yet). */
  getTimes(): {launchedAt: number; landedAt: number} {
    return {launchedAt: this.launchedAt, landedAt: this.landedAt}
  }

  getYawDeg(): number {
    return this.yaw / DEG
  }

  // =====================================================================================
  // Build
  // =====================================================================================

  private build(): void {
    this.clear()
    this.root = global.scene.createSceneObject("HeroStage")
    this.root.setParent(this.ctx.parent)
    const rtr = this.root.getTransform()
    rtr.setWorldPosition(vec3.zero())
    rtr.setWorldRotation(quat.quatIdentity())
    rtr.setWorldScale(vec3.one())

    // One render layer for the stage's lifetime, reused by every launch: a new unique layer per
    // launch was never released, and after a few relaunches the camera's layer set overflowed
    // ("Unique layers set union truncated").
    if (!this.layerMade) {
      this.layer = LayerSet.makeUnique()
      if (this.ctx.camera) this.ctx.camera.renderLayer = this.ctx.camera.renderLayer.union(this.layer)
      this.layerMade = true
    }

    this.replica = this.node(this.root, "HeroReplica", vec3.zero())
    this.buildLightRig()
    // The real camera's own shell (body) and lens, from the imported model.
    this.bodySo = this.node(this.replica, "ReplicaBody", vec3.zero())
    this.bodyMat = this.shellInstance()
    this.meshVisual(this.bodySo, this.ctx.bodyMesh, this.bodyMat)
    this.barrelSo = this.node(this.replica, "ReplicaLens", vec3.zero())
    this.barrelMat = this.shellInstance()
    this.meshVisual(this.barrelSo, this.ctx.lensMesh, this.barrelMat)

    this.buildParts()
    this.buildGlowAndDisc()
  }

  private node(parent: SceneObject, name: string, localPos: vec3): SceneObject {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(localPos)
    return so
  }

  /** The imported meshes are in metres (the glTF importer puts x100 on the prefab root), so the
   *  visual sits on a x100 child and the part node itself stays in centimetres. */
  private meshVisual(so: SceneObject, mesh: RenderMesh, mat: Material): void {
    const child = this.node(so, so.name + "Mesh", vec3.zero())
    child.getTransform().setLocalScale(vec3.one().uniformScale(100))
    const rmv = child.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = mesh
    rmv.mainMaterial = mat
    so.layer = this.layer
    child.layer = this.layer
  }

  private shellInstance(): Material {
    const m = this.ctx.shellMat.clone()
    return m
  }

  /** One key light and a soft fill, parented to the replica, lighting only the replica's layer. */
  private buildLightRig(): void {
    const rig = this.node(this.replica, "HeroLightRig", vec3.zero())
    const key = this.node(rig, "KeyLight", vec3.zero())
    key.getTransform().setLocalRotation(quat.lookAt(new vec3(0.45, -0.75, -0.5).normalize(), vec3.up()))
    const kl = key.createComponent("Component.LightSource") as LightSource
    kl.lightType = LightType.Directional
    kl.color = new vec3(1, 0.96, 0.9)
    kl.intensity = 1.2
    kl.renderLayer = this.layer
    const fill = this.node(rig, "FillLight", vec3.zero())
    const fl = fill.createComponent("Component.LightSource") as LightSource
    fl.lightType = LightType.Ambient
    fl.color = new vec3(0.85, 0.9, 1)
    fl.intensity = 0.5
    fl.renderLayer = this.layer
    key.layer = this.layer
    fill.layer = this.layer
  }

  private glowMat(): Material {
    const m = this.ctx.glowMat.clone()
    m.mainPass.twoSided = true
    return m
  }

  private part(key: string, label: string, so: SceneObject, rest: vec3, apart: vec3, a: number, w: number, looks: Look[], anchor: vec3, labelOff: vec3): Part {
    const p: Part = {key, label, so, rest, apart, a, w, e: 0, freed: false, looks, anchor, labelOff}
    so.getTransform().setLocalPosition(rest)
    this.parts.push(p)
    return p
  }

  /** A material for one kind of solid (glass, metal, ...): the HeroSolid PBR with its fresnel rim. */
  private solidLook(kind: SolidKind): Look {
    const spec = SOLID[kind]
    if (!this.ctx.solidMat) {
      const m = this.glowMat()
      return {mat: m, solid: false, base: vec3.one(), rim: 0}
    }
    const m = this.ctx.solidMat.clone()
    const pass = m.mainPass
    pass.metallic = spec.metallic
    pass.roughness = spec.roughness
    pass.rimColor = spec.rimColor
    pass.rimExponent = spec.rimExp
    return {mat: m, solid: true, base: spec.base, rim: spec.rim}
  }

  /** Bright edge accents (the glow material: unlit, additive). */
  private accentLook(): Look {
    return {mat: this.glowMat(), solid: false, base: vec3.one(), rim: 0}
  }

  /** Spawn a part mesh and count its triangles under the part's key. */
  private spawnPartMesh(parent: SceneObject, name: string, k: MeshKit, look: Look, key: string): SceneObject {
    const t = this.partTris[key] ?? {solid: 0, accent: 0}
    if (look.solid) t.solid += k.triangleCount
    else t.accent += k.triangleCount
    this.partTris[key] = t
    return spawnMesh(parent, name, k.build(), look.mat, undefined, look.mat).so
  }

  /** Fade a part's looks: solids scale their fill and rim, accents their glow. */
  private fadeLooks(p: Part, k: number): void {
    for (const l of p.looks) this.fadeLook(l, k)
  }

  private fadeLook(l: Look, k: number): void {
    const f = Math.max(0, k)
    if (l.solid) {
      l.mat.mainPass.baseColor = new vec4(l.base.x * f, l.base.y * f, l.base.z * f, 1)
      l.mat.mainPass.rimIntensity = l.rim * f
    } else {
      setFade(l.mat, f)
    }
  }

  /**
   * Code-made interior parts with real volume (§5): solid meshes (lathe, extrude, bevel) in the
   * HeroSolid PBR material, whose rim highlight is a real fresnel edge. Glass is faint (≈9% fill)
   * with a bright rim; metal is lit by the replica's key and fill lights. Thin glow lines stay only
   * as accents: glass edges, prism edges, the sensor's pixel grid, the mirror's sheen.
   */
  private buildParts(): void {
    const R = this.replica
    const glassCol = ink(LIGHT, 0.1)
    const metalCol = ink(INK, 0.3)
    // ---- Lens (the model's barrel): unlock twist, then forward. ----
    this.lensPart = this.part("lens", "Lens", this.barrelSo, vec3.zero(), new vec3(0, 0, BARREL_APART), 0.0, 0.3, [], vec3.zero(), vec3.zero())

    // ---- Lens elements: biconvex front, meniscus, biconvex rear; real curvature and thickness. ----
    this.elementsSo = this.node(R, "HeroLensElements", new vec3(0, 0, PLANE_IN_BARREL))
    {
      const glass = this.solidLook("glass")
      const edge = this.accentLook()
      for (const e of ELEMENTS) {
        const so = this.node(this.elementsSo, "Element" + e.name, new vec3(0, 0, e.z))
        const k = new MeshKit()
        latheSmooth(k, lensProfile(e.r, e.t, e.R1, e.R2, 12), 48, glassCol)
        this.spawnPartMesh(so, "Glass", k, glass, "elements")
        const a = new MeshKit()
        const rim = lensRim(e.r, e.t, e.R1, e.R2)
        a.addTube(ringPts(e.r + 0.006, rim.front, 64), 0.011, ink(LIGHT, 0.85), 4, 50)
        a.addTube(ringPts(e.r + 0.006, rim.rear, 64), 0.011, ink(LIGHT, 0.5), 4, 50)
        this.spawnPartMesh(so, "Edge", a, edge, "elements")
        so.enabled = false
        this.elementSos.push(so)
      }
      const top = ELEMENTS[1]
      this.elementsPart = this.part("elements", "Lens elements", this.elementsSo, new vec3(0, 0, PLANE_IN_BARREL), new vec3(0, 0, PLANE_IN_BARREL), 0.18, 0.24, [glass, edge], new vec3(0, top.r, top.z), new vec3(0, 3.4, 0.6))
    }

    // ---- Aperture: seven curved, overlapping blades in a housing ring, open at f/2.8. ----
    this.apertureSo = this.node(R, "HeroAperture", new vec3(0, 0, PLANE_IN_BARREL))
    {
      const ring = this.solidLook("metal")
      const bladeLook = this.solidLook("blade")
      const edge = this.accentLook()
      const k = new MeshKit()
      latheLoop(k, chamferRect(2.45, 2.85, -0.13, 0.13, 0.04), 64, metalCol)
      this.spawnPartMesh(this.apertureSo, "IrisRing", k, ring, "aperture")
      this.blades = irisBlades(7, HERO_A / 2 / SCALE, 2.62, 1.55, 22)
      this.bladeSos = this.blades.map((b, i) => {
        const so = this.node(this.apertureSo, "Blade" + i, new vec3(b.pivot.x, b.pivot.y, 0))
        const bk = new MeshKit()
        const z = (i - 3) * 0.009
        extrudeStrip(bk, b.inner, b.outer, z - 0.011, z + 0.011, metalCol)
        this.spawnPartMesh(so, "BladeMesh", bk, bladeLook, "aperture")
        // The opening's edge: a faint warm line along the blade's inner arc.
        const ak = new MeshKit()
        ak.addTube(b.inner.slice(3, b.inner.length - 3).map((p) => new vec3(p.x, p.y, z + 0.014)), 0.008, ink(LIGHT, 0.5), 4, 50)
        this.spawnPartMesh(so, "BladeEdge", ak, edge, "aperture")
        return so
      })
      this.setIris(HERO_A / 2 / SCALE)
      this.aperturePart = this.part("aperture", "Aperture", this.apertureSo, new vec3(0, 0, PLANE_IN_BARREL), new vec3(0, 0, PLANE_IN_BARREL), 0.28, 0.22, [ring, bladeLook, edge], new vec3(0, -2.85, 0), new vec3(0, -3.4, 0.2))
    }

    // ---- Body shell: lifts up and back, fades; in the light path it clears every part. ----
    this.bodyPart = this.part("body", "Body", this.bodySo, vec3.zero(), BODY_APART, 0.38, 0.24, [], vec3.zero(), vec3.zero())

    // ---- Lens mount: a solid chromed ring, three bayonet tabs, four screws. ----
    {
      const so = this.node(R, "HeroMount", vec3.zero())
      const chrome = this.solidLook("chrome")
      const edge = this.accentLook()
      const k = new MeshKit()
      latheLoop(k, chamferRect(2.72, 3.3, -0.5, 0, 0.06), 72, metalCol)
      for (let i = 0; i < 3; i++) {
        const a0 = (25 + i * 120) * DEG
        latheLoop(k, chamferRect(2.36, 2.75, -0.48, -0.33, 0.025), 14, metalCol, a0, a0 + 55 * DEG)
      }
      for (let i = 0; i < 4; i++) {
        const a = (45 + i * 90) * DEG
        latheLoop(k, [new vec2(0, 0), new vec2(0.12, 0), new vec2(0.12, 0.03), new vec2(0.08, 0.06), new vec2(0, 0.06)], 16, metalCol, 0, Math.PI * 2, new vec3(Math.cos(a) * 3.02, Math.sin(a) * 3.02, 0))
      }
      this.spawnPartMesh(so, "MountMesh", k, chrome, "mount")
      const a = new MeshKit()
      a.addTube(ringPts(2.72, 0.004, 72), 0.012, ink(INK, 0.55), 4, 50)
      this.spawnPartMesh(so, "MountEdge", a, edge, "mount")
      this.part("mount", "Lens mount", so, vec3.zero(), new vec3(0, 0, 0.5), 0.5, 0.2, [chrome, edge], new vec3(0, -3.3, -0.25), new vec3(0, -2.4, 0.9))
    }

    // ---- Reflex mirror: a thin bevelled plate on a visible hinge, a slow sheen sweeping across. ----
    {
      const hinge = new vec3(0, MIRROR_HALF * ROOT2, MIRROR_Z - MIRROR_HALF * ROOT2)
      const so = this.node(R, "HeroMirror", hinge)
      this.mirrorPlate = this.node(so, "MirrorPlate", vec3.zero())
      const mirror = this.solidLook("mirror")
      const metal = this.solidLook("metal")
      const edge = this.accentLook()
      const X = new vec3(1, 0, 0)
      const d = MIRROR_DOWN
      const face = MIRROR_FACE
      const k = new MeshKit()
      bevelBox(k, d.uniformScale(MIRROR_HALF + 0.08), X, d, face, new vec3(MIRROR_W, MIRROR_HALF, 0.05), 0.025, glassCol)
      this.spawnPartMesh(this.mirrorPlate, "MirrorMesh", k, mirror, "mirror")
      // Hinge: a pin across the top edge with two knuckles (built along Z, turned onto X).
      const hk = new MeshKit()
      latheLoop(hk, chamferRect(0, 0.08, -2.1, 2.1, 0.02), 20, metalCol)
      for (const x of [-1.55, 1.55]) latheLoop(hk, chamferRect(0, 0.16, x - 0.28, x + 0.28, 0.03), 24, metalCol)
      const hingeSo = this.node(so, "MirrorHinge", vec3.zero())
      hingeSo.getTransform().setLocalRotation(quat.angleAxis(90 * DEG, vec3.up()))
      this.spawnPartMesh(hingeSo, "HingeMesh", hk, metal, "mirror")
      // Edge accents on the silvered face.
      const ek = new MeshKit()
      const o = face.uniformScale(0.052)
      const c0 = d.uniformScale(0.08)
      const c1 = d.uniformScale(2 * MIRROR_HALF + 0.08)
      const xs = X.uniformScale(MIRROR_W)
      ek.addTube([c0.sub(xs).add(o), c0.add(xs).add(o), c1.add(xs).add(o), c1.sub(xs).add(o), c0.sub(xs).add(o)], 0.01, ink(LIGHT, 0.55), 4, 50)
      this.spawnPartMesh(this.mirrorPlate, "MirrorEdge", ek, edge, "mirror")
      // Sheen: a soft bright line across the plate; it slides down the plate (see updateSheen).
      this.sheen = this.node(this.mirrorPlate, "MirrorSheen", vec3.zero())
      const sk = new MeshKit()
      const rows = [-0.32, -0.07, 0, 0.07, 0.32]
      const ks = [0, 0.3, 1, 0.3, 0]
      const base = sk.vertexCount
      for (let r = 0; r < rows.length; r++) {
        for (const sx of [-1, 1]) sk.vert(X.uniformScale(sx * (MIRROR_W - 0.06)).add(d.uniformScale(rows[r])).add(face.uniformScale(0.06)), face, ink(INK, ks[r]))
      }
      for (let r = 0; r < rows.length - 1; r++) {
        const i0 = base + r * 2
        sk.tri(i0, i0 + 1, i0 + 3)
        sk.tri(i0, i0 + 3, i0 + 2)
      }
      this.sheenMat = this.glowMat()
      this.spawnPartMesh(this.sheen, "SheenMesh", sk, {mat: this.sheenMat, solid: false, base: vec3.one(), rim: 0}, "mirror")
      this.mirrorPart = this.part("mirror", "Reflex mirror", so, hinge, hinge.add(new vec3(0, 0, 0.3)), 0.55, 0.2, [mirror, metal, edge], d.uniformScale(2 * MIRROR_HALF), new vec3(0, -2.6, 0.8))
    }

    // ---- Pentaprism: a solid glass roof prism over a thin focusing screen. ----
    {
      const center = PRISM_CENTER
      const so = this.node(R, "HeroPentaprism", center)
      const glass = this.solidLook("glass")
      const edge = this.accentLook()
      // Side outline (z, y): entry face at the bottom, exit face at the back (90° apart), the
      // other three corners 112.5°; the front-top face is the roof, cut into two faces at 90°.
      let faces = extrudeX(PRISM_OUTLINE, PRISM_HX)
      const ridge = new vec3(0, PRISM_OUTLINE[2].y, PRISM_OUTLINE[2].x)
      for (const s of [-1, 1]) {
        const n = new vec3(s * ROOT2, 0.5, 0.5)
        faces = clipPoly(faces, n, n.dot(ridge))
      }
      const k = new MeshKit()
      const edges = addPoly(k, faces, glassCol)
      bevelBox(k, new vec3(0, PRISM_BOTTOM - 0.16, 0.05), new vec3(1, 0, 0), vec3.up(), new vec3(0, 0, 1), new vec3(1.45, 0.035, 1.2), 0.015, glassCol)
      this.spawnPartMesh(so, "PrismMesh", k, glass, "prism")
      const ek = new MeshKit()
      for (const [a, b] of edges) ek.addTube([a, b], 0.011, ink(LIGHT, 0.6), 4, 50)
      this.spawnPartMesh(so, "PrismEdges", ek, edge, "prism")
      this.prismPart = this.part("prism", "Pentaprism", so, center, center.add(new vec3(0, 2.2, 0)), 0.6, 0.2, [glass, edge], ridge, new vec3(0, 1.8, 0.9))
    }

    // ---- Viewfinder: a small eyepiece tube with a rubber cup and a lens. ----
    {
      const pos = new vec3(0, 2.8, -6.3)
      const so = this.node(R, "HeroViewfinder", pos)
      const dark = this.solidLook("dark")
      const glass = this.solidLook("glass")
      const edge = this.accentLook()
      const k = new MeshKit()
      latheLoop(k, [new vec2(0.78, -0.95), new vec2(1.18, -0.95), new vec2(1.18, -0.72), new vec2(0.98, -0.45), new vec2(0.98, 0.7), new vec2(0.78, 0.7)], 40, metalCol)
      this.spawnPartMesh(so, "EyepieceTube", k, dark, "viewfinder")
      const g = new MeshKit()
      latheSmooth(g, lensProfile(0.76, 0.34, 2.0, 2.0, 8), 36, glassCol, 0, Math.PI * 2, new vec3(0, 0, 0.1))
      this.spawnPartMesh(so, "EyepieceLens", g, glass, "viewfinder")
      const a = new MeshKit()
      a.addTube(ringPts(1.18, -0.95, 48), 0.012, ink(LIGHT, 0.5), 4, 50)
      a.addTube(ringPts(0.77, 0.1, 40), 0.009, ink(LIGHT, 0.7), 4, 50)
      this.spawnPartMesh(so, "EyepieceEdge", a, edge, "viewfinder")
      this.viewfinderPart = this.part("viewfinder", "Viewfinder", so, pos, pos.add(new vec3(0, 2.2, -1.6)), 0.64, 0.2, [dark, glass, edge], new vec3(0, 0.98, -0.1), new vec3(0, 2.0, -0.8))
    }

    // ---- Focal-plane shutter: a frame and two curtains of five slats that really move. ----
    {
      const pos = new vec3(0, 0, -3.95)
      const so = this.node(R, "HeroShutter", pos)
      const metal = this.solidLook("metal")
      const slatLook = this.solidLook("blade")
      const k = new MeshKit()
      bevelFrame(k, vec3.zero(), new vec2(SHUTTER_HW, SHUTTER_HH), new vec2(SHUTTER_HW + 0.35, SHUTTER_HH + 1.0), 0.08, 0.02, metalCol)
      this.spawnPartMesh(so, "ShutterFrame", k, metal, "shutter")
      this.slats = []
      for (let c = 0; c < 2; c++) {
        const cso = this.node(so, c === 0 ? "FirstCurtain" : "SecondCurtain", vec3.zero())
        const row: SceneObject[] = []
        for (let j = 0; j < SLATS; j++) {
          const sso = this.node(cso, "Slat" + j, vec3.zero())
          const sk = new MeshKit()
          bevelBox(sk, vec3.zero(), new vec3(1, 0, 0), vec3.up(), new vec3(0, 0, 1), new vec3(SHUTTER_HW + 0.1, SLAT_HH, 0.012), 0.008, metalCol)
          this.spawnPartMesh(sso, "SlatMesh", sk, slatLook, "shutter")
          row.push(sso)
        }
        this.slats.push(row)
        this.curtains.push(cso)
      }
      this.shutterPart = this.part("shutter", "Shutter", so, pos, new vec3(0, 0, -4.7), 0.7, 0.2, [metal, slatLook], new vec3(0, -SHUTTER_HH - 1.0, 0), new vec3(0, -1.2, 1.3))
      this.setCurtains(1, 0)
    }

    // ---- Image sensor: a thin plate in its package, a faint cyan pixel grid that glows brighter where the image lands. ----
    {
      const pos = new vec3(0, 0, SENSOR_Z)
      const so = this.node(R, "HeroSensor", pos)
      const plate = this.solidLook("sensor")
      const dark = this.solidLook("dark")
      const grid = this.accentLook()
      const hw = SENSOR_W / 2
      const hh = SENSOR_H / 2
      const X = new vec3(1, 0, 0)
      const Y = vec3.up()
      const Z = new vec3(0, 0, 1)
      const pk = new MeshKit()
      bevelBox(pk, vec3.zero(), X, Y, Z, new vec3(hw, hh, 0.03), 0.012, ink(SIGNAL, 0.1))
      this.spawnPartMesh(so, "SensorPlate", pk, plate, "sensor")
      const fk = new MeshKit()
      bevelFrame(fk, new vec3(0, 0, -0.05), new vec2(hw + 0.02, hh + 0.02), new vec2(hw + 0.45, hh + 0.4), 0.14, 0.025, metalCol)
      bevelBox(fk, new vec3(0, 0, -0.17), X, Y, Z, new vec3(hw + 0.7, hh + 0.6, 0.05), 0.02, metalCol)
      this.spawnPartMesh(so, "SensorPackage", fk, dark, "sensor")
      const gk = new MeshKit()
      const z = 0.034
      const cols = 36
      const rowsN = 24
      for (let i = 1; i < cols; i++) {
        const x = -hw + (i / cols) * SENSOR_W
        gk.addRectXY(x - 0.005, -hh, x + 0.005, hh, ink(SIGNAL, 0.16))
      }
      for (let j = 1; j < rowsN; j++) {
        const y = -hh + (j / rowsN) * SENSOR_H
        gk.addRectXY(-hw, y - 0.005, hw, y + 0.005, ink(SIGNAL, 0.16))
      }
      gk.addPolylineXY([new vec2(-hw, -hh), new vec2(hw, -hh), new vec2(hw, hh), new vec2(-hw, hh), new vec2(-hw, -hh)], 0.02, ink(SIGNAL, 0.7))
      const gso = this.spawnPartMesh(so, "PixelGrid", gk, grid, "sensor")
      gso.getTransform().setLocalPosition(new vec3(0, 0, z))
      const img = this.node(so, "SensorImage", new vec3(0, 0, 0.05))
      this.sensorGlow = new BlurImage(img, "SensorGlow", this.ctx.glowMat, SIGNAL, 1)
      this.sensorImage = new BlurImage(img, "SensorImageBlur", this.ctx.glowMat, null, 1)
      this.sensorFlash = new BlurImage(img, "SensorFlash", this.ctx.glowMat, SIGNAL, 1)
      this.sensorGlow.update(0.5, 0, 0)
      this.sensorImage.update(0.5, 0, 0)
      this.sensorFlash.update(0.5, 0, 0)
      this.sensorPart = this.part("sensor", "Image sensor", so, pos, new vec3(0, 0, SENSOR_APART_Z), 0.78, 0.22, [plate, dark, grid], new vec3(0, -hh - 0.4, 0), new vec3(0, -2.6, -1.8))
    }

    for (const p of this.parts) {
      if (p.looks.length) {
        this.fadeLooks(p, 0)
        p.so.enabled = false
      }
    }
    // The solids are lit by the replica's own key and fill lights, which only light its layer.
    setLayerDeep(R, this.layer)
    this.countShellTris()
    let total = 0
    const per: string[] = []
    for (const key of Object.keys(this.partTris)) {
      const t = this.partTris[key]
      total += t.solid + t.accent
      per.push(key + " " + t.solid + "+" + t.accent)
    }
    print("Cutaway: hero parts: " + total + " triangles (" + per.join(", ") + "); replica " + (total + this.shellTris) + " with the shell; iris open r " + this.irisOpen.toFixed(3) + " (f/2.8 wants " + (HERO_A / 2 / SCALE).toFixed(3) + ")")
  }

  /** Triangles of the imported shell (body and lens meshes). */
  private countShellTris(): void {
    this.shellTris = 0
    for (const m of [this.ctx.bodyMesh, this.ctx.lensMesh]) {
      try {
        this.shellTris += Math.round(m.getIndexBuffer().length / 3)
      } catch (e) {
        // Not readable at runtime: leave it out of the count.
      }
    }
  }

  /** Close the iris to an opening of radius `r` (aperture-local cm): every blade turns about its pivot by the same angle. */
  private setIris(r: number): void {
    if (!this.blades.length) return
    const open0 = irisOpening(this.blades, 0)
    const dir = irisOpening(this.blades, 0.05) < open0 ? 1 : -1
    let lo = 0
    let hi = 1.2
    if (r >= open0) hi = 0
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (irisOpening(this.blades, dir * mid) > r) lo = mid
      else hi = mid
    }
    const ang = dir * ((lo + hi) / 2)
    this.irisOpen = irisOpening(this.blades, ang)
    for (const so of this.bladeSos) so.getTransform().setLocalRotation(quat.angleAxis(ang, new vec3(0, 0, 1)))
  }

  /** The mirror's sheen: a bright line sliding slowly down the plate, then a pause. */
  private updateSheen(): void {
    if (!this.sheen || !this.sheenMat) return
    const vis = this.mirrorPart.so.enabled ? clamp01(this.mirrorPart.e) * this.globalFade : 0
    const cyc = (getTime() % SHEEN_PERIOD) / SHEEN_SWEEP
    const u = clamp01(cyc)
    const s = 0.25 + u * (2 * MIRROR_HALF - 0.5)
    this.sheen.getTransform().setLocalPosition(MIRROR_DOWN.uniformScale(0.08 + s))
    setFade(this.sheenMat, cyc <= 1 ? vis * Math.pow(Math.sin(Math.PI * u), 0.7) : 0)
  }

  /**
   * Two grab handles (SIK Interactables): the body slides the replica across the table top, the
   * lens swings it around its footprint centre (yaw only). They live on the stage root, not on the
   * replica, with +Z pointing up: SIK's planecast plane (normal = the interactable's forward) is
   * then the horizontal plane through the handle, and a handle holds still while it is dragged, so
   * the drag point never feeds back through the replica's own motion.
   */
  private buildGrabs(): void {
    const make = (name: string, kind: "slide" | "turn", size: vec3): SceneObject => {
      const so = this.node(this.root, name, vec3.zero())
      const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
      const box = Shape.createBoxShape()
      box.size = size
      col.shape = box
      col.debugDrawEnabled = false
      const inter = so.createComponent(Interactable.getTypeName()) as Interactable
      inter.enableInstantDrag = true
      inter.onDragStart.add((e) => this.onGrabStart(kind, e.interactor.planecastPoint))
      inter.onDragUpdate.add((e) => this.onGrabUpdate(e.interactor.planecastPoint, e.dragVector))
      inter.onDragEnd.add(() => this.onGrabEnd())
      return so
    }
    // Box axes in the handle's frame: x across the lens axis, y along it, z up.
    const slide = make("HeroGrab", "slide", new vec3(BODY_BOX_SIZE.x, BODY_BOX_SIZE.z, BODY_BOX_SIZE.y).uniformScale(SCALE).add(new vec3(1.5, 1.5, 1.5)))
    const d = LENS_RADIUS * 2 * SCALE + 1.5
    const turn = make("HeroTurnGrab", "turn", new vec3(d, LENS_LENGTH * SCALE, d))
    this.grabs = {slide, turn}
    this.syncGrabs()
    this.ctx.log("hero:turnReady")
  }

  private canGrab(): boolean {
    return (this.state === "landed" || this.state === "light") && this.pose !== "fly" && this.pose !== "lift"
  }

  /** Handles follow the assembled body and lens, except while one is being dragged. */
  private syncGrabs(): void {
    if (!this.grabs) return
    const on = this.canGrab()
    this.grabs.slide.enabled = on
    this.grabs.turn.enabled = on
    if (this.grab || !on) return
    const tr = this.replica.getTransform()
    const m = tr.getWorldTransform()
    const q = quat.lookAt(vec3.up(), flatDir(tr.getWorldRotation().multiplyVec3(vec3.forward())))
    const st = this.grabs.slide.getTransform()
    st.setWorldPosition(m.multiplyPoint(BODY_BOX_CENTER))
    st.setWorldRotation(q)
    const tt = this.grabs.turn.getTransform()
    tt.setWorldPosition(m.multiplyPoint(new vec3(0, 0, LENS_CENTER_Z)))
    tt.setWorldRotation(q)
  }

  private onGrabStart(kind: "slide" | "turn", p: vec3 | null): void {
    if (!this.canGrab() || this.grab || !this.physics) return
    // Caught mid-settle: it stops where it is and is held.
    if (this.pose === "drop") this.toRest(true)
    const handle = kind === "slide" ? this.grabs.slide : this.grabs.turn
    const p0 = p ?? handle.getTransform().getWorldPosition()
    const rel = p0.sub(this.foot)
    const ang = Math.atan2(rel.x, rel.z)
    this.grab = {kind, p0, usePlane: !!p, foot0: this.unclampFoot(this.foot, this.rot()), yaw0: this.yaw, angPrev: ang, turned: 0, accum: vec3.zero()}
    this.ctx.log("hero:grab")
  }

  private onGrabUpdate(p: vec3 | null, dv: vec3 | null): void {
    const g = this.grab
    if (!g) return
    let q = g.usePlane ? p : null
    if (!q) {
      g.accum = g.accum.add(dv ?? vec3.zero())
      q = g.p0.add(g.accum)
    }
    if (g.kind === "slide") {
      // Only the hand's motion in the table plane counts; the clamp keeps the footprint on the top.
      const d = q.sub(g.p0)
      this.foot = this.clampFoot(g.foot0.add(new vec3(d.x, 0, d.z)), this.rot())
    } else {
      // Swing the lens around the footprint centre: the yaw follows the hand's angle around it.
      const rel = q.sub(this.foot)
      if (Math.sqrt(rel.x * rel.x + rel.z * rel.z) < 2) return
      const ang = Math.atan2(rel.x, rel.z)
      let da = ang - g.angPrev
      while (da > Math.PI) da -= Math.PI * 2
      while (da < -Math.PI) da += Math.PI * 2
      g.angPrev = ang
      g.turned += da
      this.yaw = g.yaw0 + g.turned
      this.foot = this.clampFoot(g.foot0, this.rot())
    }
  }

  private onGrabEnd(): void {
    // Test hook: a frozen stage stays held (a screenshot of the drag); the next clean start clears it.
    if (!this.grab || this.hold) return
    this.grab = null
    this.ctx.log("hero:release")
    // On the table it drops the 1.5 cm under gravity and settles; hovering, it stays up.
    if (this.pose === "rest") this.startDrop()
  }

  /**
   * Keep the whole footprint on the table top: the footprint centre may go at most `maxFootDistance`
   * from the table centre in any direction (less a small margin). The last 4 cm before that limit
   * resist softly (exponential approach), so a drag far past the edge stops there, never beyond.
   */
  private clampFoot(target: vec3, rot: quat): vec3 {
    const s = this.surf
    const c = s.center
    const rel = new vec3(target.x - c.x, 0, target.z - c.z)
    const d = rel.length
    if (d < 1e-4) return new vec3(target.x, s.height, target.z)
    const u = rel.uniformScale(1 / d)
    const tMax = Math.max(0, maxFootDistance(u, rot, s.safeRadius) - EDGE_MARGIN)
    const knee = Math.max(0, tMax - EDGE_SOFT)
    const w = tMax - knee
    const dd = d <= knee ? d : w > 1e-4 ? knee + w * (1 - Math.exp(-(d - knee) / w)) : knee
    return new vec3(c.x + u.x * dd, s.height, c.z + u.z * dd)
  }

  /** The hand position that `clampFoot` maps to `foot` (a grab that starts near the edge never jumps). */
  private unclampFoot(foot: vec3, rot: quat): vec3 {
    const s = this.surf
    const c = s.center
    const rel = new vec3(foot.x - c.x, 0, foot.z - c.z)
    const dd = rel.length
    if (dd < 1e-4) return foot
    const u = rel.uniformScale(1 / dd)
    const tMax = Math.max(0, maxFootDistance(u, rot, s.safeRadius) - EDGE_MARGIN)
    const knee = Math.max(0, tMax - EDGE_SOFT)
    const w = tMax - knee
    if (dd <= knee || w <= 1e-4) return foot
    const k = Math.min(0.999, (dd - knee) / w)
    const d = knee - w * Math.log(1 - k)
    return new vec3(c.x + u.x * d, s.height, c.z + u.z * d)
  }

  // =====================================================================================
  // Launch and land
  // =====================================================================================

  /** Control point of the flight arc: above the midpoint, pushed away from the user's head. */
  /** Keep a point at least `r` cm from the head at launch, pushed sideways away from it. */
  private clearOfHead(p: vec3, r: number): vec3 {
    const head = this.head0
    let away = new vec3(p.x - head.x, 0, p.z - head.z)
    if (away.length < 1e-3) away = flatDir(this.ctx.surface().center.sub(head))
    away = away.normalize()
    let q = p
    for (let i = 0; i < 8 && q.distance(head) < r; i++) q = q.add(away.uniformScale(r - q.distance(head) + 2))
    return q
  }

  private flightControl(): vec3 {
    let c = vec3.lerp(this.pMeet, this.pLand, 0.5).add(new vec3(0, 35, 0))
    const head = this.head0
    for (let it = 0; it < 12; it++) {
      let worst = 1e9
      let worstP = c
      for (let i = 0; i <= 24; i++) {
        const p = bezier(this.pMeet, c, this.pLand, i / 24)
        const d = p.distance(head)
        if (d < worst) {
          worst = d
          worstP = p
        }
      }
      if (worst >= 55) break
      // Never through the head: bend the arc away from it.
      let away = worstP.sub(head)
      away = away.length > 1e-3 ? away.normalize() : new vec3(1, 0, 0)
      c = c.add(away.uniformScale(55 - worst + 10))
    }
    return c
  }

  private flashBrackets(rb: {center: vec3; size: vec3}): void {
    const so = this.node(this.root, "HeroBrackets", rb.center)
    this.bracketMat = this.glowMat()
    const k = new MeshKit()
    const h = rb.size.uniformScale(0.5).add(new vec3(1.2, 1.2, 1.2))
    const arm = (v: number) => Math.max(1.5, v * 0.35)
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const p = new vec3(sx * h.x, sy * h.y, sz * h.z)
          k.addTube([p, p.add(new vec3(-sx * arm(h.x), 0, 0))], 0.12, ink(INK, 0.9), 4, 50)
          k.addTube([p, p.add(new vec3(0, -sy * arm(h.y), 0))], 0.12, ink(INK, 0.9), 4, 50)
          k.addTube([p, p.add(new vec3(0, 0, -sz * arm(h.z)))], 0.12, ink(INK, 0.9), 4, 50)
        }
    spawnMesh(so, "Brackets", k.build(), this.ctx.glowMat, undefined, this.bracketMat)
    this.brackets = so
  }

  private updateBrackets(): void {
    if (!this.brackets) return
    // Flash once: in over 150 ms, out over 220 ms.
    const t = this.state === "launch" ? this.t : 1
    const a = t < 0.15 ? easeOutCubic(t / 0.15) : 1 - easeIn((t - 0.15) / 0.22)
    setFade(this.bracketMat, Math.max(0, a))
    this.brackets.getTransform().setLocalScale(vec3.one().uniformScale(1.06 - 0.06 * easeOutCubic(t / 0.15)))
    if (t > 0.4) {
      this.brackets.destroy()
      this.brackets = null
    }
  }

  private applyLaunch(): void {
    const t = this.t
    const tr = this.replica.getTransform()
    if (t < T_FLY0) {
      // Body copy peels off the real camera and rises to the meeting point.
      const k = easeOutCubic(t / T_RISE)
      const lift = new vec3(0, 6 * Math.sin(Math.PI * clamp01(t / T_RISE)), 0)
      tr.setWorldPosition(vec3.lerp(this.pStart, this.pMeet, k).add(lift.uniformScale(0.3)))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
      this.applyLensLaunch(t)
    } else {
      const u = easeInOutCubic((t - T_FLY0) / (T_FLY1 - T_FLY0))
      tr.setWorldPosition(bezier(this.pMeet, this.ctrl, this.pLand, u))
      tr.setWorldRotation(quat.slerp(this.rStart, this.rLand, u))
      tr.setWorldScale(vec3.one().uniformScale(1 + (SCALE - 1) * u))
      this.setBarrel(0, 0)
      this.ctx.moveSound("flight", tr.getWorldPosition())
      if (!this.trail) this.trail = new TrailRibbon(this.root, "HeroTrail", this.ctx.glowMat, 28, 5, ink(LIGHT, 0.9))
    }
    // The rim-only copy: edges of light until it lands.
    this.shellFill = 0
    this.shellRim = 0.9 * easeOutCubic(t / 0.25)
    if (t >= T_TWIST && !this.flags.click) {
      this.flags.click = true
      this.ctx.sound("bayonet", tr.getWorldPosition())
      this.ctx.log("hero:click")
    }
    if (t >= T_FLY0 && !this.flags.flight) {
      this.flags.flight = true
      this.ctx.sound("flight", tr.getWorldPosition())
      this.ctx.log("hero:flight")
    }
  }

  private flags = {click: false, flight: false}

  /** Lens: rises out of its bag, lines up in front of the mount, slides in and twists 45° to lock. */
  private applyLensLaunch(t: number): void {
    const btr = this.barrelSo.getTransform()
    const rtr = this.replica.getTransform()
    if (t < T_RISE) {
      const k = easeOutCubic(t / T_RISE)
      const bag = this.ctx.bag()
      // In the bag the lens stands upright (front up); its rear sits below the bag marker.
      const startRot = this.bagRot
      const startPos = bag.sub(startRot.multiplyVec3(new vec3(0, 0, LENS_CENTER_Z)))
      const endRot = rtr.getWorldRotation().multiply(quat.angleAxis(45 * DEG, vec3.forward()))
      const endPos = rtr.getWorldTransform().multiplyPoint(new vec3(0, 0, 3))
      const arc = new vec3(0, 8 * Math.sin(Math.PI * k), 0)
      btr.setWorldPosition(vec3.lerp(startPos, endPos, k).add(arc))
      btr.setWorldRotation(quat.slerp(startRot, endRot, k))
      btr.setWorldScale(vec3.one())
    } else if (t < T_SEAT) {
      const k = easeInOutCubic((t - T_RISE) / (T_SEAT - T_RISE))
      this.setBarrel(3 * (1 - k), 45)
    } else {
      const k = easeInOutCubic((t - T_SEAT) / (T_TWIST - T_SEAT))
      this.setBarrel(0, 45 * (1 - k))
    }
  }

  private setBarrel(z: number, twistDeg: number): void {
    const tr = this.barrelSo.getTransform()
    tr.setLocalPosition(new vec3(0, 0, z))
    tr.setLocalRotation(quat.angleAxis(twistDeg * DEG, vec3.forward()))
    tr.setLocalScale(vec3.one())
  }

  // =====================================================================================
  // On the table (pass 2): drop, rest, held, hover
  // =====================================================================================

  /** Rotation for a yaw (only ever about the vertical axis). */
  private rot(yaw: number = this.yaw): quat {
    return quat.angleAxis(yaw, vec3.up()).multiply(this.rLand)
  }

  /** Replica pivot for footprint centre `foot` (x, z), `yaw`, and its lowest point `h` cm above the table top. */
  private pivotFor(foot: vec3, yaw: number, h: number): vec3 {
    const off = this.rot(yaw).multiplyVec3(new vec3(FOOT_CENTER.x * SCALE, BODY_MIN_Y * SCALE, FOOT_CENTER.y * SCALE))
    return new vec3(foot.x, this.surf.height + h, foot.z).sub(off)
  }

  /** Kinematic: place the replica (and its physics proxy) from foot, yaw and height. */
  private applyPose(): void {
    const tr = this.replica.getTransform()
    const r = this.rot()
    const p = this.pivotFor(this.foot, this.yaw, this.h)
    tr.setWorldPosition(p)
    tr.setWorldRotation(r)
    tr.setWorldScale(vec3.one().uniformScale(SCALE))
    if (this.physics) this.physics.setReplicaPose(p, r)
  }

  /** The flight is over, 20 cm above the table centre: let go, and it drops onto the table. */
  private endFlight(): void {
    this.state = "landed"
    this.landed = true
    this.landTime = 0
    this.t = 0
    this.h = DROP_CM
    this.applyPose()
    this.buildThread()
    this.buildGrabs()
    this.startDrop()
  }

  /** Dynamic from here: it falls under gravity, touches the table and settles. */
  private startDrop(): void {
    this.pose = "drop"
    this.poseT = 0
    this.drop = {t: 0, touched: false, touchT: -1, stillT: 0, bounce: 0, settle: -1, contact: null}
    this.applyPose()
    this.holdK = 0
    this.physics.drop()
    this.ctx.log("hero:drop")
  }

  /** First contact: the soft tap (and, on the first landing, the landing tone) from the contact point. */
  private onContact(p: vec3, impulse: number): void {
    if (this.pose !== "drop" || this.drop.touched) return
    this.drop.touched = true
    this.drop.touchT = this.drop.t
    this.drop.contact = p
    this.physics.settle()
    this.ctx.sound("tap", p)
    if (this.firstRest) {
      this.ctx.sound("land", p)
      this.lastLandPos = p
    }
    this.ctx.log("hero:touch")
    void impulse
  }

  private updateDrop(dt: number): void {
    const d = this.drop
    d.t += dt
    const pr = this.physics.replicaPose()
    const tr = this.replica.getTransform()
    tr.setWorldPosition(pr.pos)
    tr.setWorldRotation(pr.rot)
    tr.setWorldScale(vec3.one().uniformScale(SCALE))
    const gap = this.lowestWorldY() - this.surf.height
    this.h = gap
    const v = this.physics.velocity().length
    // No collision event (should not happen): count it as touching once it is down and slow.
    if (!d.touched && d.t > 0.05 && gap < 0.05 && v < 5) this.onContact(new vec3(this.foot.x, this.surf.height, this.foot.z), 0)
    if (d.touched) {
      d.bounce = Math.max(d.bounce, gap)
      const still = v < STILL_SPEED && this.physics.angularSpeed() < STILL_SPIN
      if (!still) {
        d.stillT = 0
        d.settle = -1
      } else {
        if (d.settle < 0) d.settle = d.t - d.touchT
        d.stillT += dt
      }
      if (d.stillT >= 0.05) this.toRest(false)
    } else if (d.t > 1.5) {
      this.toRest(false)
    }
  }

  /**
   * At rest (or caught mid-settle by a grab): kinematic again, exactly where the physics left it,
   * keeping its yaw and footprint. Only a residual tilt (if any) is levelled out, and the gap to the
   * table is kept between 0 and 2 mm (it is logged as found).
   */
  private toRest(early: boolean): void {
    const pr = this.physics.replicaPose()
    this.physics.freeze()
    const tr = this.replica.getTransform()
    tr.setWorldPosition(pr.pos)
    tr.setWorldRotation(pr.rot)
    tr.setWorldScale(vec3.one().uniformScale(SCALE))
    const gap = this.lowestWorldY() - this.surf.height
    const f = flatDir(pr.rot.multiplyVec3(vec3.forward()))
    const f0 = flatDir(this.rLand.multiplyVec3(vec3.forward()))
    const tiltDeg = Math.acos(Math.max(-1, Math.min(1, pr.rot.multiplyVec3(vec3.up()).y))) / DEG
    this.yaw = Math.atan2(f.x, f.z) - Math.atan2(f0.x, f0.z)
    const fw = pr.pos.add(pr.rot.multiplyVec3(new vec3(FOOT_CENTER.x * SCALE, BODY_MIN_Y * SCALE, FOOT_CENTER.y * SCALE)))
    this.foot = new vec3(fw.x, this.surf.height, fw.z)
    this.restGap = Math.max(0, Math.min(0.2, gap))
    this.h = this.restGap
    this.pose = "rest"
    this.poseT = 0
    this.holdK = 0
    this.applyPose()
    // Levelling out a residual tilt moves points by well under a millimetre; that is not motion.
    this.lastPivot = this.replica.getTransform().getWorldPosition()
    this.speed = 0
    if (early) return
    const d = this.drop
    this.lastDrop = {bounce: d.bounce, settle: d.settle, restGap: gap, tiltDeg}
    print(`Cutaway: hero rest: gap ${(gap * 10).toFixed(2)} mm, tilt ${tiltDeg.toFixed(3)}°, bounce ${(d.bounce * 10).toFixed(2)} mm, still ${d.settle.toFixed(3)} s after contact, drop ${d.t.toFixed(3)} s`)
    this.ctx.log("hero:rest")
    if (this.firstRest) {
      this.firstRest = false
      this.landedAt = getTime()
      this.ctx.rail.setMode("apart")
      this.ctx.rail.setApartValue(0)
      this.ctx.log("hero:landed")
    }
  }

  private startRise(): void {
    this.pose = "rise"
    this.poseT = 0
    this.h0 = this.h
    this.ctx.log("hero:rise")
  }

  /**
   * Every frame on the table: rest (lifted 1.5 cm while held), rise to hover when "Take apart"
   * leaves 0, hover with a slow bob, and once the parts are back together, come down and drop.
   */
  private updatePose(dt: number): void {
    if (!this.physics) return
    const wantHover = this.state === "light" || this.ctx.rail.getApartValue() > 0.001
    this.poseT += dt
    switch (this.pose) {
      case "drop":
        this.updateDrop(dt)
        break
      case "rest":
        if (this.grab) this.holdK = Math.min(1, this.holdK + dt / HOLD_DUR)
        this.h = this.restGap + HOLD_CM * easeInOutCubic(this.holdK)
        if (wantHover) this.startRise()
        this.applyPose()
        break
      case "rise":
        this.h = this.h0 + (HOVER_CM - this.h0) * easeOutCubic(this.poseT / RISE_DUR)
        if (this.poseT >= RISE_DUR) {
          this.pose = "hover"
          this.poseT = 0
          this.ctx.log("hero:hover")
        }
        this.applyPose()
        break
      case "hover":
        this.h = HOVER_CM + BOB_CM * Math.sin((2 * Math.PI * this.poseT) / BOB_PERIOD)
        if (!wantHover && this.sEff <= 0.001) {
          this.pose = "descend"
          this.poseT = 0
          this.h0 = this.h
          this.ctx.log("hero:descend")
        }
        this.applyPose()
        break
      case "descend":
        if (wantHover) {
          this.startRise()
          this.applyPose()
          break
        }
        this.h = this.h0 + (HOLD_CM - this.h0) * easeInOutCubic(this.poseT / DESCEND_DUR)
        this.applyPose()
        if (this.poseT >= DESCEND_DUR) {
          if (this.grab) {
            // Held as it comes down: it stays lifted 1.5 cm until let go.
            this.pose = "rest"
            this.restGap = 0
            this.holdK = 1
          } else this.startDrop()
        }
        break
    }
    // The parts separate only once it hovers, and gather again before it comes down.
    if (this.state === "light") this.sEff = 1
    else {
      const target = this.pose === "hover" ? this.ctx.rail.getApartValue() : 0
      const step = APART_RATE * dt
      this.sEff = Math.abs(target - this.sEff) <= step ? target : this.sEff + Math.sign(target - this.sEff) * step
    }
    // The disc fades in as it rises and out as it comes down.
    const want = this.pose === "rise" || this.pose === "hover" ? 1 : 0
    const ds = dt / 0.35
    this.discK = Math.abs(want - this.discK) <= ds ? want : this.discK + Math.sign(want - this.discK) * ds
  }

  /** Contact glow hugging the footprint, and the hover disc; both 2 mm above the table top. */
  private buildGlowAndDisc(): void {
    // Footprint-local XY at 3x (x across, y = -along), laid flat by a -90° turn about X.
    const outline = FOOTPRINT.map((p) => new vec2((p.x - FOOT_CENTER.x) * SCALE, -(p.y - FOOT_CENTER.y) * SCALE))
    const k = new MeshKit()
    softOutline(k, outline, [0, 0.35, 3.2], [ink(LIGHT, 0.36), ink(LIGHT, 0.22), ink(LIGHT, 0)])
    this.contactGlowMat = this.glowMat()
    this.contactGlow = this.node(this.root, "HeroContactGlow", vec3.zero())
    spawnMesh(this.contactGlow, "Glow", k.build(), this.ctx.glowMat, undefined, this.contactGlowMat)
    this.contactGlow.enabled = false
    // Hover disc: a thin warm-white ring, ~10% fill, as wide as the footprint is long.
    const R = FOOT_SIZE.y / 2
    const dk = new MeshKit()
    dk.addFanXY(0, 0, R, 0, Math.PI * 2, ink(LIGHT, 0.1), ink(LIGHT, 0.1), 96)
    dk.addArcXY(0, 0, R, 0.35, 0, Math.PI * 2, ink(LIGHT, 0.85), 128)
    dk.addSoftRingXY(0, 0, R + 0.17, R + 2.2, ink(LIGHT, 0.14), ink(LIGHT, 0), 96)
    this.discMat = this.glowMat()
    this.disc = this.node(this.root, "HeroHoverDisc", vec3.zero())
    spawnMesh(this.disc, "Disc", dk.build(), this.ctx.glowMat, undefined, this.discMat)
    this.disc.enabled = false
  }

  private updateGlowAndDisc(dt: number): void {
    void dt
    if (!this.contactGlow || !this.disc) return
    const s = this.surf
    const tr = this.replica.getTransform()
    const fw = tr.getWorldTransform().multiplyPoint(new vec3(FOOT_CENTER.x, BODY_MIN_Y, FOOT_CENTER.y))
    const yawRot = quat.lookAt(flatDir(tr.getWorldRotation().multiplyVec3(vec3.forward())), vec3.up())
    const flat = yawRot.multiply(quat.angleAxis(-90 * DEG, vec3.right()))
    const at = new vec3(fw.x, s.height + ON_TABLE, fw.z)
    // Glow: full while it sits on the table, fading as it lifts off (gone by 3 cm).
    const onTable = this.state === "landed" || this.state === "light" || this.state === "returning"
    const g = onTable ? 1 - clamp01((fw.y - s.height - 0.2) / 3) : 0
    this.contactGlow.enabled = g > 0.001
    if (this.contactGlow.enabled) {
      const gt = this.contactGlow.getTransform()
      gt.setWorldPosition(at)
      gt.setWorldRotation(flat)
      setFade(this.contactGlowMat, g * this.globalFade)
    }
    const k = easeInOutCubic(this.discK)
    this.disc.enabled = k > 0.001 && this.state !== "returning"
    if (this.disc.enabled) {
      // As wide as the footprint is long, but never past the table's edge.
      const R = FOOT_SIZE.y / 2
      const off = new vec3(fw.x - s.center.x, 0, fw.z - s.center.z).length
      const r = Math.max(4, Math.min(R, s.safeRadius - off))
      const dtr = this.disc.getTransform()
      dtr.setWorldPosition(at)
      dtr.setWorldRotation(flat)
      dtr.setWorldScale(vec3.one().uniformScale(r / R))
      setFade(this.discMat, k)
    }
  }

  /** The thread: a line of light from the real camera, through the meeting point and along the flight arc to the replica as it is now. */
  private buildThread(): void {
    this.thread = new TrailRibbon(this.root, "HeroThread", this.ctx.glowMat, THREAD_N, 0.7, ink(LIGHT, 0.9))
    this.threadT = 0
    this.updateThreadPts()
    const ps = this.node(this.root, "HeroThreadPulse", this.threadPts[0])
    this.pulseMat = this.glowMat()
    const k = new MeshKit()
    k.addSphere(vec3.zero(), 0.35, ink(LIGHT, 0.9), 6, 10)
    k.addSphere(vec3.zero(), 1.1, ink(LIGHT, 0.12), 6, 10)
    spawnMesh(ps, "Pulse", k.build(), this.ctx.glowMat, undefined, this.pulseMat)
    this.pulse = ps
  }

  /** Recompute the thread so it follows the replica (slid, turned, hovering), resampled to THREAD_N points. */
  private updateThreadPts(): void {
    const raw: vec3[] = []
    for (let i = 0; i <= 6; i++) raw.push(vec3.lerp(this.realCenter, this.pMeet, i / 6))
    const center = this.replicaCenter()
    const end = this.replica.getTransform().getWorldPosition()
    const at = (u: number) => bezier(this.pMeet, this.ctrl, end, u)
    let prevU = 0
    for (let i = 1; i <= 40; i++) {
      const u = i / 40
      const p = at(u)
      if (p.distance(center) < 24) {
        // End exactly where the arc meets the replica (24 cm around its centre).
        let lo = prevU
        let hi = u
        for (let it = 0; it < 14; it++) {
          const m = (lo + hi) / 2
          if (at(m).distance(center) < 24) hi = m
          else lo = m
        }
        raw.push(at(lo))
        break
      }
      raw.push(p)
      prevU = u
    }
    const cum = [0]
    for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + raw[i].distance(raw[i - 1]))
    const L = cum[cum.length - 1]
    const pts: vec3[] = []
    let j = 1
    for (let i = 0; i < THREAD_N; i++) {
      const want = (L * i) / (THREAD_N - 1)
      while (j < raw.length - 1 && cum[j] < want) j++
      const seg = Math.max(1e-6, cum[j] - cum[j - 1])
      pts.push(raw.length > 1 ? vec3.lerp(raw[j - 1], raw[j], clamp01((want - cum[j - 1]) / seg)) : raw[0])
    }
    this.threadPts = pts
    this.threadCum = pts.map((_, i) => (L * i) / (THREAD_N - 1))
  }

  private threadPointAt(f: number): vec3 {
    const n = this.threadPts.length
    if (n === 0) return vec3.zero()
    const x = clamp01(f) * (n - 1)
    const i = Math.min(n - 2, Math.floor(x))
    return vec3.lerp(this.threadPts[i], this.threadPts[i + 1], x - i)
  }

  private updateThread(dt: number): void {
    if (!this.thread) return
    this.threadT += dt
    let k = 1
    if (this.state === "returning") k = 1 - clamp01((this.t - (RET_END - 0.45)) / 0.4)
    this.updateThreadPts()
    // The trail settles into the thread: it draws along the arc as the trail fades.
    const draw = easeOutCubic(this.threadT / 0.35)
    const n = this.threadPts.length
    const alphas = this.threadPts.map((_, i) => (i / (n - 1) <= draw ? 1 : 0))
    const mid = this.threadPts[Math.floor(n / 2)]
    this.thread.update(this.threadPts, this.ctx.camPos().sub(mid).normalize(), alphas)
    setFade(this.thread.mat, 0.3 * k)
    this.landTime += dt
    if (this.pulse) {
      // A slow pulse travels toward the replica every 3.2 s.
      const cyc = (this.threadT % 3.2) / 2.4
      const on = cyc <= 1 && draw >= 1
      this.pulse.enabled = on
      if (on) {
        this.pulse.getTransform().setWorldPosition(this.threadPointAt(easeInOutCubic(cyc)))
        setFade(this.pulseMat, 0.8 * Math.sin(Math.PI * cyc) * k)
      }
    }
  }

  private updateTrail(): void {
    if (!this.trail) return
    const flying = (this.state === "launch" && this.t >= T_FLY0) || (this.state === "returning" && this.t >= RET_FLY0 && this.t < RET_FLY1)
    const head = this.replicaCenter()
    if (flying) {
      if (this.trailPts.length === 0 || this.trailPts[this.trailPts.length - 1].distance(head) > 2) this.trailPts.push(head)
      if (this.trailPts.length > 28) this.trailPts.shift()
    } else if (this.trailPts.length > 0) {
      // Settling: the tail catches up with the head and fades.
      this.trailPts.shift()
      if (this.trailPts.length > 0) this.trailPts.shift()
    }
    if (this.trailPts.length < 2) {
      this.trail.setVisible(false)
      return
    }
    this.trail.setVisible(true)
    const n = this.trailPts.length
    // Soft taper (the light lands squared, so a gentle curve still fades the tail out).
    const alphas = this.trailPts.map((_, i) => Math.pow(i / (n - 1), 0.8))
    this.trail.update(this.trailPts, this.ctx.camPos().sub(head).normalize(), alphas)
  }

  // =====================================================================================
  // Landed: turn and take apart
  // =====================================================================================

  private updateLanded(dt: number): void {
    // Fill in from rim-only to the lifted textures over 400 ms.
    this.shellFill = easeOutCubic(this.t / T_FILL)
    this.shellRim = 0.9 + (0.3 - 0.9) * this.shellFill
    this.updatePose(dt)
    this.s = this.sEff
    let lightK = 0
    if (this.exitT >= 0) {
      // Leaving the light path: the lens group slides back, the mirror drops, the light fades.
      this.exitT += dt
      const k = easeInOutCubic(clamp01(this.exitT / 0.25))
      lightK = 1 - k
      this.mirrorUp = this.exitMirror * (1 - k)
      if (this.mirrorPlate) this.mirrorPlate.getTransform().setLocalRotation(quat.angleAxis(-45 * DEG * this.mirrorUp, vec3.right()))
      this.fadeLightPath(dt)
      if (this.exitT >= 0.3) {
        this.destroyLightPath(true)
        this.exitT = -1
        this.mirrorUp = 0
      }
    }
    this.applyApart(this.s, lightK)
    if (this.s >= 0.999 && !this.hold) this.enterLight()
  }

  /** "Take apart" dragged back below 1 during the light path: leave it; the parts follow the slider. */
  private exitLight(): void {
    this.state = "landed"
    this.t = Math.max(this.t, T_FILL)
    this.exitT = 0
    this.exitMirror = this.mirrorUp
    this.live = false
    // A shot already under way still gives its print.
    if (this.shotT >= 0 && !this.shotFlags.print) this.makePrint()
    this.shotT = -1
    this.flashT = -1
    this.shotFlags = {flash: false, print: false}
    this.setCurtains(0, 0)
    this.sensorFlash.update(0.5, 0, 0)
    if (this.bubbleFlash) this.bubbleFlash.update(0.5, 0, 0)
    this.ctx.rail.setMode("apart")
    this.ctx.caption(null)
    this.captionKey = ""
    this.ctx.log("hero:lightOff")
  }

  /** Separate the parts for slider value `s`; `lightK` blends the barrel toward its focus position. */
  private applyApart(s: number, lightK: number): void {
    // In the light path the shell moves on, up and back, clear of every part (eased, ~0.3 s).
    this.farK += (lightK - this.farK) * (1 - Math.exp(-getDeltaTime() / 0.09))
    if (Math.abs(lightK - this.farK) < 1e-3) this.farK = lightK
    for (const p of this.parts) {
      const raw = clamp01((s - p.a) / p.w)
      const e = easeInOutCubic(raw)
      p.e = e
      if (p === this.bodyPart) p.so.getTransform().setLocalPosition(vec3.lerp(p.rest, vec3.lerp(p.apart, BODY_FAR, this.farK), e))
      else if (p !== this.lensPart && p !== this.elementsPart && p !== this.aperturePart) p.so.getTransform().setLocalPosition(vec3.lerp(p.rest, p.apart, e))
      if (raw > 0.02 && !p.freed) {
        p.freed = true
        this.ctx.sound("part", this.partWorld(p))
        this.ctx.log("hero:free:" + p.key)
      } else if (raw <= 0.0 && p.freed) {
        p.freed = false
      }
      if (p.looks.length) {
        const vis = p === this.aperturePart ? e : clamp01(raw / 0.35)
        p.so.enabled = vis > 0.001 || (this.state === "light" && p !== this.aperturePart)
        this.fadeLooks(p, p.so.enabled ? Math.max(vis, this.state === "light" ? 1 : 0) * this.globalFade : 0)
      }
    }
    // Lens: unlock (reverse twist), then forward.
    const pl = clamp01((s - this.lensPart.a) / this.lensPart.w)
    const twist = 45 * easeInOutCubic(clamp01(pl / 0.4))
    const fwd = BARREL_APART * easeInOutCubic(clamp01((pl - 0.3) / 0.7))
    let barrelZ = fwd
    let plane = barrelZ + PLANE_IN_BARREL
    if (lightK > 0) {
      const lp = SENSOR_APART_Z + this.L / SCALE
      const bz = Math.max(BARREL_MIN, lp - PLANE_IN_BARREL)
      barrelZ = barrelZ + (bz - barrelZ) * lightK
      plane = plane + (lp - plane) * lightK
    }
    this.setBarrel(barrelZ, twist)
    // Elements spread inside the barrel; the aperture opens between them.
    const ee = this.elementsPart.e
    const spread = 1 + 0.85 * ee
    const zs = ELEMENTS.map((el) => el.z)
    this.elementSos.forEach((so, i) => {
      so.getTransform().setLocalPosition(new vec3(0, 0, zs[i] * spread))
      so.enabled = ee > 0.001 || lightK > 0
    })
    this.elementsSo.getTransform().setLocalPosition(new vec3(0, 0, plane))
    this.elementsSo.getTransform().setLocalRotation(quat.angleAxis(twist * DEG, vec3.forward()))
    this.apertureSo.getTransform().setLocalPosition(new vec3(0, 0, plane))
    this.apertureSo.getTransform().setLocalScale(vec3.one().uniformScale(Math.max(1e-4, this.aperturePart.e)))
    // The lens barrel turns see-through as its elements spread, so they show inside it.
    this.barrelFill = 1 - 0.6 * ee
    this.bodyFill = 1 - (0.85 + (1 - 0.85 - BODY_LIGHT_FILL) * this.farK) * this.bodyPart.e
    this.updateSheen()
    this.updatePartLabels()
  }

  private barrelFill = 1
  private bodyFill = 1

  /**
   * Part labels (§9: no label overlaps another label or a part). Each label's words are placed from
   * the user's eye: rows above or below its part (its preferred side first), the words beside the
   * leader's end. The first spot whose words clear every visible part, the labels already placed,
   * the bubble, the caption and the rail wins; the shell and lens ghosts are avoided too when
   * possible. A label keeps its spot while it stays clear, and glides to a new one (≈70 ms).
   */
  private updatePartLabels(): void {
    const labels = this.ctx.labels
    const rtr = this.replica.getTransform()
    const rot = rtr.getWorldRotation()
    const sc = rtr.getWorldScale().x
    const want: Part[] = []
    for (const p of this.parts) {
      if (!p.looks.length) continue
      const id = "hero_" + p.key
      // In live view only the parts the light path is about keep their labels.
      const keep = !this.live || p.key === "elements" || p.key === "sensor"
      if (p.e > 0.8 && this.state !== "returning" && keep) want.push(p)
      else {
        if (labels.isShown(id)) labels.hide(id)
        this.labelPlans.delete(p.key)
      }
    }
    if (!want.length) return
    const F = viewFrame(this.ctx.camPos(), this.stageCenter())
    const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
    const hard: vec2[][] = []
    const soft: vec2[][] = []
    for (const p of this.parts) {
      if (!p.looks.length || !p.so.enabled) continue
      const corners: vec3[] = []
      for (const b of meshBoxes(p.so)) for (const q of b) corners.push(q)
      if (corners.length) hard.push(view(corners))
    }
    for (const b of meshBoxes(this.bodySo, this.bodyMat)) soft.push(view(b))
    for (const b of meshBoxes(this.barrelSo, this.barrelMat)) soft.push(view(b))
    if (this.bubble && this.bubbleOpen > 0.01) {
      const c = this.bubble.getTransform().getWorldPosition()
      const k = F.D / Math.max(1, c.sub(F.eye).dot(F.f))
      hard.push(circle2(toView(F, c), BUBBLE_R * this.bubble.getTransform().getWorldScale().x * k + 0.5))
    }
    const cap = labels.getCaptionQuad()
    if (cap) hard.push(view(cap))
    if (this.ctx.rail.isVisible()) for (const b of this.ctx.rail.getBoxes()) hard.push(view(b))

    const dd = labels.getDesignDistance()
    const M = 0.8
    const placed: vec2[][] = []
    const dt = getDeltaTime()
    for (const p of want) {
      const id = "hero_" + p.key
      const anchorW = p.so.getTransform().getWorldTransform().multiplyPoint(p.anchor)
      const A = toView(F, anchorW)
      const dA = Math.max(1, anchorW.sub(F.eye).dot(F.f))
      // Words at design scale; their angular size is constant (scale ∝ distance), so in view
      // units they are size · D / designDistance.
      const size = labels.measure(p.label).uniformScale(F.D / dd)
      const g = (0.6 * F.D) / dd
      const offW = rot.multiplyVec3(p.labelOff.uniformScale(sc))
      const sv = offW.dot(F.u) >= 0 ? 1 : -1
      const sh = offW.dot(F.r) >= 0 ? 1 : -1
      const box = (o: vec2, side: number) => {
        const e = A.add(o)
        return side > 0 ? rect2(e.x + g, e.x + g + size.x, e.y - size.y / 2, e.y + size.y / 2) : rect2(e.x - g - size.x, e.x - g, e.y - size.y / 2, e.y + size.y / 2)
      }
      const clear = (o: vec2, side: number, useSoft: boolean) => {
        const b = box(o, side)
        for (const h of hard) if (polyGap(b, h) < M) return false
        for (const h of placed) if (polyGap(b, h) < M) return false
        // The leader must not cut through words already placed.
        const seg = [A, A.add(o)]
        for (const h of placed) if (polyGap(seg, h) < 0.3) return false
        if (useSoft) for (const h of soft) if (polyGap(b, h) < M) return false
        return true
      }
      let plan = this.labelPlans.get(p.key) ?? null
      if (plan && !clear(plan.o, plan.side, plan.soft)) plan = null
      if (!plan) {
        search: for (const useSoft of [true, false]) {
          for (const v of [sv, -sv]) {
            for (const rise of [3, 4.5, 6, 8, 10, 12.5, 15, 18, 22]) {
              for (const lat of [0, 2.5, 5, 8, 11, 14]) {
                for (const side of [sh, -sh]) {
                  const o = new vec2(side * lat, v * rise)
                  if (clear(o, side, useSoft)) {
                    plan = {o, side, soft: useSoft}
                    break search
                  }
                }
              }
            }
          }
        }
      }
      // Nothing clear (very crowded): the part's own default spot.
      if (!plan) plan = {o: new vec2(offW.dot(F.r), offW.dot(F.u)).uniformScale(F.D / dA), side: sh, soft: false}
      this.labelPlans.set(p.key, plan)
      placed.push(box(plan.o, plan.side))
      placed.push([A, A.add(plan.o)])
      // Glide the shown offset to the plan.
      let o = this.labelShownOff.get(p.key)
      const fresh = !labels.isShown(id) || !o
      o = fresh ? plan.o : o.add(plan.o.sub(o).uniformScale(1 - Math.exp(-dt / 0.07)))
      this.labelShownOff.set(p.key, o)
      const k = dA / F.D
      const textPos = anchorW.add(F.r.uniformScale(o.x * k)).add(F.u.uniformScale(o.y * k))
      if (fresh) labels.show(id, p.label, textPos, anchorW, plan.side)
      else labels.move(id, textPos, anchorW, plan.side)
    }
  }

  private labelPlans = new Map<string, {o: vec2; side: number; soft: boolean}>()
  private labelShownOff = new Map<string, vec2>()

  private hideAllLabels(): void {
    for (const p of this.parts) if (p.looks.length) this.ctx.labels.hide("hero_" + p.key)
  }

  // =====================================================================================
  // Light path
  // =====================================================================================

  private enterLight(): void {
    if (this.exitT >= 0) {
      this.destroyLightPath(true)
      this.exitT = -1
    }
    this.state = "light"
    this.lightT = 0
    this.live = false
    this.mirrorUp = 0
    this.d_o = 50
    this.L = L_APART
    this.ctx.rail.setFocusValue((this.L - HERO_L_MIN) / (HERO_L_MAX - HERO_L_MIN))
    this.ctx.rail.setMode("viewfinder")
    this.buildSubject()
    this.buildRays()
    this.buildBubble()
    this.setCaption("vf")
    this.ctx.log("hero:light")
  }

  private updateLight(dt: number): void {
    if (this.ctx.rail.getApartValue() < 0.98 && !this.hold) {
      this.exitLight()
      this.updateLanded(dt)
      return
    }
    this.lightT += dt
    this.shellFill = 1
    this.shellRim = 0.3
    this.updatePose(dt)
    this.s = 1
    if (this.live) {
      const v = this.ctx.rail.getFocusValue()
      this.L = HERO_L_MIN + (HERO_L_MAX - HERO_L_MIN) * v
    }
    this.applyApart(1, 1)
    // Viewfinder beat (mirror down), then the mirror lifts with a soft click: live view.
    if (this.lightT >= VF_BEAT && this.mirrorUp === 0) {
      this.ctx.sound("mirror", this.partWorld(this.mirrorPart))
      this.setCaption("up")
      this.captionHoldT = 2.2
      this.ctx.log("hero:mirrorUp")
    }
    this.mirrorUp = this.lightT < VF_BEAT ? 0 : Math.max(1e-4, easeInOutCubic((this.lightT - VF_BEAT) / MIRROR_UP_DUR))
    this.mirrorPlate.getTransform().setLocalRotation(quat.angleAxis(-45 * DEG * this.mirrorUp, vec3.right()))
    if (!this.live && this.lightT >= LIVE_AT) {
      this.live = true
      this.ctx.rail.setMode("light")
      this.ctx.log("hero:live")
    }
    this.updateSubject(dt)
    this.updateRays()
    this.updateBubble(dt)
    this.updateShot(dt)
    // Captions: sharp / blurry once live (after the mirror-up line has been read). A caption held
    // back while a print develops keeps its full reading time for when it shows.
    if (this.captionHoldT > 0 && !this.captionWaiting()) this.captionHoldT -= dt
    if (this.live && this.captionHoldT <= 0 && this.shotT < 0) {
      const sharp = this.getOptics().sharp
      this.setCaption(sharp ? "sharp" : "blurry")
    }
  }

  private setCaption(key: string): void {
    if (key === this.captionKey) return
    this.captionKey = key
    this.showCaption()
  }

  /**
   * Show the current caption where it belongs: hidden while a print develops, then hanging below
   * the print while it is there; otherwise at the top of the rail.
   */
  private showCaption(): void {
    const texts: {[k: string]: string} = {
      vf: keyWord("Until you shoot, a mirror sends *light* to your eye.", LIGHT),
      up: keyWord("Mirror up: now the *light* reaches the sensor.", LIGHT),
      sharp: keyWord("*Sharp.* The rays meet exactly on the sensor.", SIGNAL),
      blurry: keyWord("*Blurry.* Turn the focus until the rays meet.", LIGHT),
      pixel: keyWord("Each pixel turns light into *signal*.", SIGNAL)
    }
    const text = texts[this.captionKey] ?? null
    if (this.captionWaiting()) this.ctx.caption(null)
    else if (this.print) this.ctx.caption(text, this.printCaptionAnchor())
    else this.ctx.caption(text)
  }

  /**
   * The subject (§6): a small white candle, code-built, centred on the optical axis: base at
   * -h_o/2, flame tip at +h_o/2 (h_o = 6 cm). The wax is a solid lit by the replica's key and fill
   * lights, its top glowing warm from the flame; the flame is soft light (warm white with an amber
   * core) on a billboard that turns to the user, and it flickers (transforms and opacity only).
   */
  private buildSubject(): void {
    const so = this.node(this.replica, "HeroSubject", vec3.zero())
    this.subjectMat = this.glowMat()
    const h = HERO_H_O / SCALE
    const B = -h / 2
    const T = CANDLE_TOP
    const R = CANDLE_R
    const fallback = ink(INK, 0.4)
    this.waxLook = this.solidLook("wax")
    // Wax: a lathe around the candle's axis (built around +Z, stood upright), its top dished where
    // it has melted.
    const waxSo = this.node(so, "CandleWax", vec3.zero())
    waxSo.getTransform().setLocalRotation(quat.angleAxis(-Math.PI / 2, vec3.right()))
    const wk = new MeshKit()
    latheSmooth(wk, [{r: 0, z: B, nr: 0, nz: -1}, {r: R * 0.96, z: B, nr: 0, nz: -1}], 40, fallback)
    latheSmooth(
      wk,
      [
        {r: R * 0.96, z: B, nr: 0.4, nz: -1},
        {r: R, z: B + 0.025, nr: 1, nz: -0.3},
        {r: R, z: T - 0.06, nr: 1, nz: 0},
        {r: R * 0.97, z: T - 0.012, nr: 0.75, nz: 0.7},
        {r: R * 0.86, z: T, nr: 0.15, nz: 1},
        {r: R * 0.5, z: T - 0.03, nr: 0.05, nz: 1},
        {r: 0, z: T - 0.045, nr: 0, nz: 1}
      ],
      40,
      fallback
    )
    spawnMesh(waxSo, "WaxMesh", wk.build(), this.waxLook.mat, undefined, this.waxLook.mat)
    // Two wax drips down the side.
    const dk = new MeshKit()
    for (const [ang, len] of [[0.7, 0.3], [2.75, 0.17]]) {
      const c = Math.cos(ang)
      const sn = Math.sin(ang)
      const at = (r: number, y: number) => new vec3(c * r, y, sn * r)
      dk.addTube([at(R * 0.95, T - 0.01), at(R + 0.012, T - 0.05), at(R + 0.014, T - len)], 0.028, fallback, 8, 50)
      dk.addSphere(at(R + 0.006, T - len), 0.036, fallback, 6, 8)
    }
    spawnMesh(so, "WaxDrips", dk.build(), this.waxLook.mat, undefined, this.waxLook.mat)
    // Warm light on the wax near the flame, the wick and its ember, and two faint grab rings.
    const gk = new MeshKit()
    gk.addLathe(vec3.zero(), vec3.up(), [[R + 0.006, T - 0.45], [R + 0.006, T - 0.16], [R * 0.98 + 0.006, T - 0.008]], [ink(WAX_GLOW, 0), ink(WAX_GLOW, 0.1), ink(WAX_GLOW, 0.3)], 32)
    gk.addLathe(vec3.zero(), vec3.up(), [[0.001, T - 0.035], [R * 0.84, T + 0.004]], [ink(WAX_GLOW, 0.5), ink(WAX_GLOW, 0.12)], 32)
    gk.addTube([new vec3(0, T - 0.04, 0), new vec3(0.008, WICK_TOP - 0.05, 0), new vec3(0.024, WICK_TOP, 0)], 0.011, ink(new vec4(0.55, 0.38, 0.22, 1), 0.45), 5, 50)
    gk.addSphere(new vec3(0.024, WICK_TOP, 0), 0.017, ink(FLAME_AMBER, 0.9), 5, 6)
    gk.addTube(circle(new vec3(0, B + 0.42, 0), vec3.right(), vec3.forward(), 0.52, 40), 0.026, ink(INK, 0.5), 4, 50)
    gk.addTube(circle(new vec3(0, B + 0.27, 0), vec3.right(), vec3.forward(), 0.52, 40), 0.018, ink(INK, 0.22), 4, 50)
    spawnMesh(so, "CandleGlow", gk.build(), this.ctx.glowMat, undefined, this.subjectMat)
    // The flame: a billboard at the wick (it turns about the candle's axis to face the user).
    const H = h / 2 - FLAME_BASE
    this.flameSo = this.node(so, "CandleFlame", new vec3(0, FLAME_BASE, 0))
    this.haloSo = this.node(this.flameSo, "FlameHalo", new vec3(0, 0.3 * H, -0.01))
    this.haloMat = this.glowMat()
    const hk = new MeshKit()
    hk.addFanXY(0, 0, 0.62, 0, Math.PI * 2, ink(new vec4(1, 0.78, 0.5, 1), 0.2), ink(new vec4(1, 0.78, 0.5, 1), 0), 40)
    spawnMesh(this.haloSo, "Halo", hk.build(), this.ctx.glowMat, undefined, this.haloMat)
    this.flickerSo = this.node(this.flameSo, "FlameFlicker", vec3.zero())
    this.flameMat = this.glowMat()
    const fk = new MeshKit()
    addOuterFlame(fk, 0, H, FLAME_W, 1, null)
    spawnMesh(this.flickerSo, "FlameOuter", fk.build(), this.ctx.glowMat, undefined, this.flameMat)
    this.coreSo = this.node(this.flickerSo, "FlameCore", new vec3(0, 0, 0.004))
    const ck = new MeshKit()
    addFlameCore(ck, 0, H, FLAME_W, 1, null)
    spawnMesh(this.coreSo, "Core", ck.build(), this.ctx.glowMat, undefined, this.flameMat)
    // Markers for the optics: the flame tip and the candle's base, on the axis.
    this.candleTip = this.node(so, "CandleTip", new vec3(0, h / 2, 0))
    this.candleBase = this.node(so, "CandleBase", new vec3(0, -h / 2, 0))
    setLayerDeep(so, this.layer)
    // Grab it to slide it along the axis (constrained, 25–90 cm from the lens).
    const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const sh = Shape.createBoxShape()
    sh.size = new vec3(1.3, h + 0.8, 1.3)
    col.shape = sh
    const inter = so.createComponent(Interactable.getTypeName()) as Interactable
    inter.enableInstantDrag = true
    inter.onDragStart.add((e) => {
      if (this.state !== "light") return
      this.subjectAccum = vec3.zero()
      this.subjectDrag = {p: e.interactor.planecastPoint ?? vec3.zero(), d: this.d_o, axis: this.replica.getTransform().forward}
    })
    inter.onDragUpdate.add((e) => {
      if (!this.subjectDrag) return
      let p = e.interactor.planecastPoint
      if (!p) {
        this.subjectAccum = this.subjectAccum.add(e.dragVector ?? vec3.zero())
        p = this.subjectDrag.p.add(this.subjectAccum)
      }
      this.d_o = Math.max(HERO_D_MIN, Math.min(HERO_D_MAX, this.subjectDrag.d + p.sub(this.subjectDrag.p).dot(this.subjectDrag.axis)))
    })
    inter.onDragEnd.add(() => (this.subjectDrag = null))
    this.subject = so
    this.fadeSubject(0)
  }

  private lensPlaneZ(): number {
    return SENSOR_APART_Z + this.L / SCALE
  }

  private updateSubject(dt: number): void {
    if (!this.subject) return
    const z = this.lensPlaneZ() + this.d_o / SCALE
    const tr = this.subject.getTransform()
    tr.setLocalPosition(new vec3(0, 0, z))
    const k = easeOutCubic(this.lightT / 0.3)
    tr.setLocalScale(vec3.one().uniformScale(Math.max(1e-4, 0.6 + 0.4 * k)))
    this.fadeSubject(k * this.lightFade())
    this.flicker()
    void dt
  }

  /** The candle's opacity: wax (solid fill and rim), its glow, and the flame. */
  private fadeSubject(a: number): void {
    this.flameA = a
    if (this.subjectMat) setFade(this.subjectMat, a)
    if (this.waxLook) this.fadeLook(this.waxLook, a)
    if (this.flameMat) setFade(this.flameMat, a)
    if (this.haloMat) setFade(this.haloMat, a)
  }

  /** The flame lives: it stretches and narrows, sways, and its light breathes (transforms and opacity). */
  private flicker(): void {
    if (!this.flameSo) return
    const t = getTime()
    const TAU = Math.PI * 2
    const sy = 1 + 0.06 * Math.sin(TAU * 5.3 * t) + 0.035 * Math.sin(TAU * 8.9 * t + 1.3) + 0.02 * Math.sin(TAU * 13.7 * t + 0.4)
    const sx = 1 - 0.45 * (sy - 1) + 0.02 * Math.sin(TAU * 6.1 * t + 2)
    const sway = (3.5 * Math.sin(TAU * 1.3 * t) + 2 * Math.sin(TAU * 2.9 * t + 0.7) + Math.sin(TAU * 7.1 * t)) * DEG
    // Billboard about the candle's axis: the flame faces the user and stays upright.
    const ftr = this.flameSo.getTransform()
    const up = this.replica.getTransform().up
    const toHead = this.ctx.camPos().sub(ftr.getWorldPosition())
    let d = toHead.sub(up.uniformScale(toHead.dot(up)))
    if (d.length < 1e-3) d = this.replica.getTransform().right
    ftr.setWorldRotation(quat.lookAt(d.normalize(), up))
    const ktr = this.flickerSo.getTransform()
    ktr.setLocalRotation(quat.angleAxis(sway, vec3.forward()))
    ktr.setLocalScale(new vec3(sx, sy, 1))
    const cs = 1 + 0.06 * Math.sin(TAU * 7.7 * t + 0.9)
    this.coreSo.getTransform().setLocalScale(new vec3(1 / Math.sqrt(cs), cs, 1))
    const b = 0.9 + 0.06 * Math.sin(TAU * 9.7 * t) + 0.04 * Math.sin(TAU * 15.3 * t + 2.1)
    setFade(this.flameMat, this.flameA * b)
    this.haloSo.getTransform().setLocalScale(vec3.one().uniformScale(1 + 0.06 * Math.sin(TAU * 4.1 * t + 0.3)))
    setFade(this.haloMat, this.flameA * (0.85 + 0.15 * b))
    this.flameScaleY = sy
  }

  /** 1 while the light path shows; fades out as the replica reassembles. */
  private lightFade(): number {
    if (this.state === "returning") return 1 - clamp01(this.t / 0.22)
    if (this.exitT >= 0) return 1 - clamp01(this.exitT / 0.22)
    return 1
  }

  private buildRays(): void {
    this.raysSo = this.node(this.replica, "HeroRays", vec3.zero())
    const k = new MeshKit()
    k.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 1, ink(LIGHT, 0.95), 6, 50)
    k.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 2.6, ink(LIGHT, 0.14), 6, 50)
    this.beamMesh = k.build()
    this.rayMat = this.glowMat()
    this.rayFaintMat = this.glowMat()
    for (let i = 0; i < 34; i++) this.beams.push(this.makeBeam(this.raysSo, "Ray" + i))
    // Pulses of light that run along the rays (§7): a bright spindle in a soft glow.
    const pk = new MeshKit()
    pk.addLathe(vec3.zero(), vec3.forward(), [[0.001, 0], [0.5, 0.3], [0.5, 0.7], [0.001, 1]], [ink(FLAME_WHITE, 0.4), ink(FLAME_WHITE, 1), ink(FLAME_WHITE, 1), ink(FLAME_WHITE, 0.4)], 8)
    pk.addLathe(vec3.zero(), vec3.forward(), [[0.001, -0.3], [1.7, 0.35], [1.7, 0.65], [0.001, 1.3]], [ink(FLAME_WHITE, 0), ink(FLAME_WHITE, 0.24), ink(FLAME_WHITE, 0.24), ink(FLAME_WHITE, 0)], 10)
    const mesh = pk.build()
    this.rayPulseMat = this.glowMat()
    for (let i = 0; i < PULSE_POOL; i++) {
      const so = this.node(this.raysSo, "Pulse" + i, vec3.zero())
      const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      rmv.mesh = mesh
      rmv.mainMaterial = this.rayPulseMat
      so.enabled = false
      this.rayPulses.push(so)
    }
  }

  private makeBeam(parent: SceneObject, name: string): Beam {
    const so = this.node(parent, name, vec3.zero())
    const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    rmv.mesh = this.beamMesh
    rmv.mainMaterial = this.rayMat
    so.enabled = false
    return {so, rmv}
  }

  /** Place a beam between a and b (parent-local), `r` thick. */
  private setBeam(b: Beam, a: vec3, c: vec3, r: number, faint: boolean): void {
    const d = c.sub(a)
    const len = d.length
    if (len < 1e-4) {
      b.so.enabled = false
      return
    }
    b.so.enabled = true
    const tr = b.so.getTransform()
    tr.setLocalPosition(a)
    tr.setLocalRotation(quat.rotationFromTo(vec3.forward(), d.uniformScale(1 / len)))
    tr.setLocalScale(new vec3(r, r, len))
    b.rmv.mainMaterial = faint ? this.rayFaintMat : this.rayMat
  }

  /**
   * The light path, computed every frame from the thin-lens equation (never keyframed): rays from
   * the flame tip and the candle's base through the top, centre and bottom of the aperture, to their
   * real crossing point. With the mirror down they reflect up into the prism and out of the
   * viewfinder. Pulses of light run along each ray's whole path.
   */
  private updateRays(): void {
    if (!this.raysSo) return
    const o = this.getOptics()
    const zl = this.lensPlaneZ()
    const zs = SENSOR_APART_Z
    const ho = HERO_H_O / SCALE
    const a2 = HERO_A / 2 / SCALE
    const zo = zl + o.d_o / SCALE
    const zi = zl - o.d_i / SCALE
    // The candle stands centred on the axis: flame tip at +h_o/2, base at -h_o/2. Images are inverted.
    const yTipImg = -((HERO_H_O / 2) * o.d_i) / o.d_o / SCALE
    const P = (y: number, z: number) => new vec3(0, y, z)
    const rays: {from: vec3; lens: vec3; img: vec3}[] = []
    const tip = P(ho / 2, zo)
    const base = P(-ho / 2, zo)
    for (const y of [a2, 0, -a2]) rays.push({from: tip, lens: P(y, zl), img: P(yTipImg, zi)})
    for (const y of [a2, 0, -a2]) rays.push({from: base, lens: P(y, zl), img: P(-yTipImg, zi)})
    this.rayStarts = rays.map((r) => r.from)

    let bi = 0
    const r = 0.035
    const next = () => (bi < this.beams.length ? this.beams[bi++] : null)
    const put = (a: vec3, c: vec3, faint: boolean = false) => {
      const b = next()
      if (b) this.setBeam(b, a, c, r, faint)
    }
    const mirrorDown = this.mirrorUp < 0.5
    const prism = this.prismPart.so.getTransform().getLocalPosition()
    const eye = this.viewfinderPart.so.getTransform().getLocalPosition()
    const mirrorC = this.mirrorPart.so.getTransform().getLocalPosition().add(new vec3(0, -MIRROR_HALF * ROOT2, MIRROR_HALF * ROOT2))
    const yScreen = prism.y - 1.45
    const roof = P(prism.y + 1.2, prism.z + 0.3)
    const back = P(prism.y + 0.2, prism.z - 1.6)
    const eyeOut = eye.add(new vec3(0, 0, -4))
    const paths: {pts: vec3[]; phase: number}[] = []
    rays.forEach((ray, i) => {
      put(ray.from, ray.lens)
      const dir = ray.img.sub(ray.lens).normalize()
      // The flame's rays pulse in step; the base's half a period later.
      const phase = i < 3 ? 0 : PULSE_PERIOD / 2
      if (mirrorDown) {
        // Line y + (z - z_m) = 0 through the mirror's centre; reflect off it (normal (0,1,1)/√2).
        const t = (mirrorC.z - ray.lens.y - ray.lens.z) / (dir.y + dir.z)
        const hit = ray.lens.add(dir.uniformScale(t))
        put(ray.lens, hit)
        const n = new vec3(0, ROOT2, ROOT2)
        const refl = dir.sub(n.uniformScale(2 * dir.dot(n)))
        const t2 = (yScreen - hit.y) / Math.max(1e-3, refl.y)
        const scr = hit.add(refl.uniformScale(t2))
        put(hit, scr)
        put(scr, roof)
        paths.push({pts: [ray.from, ray.lens, hit, scr, roof, back, eye, eyeOut], phase})
      } else {
        // Straight to the sensor; if the rays would meet behind it, the rest of the way is faint.
        const ts = (zs - ray.lens.z) / dir.z
        const onSensor = ray.lens.add(dir.uniformScale(ts))
        put(ray.lens, onSensor)
        if (zi < zs) put(onSensor, ray.img, true)
        paths.push({pts: [ray.from, ray.lens, onSensor], phase})
      }
    })
    if (mirrorDown) {
      put(roof, back)
      put(back, eye)
      put(eye, eyeOut)
    }
    for (; bi < this.beams.length; bi++) this.beams[bi].so.enabled = false
    const a = easeOutCubic((this.lightT - 0.25) / 0.35) * this.lightFade()
    // The steady rays are a little dimmer than the pulses running along them.
    setFade(this.rayMat, RAY_STEADY * a)
    setFade(this.rayFaintMat, 0.3 * a)
    this.updatePulses(paths, a)
    // The image on the sensor: inverted, h_i tall, blurred by c (local units).
    const show = !mirrorDown
    this.sensorImage.update(-o.h_i / SCALE, o.c / SCALE, show ? a : 0)
    // The pixels under the image light up: a soft cyan glow, a little wider than the image.
    this.sensorGlow.update(-o.h_i / SCALE, o.c / SCALE + 0.15, (show ? a : 0) * 0.6)
  }

  /**
   * Pulses run along every ray from the flame (and the base) to the sensor, or out of the
   * viewfinder while the mirror is down: one per ray every PULSE_PERIOD, at PULSE_SPEED. Each
   * tapers in and out at the path's ends (scale only).
   */
  private updatePulses(paths: {pts: vec3[]; phase: number}[], a: number): void {
    let n = 0
    const spacing = PULSE_SPEED * PULSE_PERIOD
    const len = 1.3
    const rad = 0.12
    for (const p of paths) {
      const segs: number[] = []
      let L = 0
      for (let i = 1; i < p.pts.length; i++) {
        const l = p.pts[i].distance(p.pts[i - 1])
        segs.push(l)
        L += l
      }
      const t = this.lightT - p.phase
      if (t < 0) continue
      // The newest pulse, then the older ones a spacing apart (none before the light came on).
      for (let s = (t % PULSE_PERIOD) * PULSE_SPEED; s <= L && s <= t * PULSE_SPEED && n < this.rayPulses.length; s += spacing) {
        let rem = s
        let i = 0
        while (i < segs.length - 1 && rem > segs[i]) {
          rem -= segs[i]
          i++
        }
        const A = p.pts[i]
        const dir = p.pts[i + 1].sub(A).uniformScale(1 / Math.max(1e-4, segs[i]))
        const pos = A.add(dir.uniformScale(Math.min(rem, segs[i])))
        const taper = clamp01(s / 0.8) * clamp01((L - s) / 0.8)
        const so = this.rayPulses[n++]
        so.enabled = taper > 0.01
        const tr = so.getTransform()
        tr.setLocalPosition(pos.sub(dir.uniformScale(len * 0.5 * taper)))
        tr.setLocalRotation(quat.rotationFromTo(vec3.forward(), dir))
        tr.setLocalScale(new vec3(rad * taper + 1e-4, rad * taper + 1e-4, len * taper + 1e-4))
      }
    }
    this.rayPulseCount = n
    for (; n < this.rayPulses.length; n++) this.rayPulses[n].enabled = false
    if (this.rayPulseMat) setFade(this.rayPulseMat, a)
  }

  private buildBubble(): void {
    const b = this.node(this.root, "HeroSensorBubble", vec3.zero())
    const face = this.node(b, "BubbleFace", vec3.zero())
    this.bubbleMat = this.glowMat()
    const R = BUBBLE_R
    const k = new MeshKit()
    k.addArcXY(0, 0, R, 0.22, 0, Math.PI * 2, ink(INK, 0.85), 96)
    k.addArcXY(0, 0, R - 0.6, 0.11, 0, Math.PI * 2, ink(INK, 0.4), 96)
    k.addFanXY(0, 0, R - 0.7, 0, Math.PI * 2, ink(INK, 0.02), ink(INK, 0.035), 64)
    // The sensor face-on, magnified like a loupe: cyan outline, faint fill and pixel grid, cut to
    // the bubble's round window.
    const M = BUBBLE_M
    const hw = (SENSOR_W * SCALE * M) / 2
    const hh = (SENSOR_H * SCALE * M) / 2
    const Rc = R - 0.9
    const line = (ax: number, ay: number, bx: number, by: number, w: number, c: vec4) => {
      const seg = clipToDisc(ax, ay, bx, by, Rc)
      if (seg) k.addLineXY(seg[0], seg[1], seg[2], seg[3], w, c)
    }
    {
      const n = 64
      const c0 = k.vert(new vec3(0, 0, 0), new vec3(0, 0, 1), ink(SIGNAL, 0.06))
      const ring: number[] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        const x = Math.max(-hw, Math.min(hw, Math.cos(a) * Rc))
        const y = Math.max(-hh, Math.min(hh, Math.sin(a) * Rc))
        ring.push(k.vert(new vec3(x, y, 0), new vec3(0, 0, 1), ink(SIGNAL, 0.06)))
      }
      for (let i = 0; i < n; i++) k.tri(c0, ring[i], ring[(i + 1) % n])
    }
    line(-hw, -hh, hw, -hh, 0.14, ink(SIGNAL, 0.85))
    line(hw, -hh, hw, hh, 0.14, ink(SIGNAL, 0.85))
    line(hw, hh, -hw, hh, 0.14, ink(SIGNAL, 0.85))
    line(-hw, hh, -hw, -hh, 0.14, ink(SIGNAL, 0.85))
    for (let i = 1; i < 12; i++) line(-hw + (i / 12) * 2 * hw, -hh, -hw + (i / 12) * 2 * hw, hh, 0.04, ink(SIGNAL, 0.14))
    for (let j = 1; j < 8; j++) line(-hw, -hh + (j / 8) * 2 * hh, hw, -hh + (j / 8) * 2 * hh, 0.04, ink(SIGNAL, 0.14))
    spawnMesh(face, "BubbleFrame", k.build(), this.ctx.glowMat, undefined, this.bubbleMat)
    const img = this.node(face, "BubbleImage", new vec3(0, 0, 0.05))
    img.getTransform().setLocalScale(vec3.one().uniformScale(M))
    this.bubbleImage = new BlurImage(img, "BubbleImageBlur", this.ctx.glowMat, null, 3)
    this.bubbleFlash = new BlurImage(img, "BubbleFlash", this.ctx.glowMat, SIGNAL, 3)
    // Thin cyan outline around the image when it is sharp.
    this.bubbleSharp = this.node(img, "SharpOutline", new vec3(0, 0, 0.03))
    this.bubbleSharpMat = this.glowMat()
    const ok = new MeshKit()
    const ow = 0.03
    for (const pts of candleOutline()) for (let i = 0; i < pts.length - 1; i++) ok.addLineXY(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, ow, ink(SIGNAL, 0.95))
    spawnMesh(this.bubbleSharp, "Outline", ok.build(), this.ctx.glowMat, undefined, this.bubbleSharpMat)
    // Leader from the sensor to the bubble's rim.
    const lk = new MeshKit()
    lk.addTube([new vec3(0, 0, 0), new vec3(0, 0, 1)], 1, ink(INK, 0.5), 4, 50)
    const lso = this.node(this.root, "BubbleLeader", vec3.zero())
    const lrmv = lso.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    lrmv.mesh = lk.build()
    lrmv.mainMaterial = this.bubbleMat
    this.bubbleLeader = {so: lso, rmv: lrmv}
    b.getTransform().setLocalScale(vec3.one().uniformScale(1e-4))
    this.bubble = b
    this.bubbleFace = face
  }

  private updateBubble(dt: number): void {
    if (!this.bubble) return
    const o = this.getOptics()
    const sensor = this.partWorld(this.sensorPart)
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(sensor))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    const target = sensor.add(right.uniformScale(BUBBLE_SIDE)).add(toUser.uniformScale(BUBBLE_TOWARD))
    // Opens after the mirror lifts (the image is on the sensor from then on).
    const open = easeOutCubic((this.lightT - VF_BEAT - 0.1) / 0.3) * this.lightFade()
    this.bubbleOpen = open
    const tr = this.bubble.getTransform()
    tr.setWorldPosition(vec3.lerp(sensor, target, open))
    tr.setWorldScale(vec3.one().uniformScale(Math.max(1e-4, open)))
    this.bubbleFace.getTransform().setWorldRotation(faceToward(head.sub(tr.getWorldPosition())))
    setFade(this.bubbleMat, open)
    // Seen from behind the camera, the sensor image is the subject turned 180°.
    this.bubbleImage.update(-o.h_i, o.c, open)
    const sharp = o.sharp ? 1 : 0
    this.sharpK += (sharp - this.sharpK) * (1 - Math.exp(-dt / 0.06))
    const s = o.h_i
    this.bubbleSharp.getTransform().setLocalScale(new vec3(s, -s, 1))
    setFade(this.bubbleSharpMat, this.sharpK * open)
    // Leader: from beside the sensor to the rim.
    const bc = tr.getWorldPosition()
    const toB = bc.sub(sensor)
    const rimPt = bc.sub(toB.normalize().uniformScale(BUBBLE_R * open))
    const from = sensor.add(toB.normalize().uniformScale(1.2))
    const d = rimPt.sub(from)
    const lt = this.bubbleLeader.so.getTransform()
    if (d.length > 0.5 && open > 0.05) {
      this.bubbleLeader.so.enabled = true
      lt.setWorldPosition(from)
      lt.setWorldRotation(quat.rotationFromTo(vec3.forward(), d.normalize()))
      lt.setWorldScale(new vec3(0.08, 0.08, d.length))
    } else {
      this.bubbleLeader.so.enabled = false
    }
  }

  // =====================================================================================
  // Photo
  // =====================================================================================

  private setCurtains(first: number, second: number): void {
    // Curtain cover 0..1 (1 = covers the gate). The first curtain opens downward: its slats slide
    // down and stack below the gate. The second closes from the top: its slats unstack downward.
    const step = (2 * SHUTTER_HH - 2 * SLAT_HH) / (SLATS - 1)
    for (let c = 0; c < this.slats.length; c++) {
      const cover = clamp01(c === 0 ? first : second)
      this.slats[c].forEach((so, j) => {
        const spread = -SHUTTER_HH + SLAT_HH + j * step
        const stack = c === 0 ? -SHUTTER_HH - 0.42 + j * 0.05 : SHUTTER_HH + 0.42 - (SLATS - 1 - j) * 0.05
        so.getTransform().setLocalPosition(new vec3(0, stack + (spread - stack) * cover, (c === 0 ? 0.07 : 0.11) + j * 0.004))
      })
    }
  }

  private updateShot(dt: number): void {
    if (this.flashT >= 0) {
      this.flashT += dt
      const o = this.getOptics()
      const a = this.flashT < 0.6 ? 1 - easeOutCubic(this.flashT / 0.6) : 0
      this.sensorFlash.update(-o.h_i / SCALE, o.c / SCALE, a)
      if (this.bubbleFlash) this.bubbleFlash.update(-o.h_i, o.c, a)
      if (this.flashT > 0.65) this.flashT = -1
    }
    if (this.shotT < 0) {
      this.setCurtains(0, 0)
      return
    }
    this.shotT += dt
    const t = this.shotT
    // First curtain opens (0–0.1 s), second closes (0.105–0.205 s), then both reset for live view.
    const first = t < 0.1 ? 1 - easeInOutCubic(t / 0.1) : 0
    const second = t < 0.105 ? 0 : t < 0.205 ? easeInOutCubic((t - 0.105) / 0.1) : t < 0.45 ? 1 : 1 - easeInOutCubic((t - 0.45) / 0.15)
    this.setCurtains(t < 0.02 ? 1 : first, second)
    // Exposure ends when the second curtain closes: the print is made and the pixels flash. (The
    // print first, so the "pixel" caption already knows to wait for it to develop.)
    if (t >= 0.205 && !this.shotFlags.print) {
      this.shotFlags.print = true
      this.makePrint()
    }
    if (t >= 0.205 && !this.shotFlags.flash) {
      this.shotFlags.flash = true
      this.flashT = 0
      this.setCaption("pixel")
      this.captionHoldT = 2.5
      this.ctx.log("hero:pixels")
    }
    if (t >= 0.62) {
      this.shotT = -1
      this.shotFlags = {flash: false, print: false}
    }
  }

  private shotFlags = {flash: false, print: false}

  /**
   * The photo (§8, fix pass): a print with a 12 × 8 cm image area, a 0.8 cm white border (the bottom
   * one 2 cm, instant-film style, holding the tag) and a soft gloss. It slides out of the top of the
   * camera body, rises, turns to the user and floats 75 cm from their eyes, a little below eye level
   * and tilted toward them, beside the replica (printPlace); then it develops like instant film
   * (blank, the picture fading in over 1.2 s). The picture is the candle upright in a warm glow with
   * exactly the sensor's blur (the sensor frame enlarged; relative blur c / h unchanged; see
   * buildPrintPicture). The tag in the bottom border reads "Sharp" or "Out of focus". The stage
   * caption waits while the print develops, then hangs below it. The next photo replaces the print;
   * pinching it dismisses it.
   *
   * The print is the one SceneObject named HERO_PRINT_NAME; a replaced or dismissed print is renamed
   * before it fades, so a name lookup only ever finds the live one.
   */
  private makePrint(): void {
    this.retirePrint()
    const o = this.getOptics()
    const so = this.node(this.root, HERO_PRINT_NAME, vec3.zero())
    const face = this.node(so, "PrintFace", vec3.zero())
    const mats: Material[] = []
    const W = PRINT_W / 2
    const H = PRINT_H / 2
    const b = PRINT_BORDER
    // The image area: above the wide bottom border.
    const iy0 = -H + PRINT_CHIN
    const iy1 = H - b
    // The card: white paper around the image area.
    const cardMat = this.glowMat()
    mats.push(cardMat)
    const ck = new MeshKit()
    const paper = ink(new vec4(0.97, 0.96, 0.93, 1), 0.85)
    ck.addRectXY(-W, -H, W, iy0, paper)
    ck.addRectXY(-W, iy1, W, H, paper)
    ck.addRectXY(-W, iy0, -W + b, iy1, paper)
    ck.addRectXY(W - b, iy0, W, iy1, paper)
    const card = spawnMesh(face, "PrintCard", ck.build(), this.ctx.glowMat, undefined, cardMat)
    // The blank film: a pale layer over the image area that clears as the picture develops.
    this.printBlankMat = this.glowMat()
    const bk = new MeshKit()
    bk.addRectXY(-W + b, iy0, W - b, iy1, ink(new vec4(0.82, 0.86, 0.88, 1), 0.32))
    spawnMesh(face, "PrintBlank", bk.build(), this.ctx.glowMat, new vec3(0, 0, 0.02), this.printBlankMat)
    // The picture: the sensor frame fitted into the image area, upright. A candle that would overflow
    // the photo (subject closer than ~30 cm) is scaled down to fit; its relative blur stays the same.
    let e = Math.min(PRINT_IMG_W / (SENSOR_W * SCALE), PRINT_IMG_H / (SENSOR_H * SCALE))
    e = Math.min(e, (PRINT_IMG_H - 1) / Math.max(1e-3, o.h_i))
    this.printImgH = o.h_i * e
    this.printImgC = o.c * e
    this.printPicMat = this.glowMat()
    mats.push(this.printPicMat)
    const pic = buildPrintPicture(PRINT_IMG_W, PRINT_IMG_H, this.printImgH, this.printImgC, PRINT_RINGS, PRINT_FLAME_RINGS)
    spawnMesh(face, "PrintPicture", pic, this.ctx.glowMat, new vec3(0, PRINT_IMG_Y, 0.04), this.printPicMat)
    // Gloss: a soft diagonal sheen, a thin second streak, a touch brighter toward the top.
    const sheenMat = this.glowMat()
    mats.push(sheenMat)
    const sk = new MeshKit()
    const nx = 16
    const ny = 12
    const gloss = (x: number, y: number) => {
      const d = x * 0.6 + y * 0.8
      return 0.3 * Math.exp(-Math.pow((d - 1.7) / 2.2, 2)) + 0.2 * Math.exp(-Math.pow((d + 3.1) / 0.62, 2)) + 0.12 * ((y + H) / (2 * H))
    }
    const nz = new vec3(0, 0, 1)
    const g0 = sk.vertexCount
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) {
        const x = -W + (2 * W * i) / nx
        const y = -H + (2 * H * j) / ny
        sk.vert(new vec3(x, y, 0), nz, ink(INK, gloss(x, y)))
      }
    const gi = (i: number, j: number) => g0 + j * (nx + 1) + i
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        sk.tri(gi(i, j), gi(i + 1, j), gi(i + 1, j + 1))
        sk.tri(gi(i, j), gi(i + 1, j + 1), gi(i, j + 1))
      }
    spawnMesh(face, "PrintSheen", sk.build(), this.ctx.glowMat, new vec3(0, 0, 0.08), sheenMat)
    // The tag, centred in the bottom border: "Sharp" (signal teal) or "Out of focus" (amber), in
    // ink on the paper, words about 1.2 cm tall.
    const sharp = o.sharp
    this.printTagText = sharp ? "Sharp" : "Out of focus"
    this.printTagInk = sharp ? TAG_INK_SHARP : TAG_INK_BLURRY
    const textSo = this.node(face, "PrintTag", new vec3(0, -H + PRINT_CHIN / 2, 0.1))
    textSo.getTransform().setLocalScale(vec3.one().uniformScale(PRINT_TAG_SCALE))
    const t = textSo.createComponent("Component.Text") as Text
    t.text = this.printTagText
    t.depthTest = true
    applyType(t, "note")
    setTagInk(t, this.printTagInk, 0)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-30, 30, -3, 3)
    // Drawn after the paper, so the paper's light never washes over the words.
    t.setRenderOrder(card.rmv.renderOrder + 1)
    this.printTag = t
    // Pinch the print to dismiss it.
    const col = so.createComponent("Physics.ColliderComponent") as ColliderComponent
    const box = Shape.createBoxShape()
    box.size = new vec3(PRINT_W, PRINT_H, 0.6)
    col.shape = box
    const inter = so.createComponent(Interactable.getTypeName()) as Interactable
    inter.onTriggerEnd.add(() => this.dismissPrint(so))
    this.printMats = mats
    this.printBlur = o.c
    this.printH = o.h_i
    this.print = so
    this.printT = 0
    this.printTarget = null
    this.printFrom = null
    this.printLogged = {shown: false, developed: false}
    for (const m of mats) setFade(m, 0)
    setFade(this.printBlankMat, 0)
    this.placePrint()
    // The caption waits until the print has developed.
    this.showCaption()
    this.ctx.sound("print", this.printSlot().pos)
    this.ctx.log("hero:print")
  }

  /** The live print steps aside (renamed, no longer pinchable) and fades out. */
  private retirePrint(): void {
    if (!this.print) return
    const so = this.print
    so.name = HERO_PRINT_NAME + "Old"
    const col = so.getComponent("Physics.ColliderComponent") as ColliderComponent
    if (col) col.enabled = false
    const mats = this.printMats.slice()
    if (this.printBlankMat) mats.push(this.printBlankMat)
    this.oldPrints.push({so, t: 0, mats, tag: this.printTag, ink: this.printTagInk})
    this.print = null
    this.printTag = null
    this.printPicMat = null
    this.printBlankMat = null
    this.printMats = []
  }

  /** Pinched: the print goes, and the caption returns to its place above the rail. */
  private dismissPrint(so: SceneObject): void {
    if (!this.print || !this.print.isSame(so)) return
    this.retirePrint()
    this.showCaption()
    this.ctx.log("hero:printDismissed")
  }

  /** The slot on top of the camera body, and the print's pose there (facing the user's side). */
  private printSlot(): {pos: vec3; rot: quat; up: vec3} {
    const top = new vec3(BODY_BOX_CENTER.x, BODY_BOX_CENTER.y + BODY_BOX_SIZE.y / 2, BODY_BOX_CENTER.z)
    const pos = this.bodyPart.so.getTransform().getWorldTransform().multiplyPoint(top)
    const rtr = this.replica.getTransform()
    const up = rtr.up
    // The print's face is across the body (its width along the body's depth), toward the user.
    let n = rtr.right
    if (n.dot(this.ctx.camPos().sub(pos)) < 0) n = n.uniformScale(-1)
    return {pos, rot: quat.lookAt(n, up), up}
  }

  /**
   * Where the print floats (fix pass): 75 cm from the eyes, a little below eye level, facing them,
   * beside the replica on the user's side, on the side away from the rail. Judged from the eye like
   * the labels: the print and the caption under it must clear the replica (parts, shell, bubble),
   * the candle and the rail; the part labels and the Reset pill too while there is room. For each
   * drop in PRINT_DROPS it starts where the print's centre is just past the replica's edge and steps
   * outward 0.5° at a time (up to 8°); the first clear spot wins.
   */
  private printPlace(): vec3 {
    const eye = this.ctx.camPos()
    const S = this.stageCenter()
    const F = viewFrame(eye, S)
    const view = (pts: vec3[]) => hull2(pts.map((q) => toView(F, q)))
    const replica: vec2[][] = []
    for (const p of this.parts) if (p.looks.length && p.so.enabled) for (const bx of meshBoxes(p.so)) replica.push(view(bx))
    for (const bx of meshBoxes(this.bodySo, this.bodyMat)) replica.push(view(bx))
    for (const bx of meshBoxes(this.barrelSo, this.barrelMat)) replica.push(view(bx))
    const hard = replica.slice()
    if (this.subject) for (const bx of meshBoxes(this.subject)) hard.push(view(bx))
    if (this.bubble && this.bubbleOpen > 0.01) {
      const c = this.bubble.getTransform().getWorldPosition()
      const k = F.D / Math.max(1, c.sub(F.eye).dot(F.f))
      hard.push(circle2(toView(F, c), BUBBLE_R * this.bubble.getTransform().getWorldScale().x * k))
    }
    if (this.ctx.rail.isVisible()) for (const bx of this.ctx.rail.getBoxes()) hard.push(view(bx))
    const soft: vec2[][] = []
    for (const q of this.ctx.labels.getTextQuads()) if (q.id.startsWith("hero_")) soft.push(view(q.corners))
    if (this.ctx.avoid) for (const q of this.ctx.avoid()) soft.push(view(q))

    // The side away from the rail, and the replica's edge on that side (view units).
    const toS = flatDir(S.sub(eye))
    const right = toS.cross(vec3.up()).normalize()
    const side = this.ctx.rail.getRail().getPlaced().sub(S).dot(right) >= 0 ? -1 : 1
    let edge = side < 0 ? 1e9 : -1e9
    for (const h of replica) for (const q of h) edge = side < 0 ? Math.min(edge, q.x) : Math.max(edge, q.x)
    if (!replica.length) edge = 0

    // The print (its bob included) and the caption slot under it, as one shape seen from the eye.
    // The captions shown under a print are one line, narrower than the print.
    const capScale = Math.max(0.3, PRINT_DIST / this.ctx.labels.getDesignDistance())
    const capW = PRINT_W
    const capH = 1.1 * capScale
    const M = F.D * Math.tan(0.4 * DEG)
    const at = (drop: number, a: number): vec3 => {
      const flat = Math.sqrt(PRINT_DIST * PRINT_DIST - drop * drop)
      const dir = toS.uniformScale(Math.cos(a)).add(right.uniformScale(side * Math.sin(a)))
      return eye.add(dir.uniformScale(flat)).add(new vec3(0, -drop, 0))
    }
    const shape = (P: vec3): vec2[] => {
      const rot = faceToward(eye.sub(P))
      const r = rot.multiplyVec3(vec3.right())
      const u = rot.multiplyVec3(vec3.up())
      const top = PRINT_H / 2 + PRINT_BOB
      const bottom = PRINT_H / 2 + PRINT_BOB + PRINT_CAPTION_GAP + capH
      const pts = [P.add(r.uniformScale(-PRINT_W / 2)).add(u.uniformScale(top)), P.add(r.uniformScale(PRINT_W / 2)).add(u.uniformScale(top)), P.add(r.uniformScale(capW / 2)).add(u.uniformScale(-bottom)), P.add(r.uniformScale(-capW / 2)).add(u.uniformScale(-bottom))]
      return view(pts)
    }
    const clear = (s: vec2[], obstacles: vec2[][]) => obstacles.every((h) => polyGap(s, h) >= M)
    for (const useSoft of [true, false]) {
      for (const drop of PRINT_DROPS) {
        let start = -1
        for (let deg = 0; deg <= 60; deg += 0.5) {
          const P = at(drop, deg * DEG)
          if (start < 0) {
            if (side * (toView(F, P).x - edge) < 0) continue
            start = deg
          }
          if (deg > start + 8) break
          const s = shape(P)
          if (clear(s, hard) && (!useSoft || clear(s, soft))) return P
        }
      }
    }
    // Nothing clear (an unusual layout): just past the replica's edge, at the first drop.
    for (let deg = 0; deg <= 60; deg += 0.5) {
      const P = at(PRINT_DROPS[0], deg * DEG)
      if (side * (toView(F, P).x - edge) >= 0) return P
    }
    return at(PRINT_DROPS[0], 0)
  }

  /** Where the caption hangs once the print has developed: centred under its bottom edge (and its bob). */
  private printCaptionAnchor(): vec3 {
    const P = this.printTarget ?? (this.print ? this.print.getTransform().getWorldPosition() : this.replicaCenter())
    const up = faceToward(this.ctx.camPos().sub(P)).multiplyVec3(vec3.up())
    return P.add(up.uniformScale(-(PRINT_H / 2 + PRINT_BOB + PRINT_CAPTION_GAP)))
  }

  /** True while a print is developing: the stage caption waits for it. */
  private captionWaiting(): boolean {
    return !!this.print && !this.printLogged.developed
  }

  /** Pose the live print on its path: slide out of the slot, rise, turn and fly to the user, float. */
  private placePrint(): void {
    if (!this.print) return
    const t = this.printT
    const head = this.ctx.camPos()
    const slot = this.printSlot()
    const half = PRINT_H / 2
    const tr = this.print.getTransform()
    let pos: vec3
    let rot: quat
    let sy = 1
    if (t < PRINT_SLIDE) {
      // Out of the slot: what is out grows from the slot up (only its height scales).
      const f = springOut(t / PRINT_SLIDE)
      sy = Math.max(1e-3, f)
      pos = slot.pos.add(slot.up.uniformScale(half * f))
      rot = slot.rot
    } else if (t < PRINT_SLIDE + PRINT_RISE) {
      pos = slot.pos.add(slot.up.uniformScale(half + 8 * springOut((t - PRINT_SLIDE) / PRINT_RISE)))
      rot = slot.rot
    } else {
      if (!this.printTarget || !this.printFrom) {
        this.printTarget = this.printPlace()
        this.printFrom = {pos: slot.pos.add(slot.up.uniformScale(half + 8)), rot: slot.rot}
      }
      const u = springOut((t - PRINT_SLIDE - PRINT_RISE) / PRINT_FLY)
      // Floating: a slow, small bob once it is there.
      const bob = t > PRINT_ARRIVE ? PRINT_BOB * Math.sin(((t - PRINT_ARRIVE) / 3.2) * Math.PI * 2) : 0
      const to = this.printTarget.add(new vec3(0, bob, 0))
      pos = vec3.lerp(this.printFrom.pos, to, u).add(new vec3(0, 6 * Math.sin(Math.PI * u), 0))
      rot = quat.slerp(this.printFrom.rot, faceToward(head.sub(pos)), u)
    }
    tr.setWorldPosition(pos)
    tr.setWorldRotation(rot)
    tr.setWorldScale(new vec3(1, sy, 1))
  }

  private updatePrints(dt: number): void {
    if (this.print) {
      this.printT += dt
      this.placePrint()
      const t = this.printT
      // Develops like instant film once it is in front of the user.
      const dev = clamp01((t - PRINT_ARRIVE) / PRINT_DEVELOP)
      const d = easeInOutCubic(dev)
      const a = (this.state === "returning" ? this.lightFade() : 1) * clamp01(t / 0.08)
      for (const m of this.printMats) setFade(m, a)
      if (this.printBlankMat) setFade(this.printBlankMat, a * (1 - 0.85 * d))
      if (this.printPicMat) setFade(this.printPicMat, a * d)
      if (this.printTag) setTagInk(this.printTag, this.printTagInk, a * clamp01((t - PRINT_ARRIVE) / 0.2))
      if (t >= PRINT_ARRIVE && !this.printLogged.shown) {
        this.printLogged.shown = true
        this.ctx.log("hero:printShown")
      }
      if (dev >= 1 && !this.printLogged.developed) {
        this.printLogged.developed = true
        // Developed: the caption comes back, below the print.
        this.showCaption()
        this.ctx.log("hero:printDeveloped")
      }
    }
    this.oldPrints = this.oldPrints.filter((p) => {
      p.t += dt
      const a = Math.max(0, 1 - easeIn(p.t / 0.22))
      for (const m of p.mats) setFade(m, a)
      if (p.tag) setTagInk(p.tag, p.ink, a)
      const tr = p.so.getTransform()
      tr.setWorldPosition(tr.getWorldPosition().add(new vec3(0, -12 * dt, 0)))
      if (p.t >= 0.22) {
        p.so.destroy()
        return false
      }
      return true
    })
  }

  // =====================================================================================
  // Put it back
  // =====================================================================================

  private updateReturn(dt: number): void {
    const t = this.t
    const tr = this.replica.getTransform()
    const from = this.retFrom
    if (t < RET_FLY0) {
      // Reassemble: the slider runs back to 0 and the lens twists into the mount.
      const k = easeInOutCubic(t / RET_ASSEMBLE)
      const s = from.s * (1 - k)
      this.ctx.rail.setApartValue(s)
      this.s = s
      const lightK = from.lightK * (1 - clamp01(t / 0.25))
      if (this.mirrorPlate) this.mirrorPlate.getTransform().setLocalRotation(quat.angleAxis(-45 * DEG * this.mirrorUp * (1 - clamp01(t / 0.25)), vec3.right()))
      this.applyApart(s, lightK)
      // Whole again: it lifts 3 cm off the table (0.25 s), then flies home.
      this.h = this.retH + PUTBACK_LIFT_CM * easeOutCubic((t - RET_ASSEMBLE) / (RET_FLY0 - RET_ASSEMBLE))
      this.applyPose()
      this.retPos = tr.getWorldPosition()
      this.fadeLightPath(dt)
      if (t >= RET_ASSEMBLE && !this.retFlags.click) {
        this.retFlags.click = true
        this.ctx.sound("bayonet", tr.getWorldPosition())
      }
      this.shellFill = 1
      this.shellRim = 0.3
    } else if (t < RET_FLY1) {
      this.destroyLightPath()
      this.applyApart(0, 0)
      const u = easeInOutCubic((t - RET_FLY0) / (RET_FLY1 - RET_FLY0))
      tr.setWorldPosition(bezier(this.retPos ?? this.pLand, this.ctrl, this.pMeet, u))
      tr.setWorldRotation(quat.slerp(from.rot, this.rStart, u))
      tr.setWorldScale(vec3.one().uniformScale(SCALE + (1 - SCALE) * u))
      // Back to edges of light so it can melt into the real camera.
      this.shellFill = 1 - easeOutCubic((t - RET_FLY0) / 0.4)
      this.shellRim = 0.3 + 0.6 * (1 - this.shellFill)
      if (!this.retFlags.flight) {
        this.retFlags.flight = true
        this.ctx.sound("flight", tr.getWorldPosition())
      }
      this.ctx.moveSound("flight", tr.getWorldPosition())
    } else {
      // The lens drops back into its bag; the body sinks into the real camera and melts.
      const k = easeInOutCubic((t - RET_FLY1) / (RET_END - RET_FLY1 - 0.1))
      tr.setWorldPosition(vec3.lerp(this.pMeet, this.pStart, k))
      tr.setWorldRotation(this.rStart)
      tr.setWorldScale(vec3.one())
      const lt = t - RET_FLY1
      if (lt < 0.15) {
        this.setBarrel(0, 45 * easeInOutCubic(lt / 0.15))
      } else if (lt < 0.25) {
        this.setBarrel(3 * easeInOutCubic((lt - 0.15) / 0.1), 45)
      } else {
        const kk = easeInOutCubic((lt - 0.25) / 0.35)
        const btr = this.barrelSo.getTransform()
        const start = tr.getWorldTransform().multiplyPoint(new vec3(0, 0, 3))
        const bag = this.ctx.bag()
        const endPos = bag.sub(this.bagRot.multiplyVec3(new vec3(0, 0, LENS_CENTER_Z)))
        btr.setWorldPosition(vec3.lerp(start, endPos, kk))
        btr.setWorldRotation(quat.slerp(tr.getWorldRotation().multiply(quat.angleAxis(45 * DEG, vec3.forward())), this.bagRot, kk))
      }
      this.shellFill = 0
      this.shellRim = 0.9
      this.globalFade = 1 - clamp01((t - (RET_END - 0.4)) / 0.35)
    }
    if (t >= RET_END) {
      this.ctx.log("hero:home")
      this.clear()
    }
  }

  private retFlags = {click: false, flight: false}

  private fadeLightPath(dt: number): void {
    void dt
    if (this.subject) this.fadeSubject(this.lightFade())
    if (this.rayMat) setFade(this.rayMat, RAY_STEADY * this.lightFade())
    if (this.rayPulseMat) setFade(this.rayPulseMat, this.lightFade())
    if (this.rayFaintMat) setFade(this.rayFaintMat, 0.3 * this.lightFade())
    if (this.bubble) {
      const k = this.lightFade()
      this.bubbleOpen = Math.min(this.bubbleOpen, k)
      this.bubble.getTransform().setWorldScale(vec3.one().uniformScale(Math.max(1e-4, k)))
      if (this.bubbleLeader) this.bubbleLeader.so.enabled = k > 0.05
    }
    this.sensorImage.update(0.5, 0, 0)
    this.sensorGlow.update(0.5, 0, 0)
  }

  /** Remove the subject, rays and bubble (and the prints, unless `keepPrints`). */
  private destroyLightPath(keepPrints: boolean = false): void {
    if (this.subject) this.subject.destroy()
    if (this.raysSo) this.raysSo.destroy()
    if (this.bubble) this.bubble.destroy()
    if (this.bubbleLeader) this.bubbleLeader.so.destroy()
    this.subject = null
    this.raysSo = null
    this.beams = []
    this.resetCandle()
    this.bubble = null
    this.bubbleLeader = null
    this.bubbleOpen = 0
    this.bubbleImage = null
    this.bubbleFlash = null
    this.bubbleSharp = null
    if (keepPrints) return
    this.buryPrints()
    this.print = null
    this.oldPrints = []
    this.printMats = []
    this.printTag = null
    this.printPicMat = null
    this.printBlankMat = null
  }

  /**
   * Remove the prints at once without destroying them under the hand's cursor: the print floats
   * right in front of the user, and SIK's cursor still reads the Interactable it targeted this
   * frame. They leave the stage disabled (no longer targetable) and are destroyed two frames later.
   */
  private buryPrints(): void {
    const all = this.oldPrints.map((p) => p.so)
    if (this.print) all.push(this.print)
    for (const so of all) {
      so.name = "HeroPrintGone"
      so.setParent(this.ctx.parent)
      so.enabled = false
      this.grave.push({so, frames: 2})
    }
    this.print = null
    this.oldPrints = []
    this.printMats = []
    this.printTag = null
    this.printPicMat = null
    this.printBlankMat = null
  }

  private updateGrave(): void {
    if (!this.grave.length) return
    this.grave = this.grave.filter((g) => {
      if (--g.frames > 0) return true
      g.so.destroy()
      return false
    })
  }

  /** Forget the candle's and the pulses' objects (destroyed with the subject and the rays). */
  private resetCandle(): void {
    this.waxLook = null
    this.flameSo = null
    this.flickerSo = null
    this.coreSo = null
    this.haloSo = null
    this.flameMat = null
    this.haloMat = null
    this.candleTip = null
    this.candleBase = null
    this.flameA = 0
    this.rayPulses = []
    this.rayPulseMat = null
    this.rayPulseCount = 0
    this.rayStarts = []
  }

  // =====================================================================================
  // Shared per-frame
  // =====================================================================================

  /** Shell look: fill (lifted textures) 0..1 and fresnel rim, faded to an outline where parts lift away. */
  private updateShell(): void {
    const g = this.globalFade
    const set = (m: Material, fill: number) => {
      const f = this.shellFill * fill * g
      m.mainPass.baseColor = new vec4(f, f, f, 1)
      m.mainPass.emissiveIntensity = 0.62 * f
      // A fading shell keeps a thin outline, front faces only (additive two-sided rims stack up
      // into a white block), and turns see-through so the parts inside show.
      const ghost = fill < 0.99
      m.mainPass.rimIntensity = this.shellRim * g * (ghost ? 0.3 + 0.7 * fill : 1)
      m.mainPass.twoSided = !ghost
      m.mainPass.depthWrite = this.shellFill * fill > 0.95
    }
    set(this.bodyMat, this.bodyFill)
    set(this.barrelMat, this.barrelFill)
    if (g < 1) for (const p of this.parts) if (p.looks.length && p.so.enabled) this.fadeLooks(p, 0)
  }

  private placeRail(): void {
    if (this.state !== "landed" && this.state !== "light" && !(this.state === "returning" && this.ctx.rail.isVisible())) return
    this.ctx.rail.place(this.railAnchor(), this.stageCenter(), RAIL_LEADER_STOP)
    this.ctx.rail.syncTicks(this.parts.map((p) => ({at: p.a + 0.02 * p.w, freed: p.freed})))
    this.ctx.rail.setFocusReadout("L " + this.L.toFixed(1) + " cm")
    this.ctx.rail.setPhotoDisabled(this.shotT >= 0)
    this.updateDistanceReadout()
  }

  /** While the candle is dragged: its distance, in secondary text just above the flame. */
  private updateDistanceReadout(): void {
    const labels = this.ctx.labels
    if (!this.subjectDrag || !this.subject) {
      if (labels.isShown(DISTANCE_LABEL)) labels.hide(DISTANCE_LABEL)
      return
    }
    const text = "d " + Math.round(this.d_o) + " cm"
    const at = this.subject.getTransform().getWorldTransform().multiplyPoint(new vec3(0, WICK_TOP, 0)).add(new vec3(0, DISTANCE_LABEL_LIFT, 0))
    if (!labels.isShown(DISTANCE_LABEL)) labels.show(DISTANCE_LABEL, text, at)
    else {
      labels.setText(DISTANCE_LABEL, text)
      labels.move(DISTANCE_LABEL, at)
    }
  }

  /** The rail's anchor: beside the replica on the user's side, in front of it and right of the body. */
  private railAnchor(): vec3 {
    const c = this.stageCenter()
    const head = this.ctx.camPos()
    const toUser = flatDir(head.sub(c))
    const right = toUser.uniformScale(-1).cross(vec3.up()).normalize()
    return c.add(toUser.uniformScale(34)).add(right.uniformScale(42)).add(new vec3(0, -8, 0))
  }

  /** Where the copy's body sits when it lies exactly on the real camera (scale 1). */
  realPose(): {position: vec3; rotation: quat} {
    const rotation = quat.lookAt(flatDir(this.ctx.realFacing), vec3.up())
    return {position: this.ctx.realBounds().center.sub(rotation.multiplyVec3(BODY_CENTER)), rotation}
  }

  /** World centre of the assembled body (where the thread and trail attach). */
  private replicaCenter(): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(BODY_CENTER)
  }

  private partWorld(p: Part): vec3 {
    return p.so.getTransform().getWorldPosition()
  }

  private restWorld(p: Part): vec3 {
    return this.replica.getTransform().getWorldTransform().multiplyPoint(p.rest)
  }

  /** Lowest point of the replica's hull (body box corners and lens rim), world Y, in any pose. */
  private lowestWorldY(): number {
    return hullLowestY(this.replica.getTransform().getWorldTransform())
  }

  /** Where the body's centre is when it sits on the table here: the rail and captions stay put while it hovers or bobs. */
  private stageCenter(): vec3 {
    if (this.state === "launch" || this.pose === "fly" || !this.surf) return this.replicaCenter()
    return this.pivotFor(this.foot, this.yaw, this.restGap).add(this.rot().multiplyVec3(BODY_CENTER.uniformScale(SCALE)))
  }

  private threadConnected(): boolean {
    if (!this.thread || this.state === "none" || this.threadPts.length < 2) return false
    const a = this.threadPts[0]
    const b = this.threadPts[this.threadPts.length - 1]
    return a.distance(this.realCenter) < 2 && b.distance(this.replicaCenter()) < 26
  }
}
