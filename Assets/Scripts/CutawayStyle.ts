/**
 * Cutaway visual direction in code (see devpost/visual-direction.md).
 * - Light is the ink: everything is drawn additively; large surfaces stay at 15% or less.
 * - Color means energy: amber = motion / sound, cyan = electricity / signal, warm white = light.
 * - UI is ink, a warm white. This file is the single source of every UI colour, alpha and size.
 */

function hex(h: number, a: number = 1): vec4 {
  return new vec4(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255, a)
}

/** Energy colors. Nothing else uses these. */
export const ENERGY = {
  /** Motion, vibration and sound (mechanical waves). */
  motion: hex(0xffb347),
  /** Electricity and signals. */
  signal: hex(0x5ce1ff),
  /** Light. */
  light: hex(0xfff1d6)
}

/** Text and strokes: a warm white that matches the Evening Room and the energy palette. */
export const INK = hex(0xfff4e6)
/** Nothing: where a gradient of light runs out. */
export const NO_LIGHT = new vec4(0, 0, 0, 0)

/** Ink alphas. */
export const ALPHA = {
  text: 0.92,
  /** Slider labels, units and callouts. */
  secondary: 0.55,
  hairline: 0.22,
  disabled: 0.35
}

/** Frosted glass on an additive display: never a dark panel. */
export const GLASS = {
  fill: 0.07,
  rim: 0.3,
  /** Along the top inner edge. */
  highlight: 0.45,
  /** A primary pill's soft warm glow, at the rim; it falls away over glowSpread. */
  glow: 0.14,
  glowSpread: 1.2
}

/** Spacing unit at the 110 cm design distance: every rail gap and padding is a whole multiple. */
export const SPACE = 1.2
/** One display pixel at the 110 cm design distance (cm). */
export const PX = 0.045
export const STROKE = {
  rim: 1.5 * PX,
  highlight: PX,
  hairline: 2 * PX
}

/** The rail's grid and instruments (design cm). Every gap and padding is a whole number of SPACE. */
export const RAIL = {
  column: 14 * SPACE,
  padding: 2 * SPACE,
  gap: SPACE,
  sliderRow: 4 * SPACE,
  /** Two lines of caption. */
  captionSlot: 4 * SPACE,
  corner: 2 * SPACE,
  /** Where the plate's bottom edge sits below the rail's own origin. */
  bottom: -7,
  pillHeight: 3.2,
  knobRadius: 0.8,
  knobHit: 3.2,
  knobHaloSpread: 1,
  knobHaloLevel: 0.5,
  tickHeight: 0.7,
  fillWidth: 1.5 * STROKE.hairline
}

/** A computed colour (such as a colour temperature) as an opaque colour. */
export function opaque(c: vec3): vec4 {
  return new vec4(c.x, c.y, c.z, 1)
}

/** Four numbers a shader takes as one parameter. */
export function packed(a: number, b: number, c: number, d: number): vec4 {
  return new vec4(a, b, c, d)
}

/** A vertex that takes all its colour from its material (see setTint). */
export const VERTEX_WHITE = new vec4(1, 1, 1, 1)

/** Hover on every pill and slider knob: rim and text to 100%, scale 1.04, over 120 ms. */
export const HOVER = {scale: 1.04, stiffness: 2500}
/** Press on every pill and slider knob: 0.97, and one thin ring expands and fades. */
export const PRESS = {scale: 0.97, ringSeconds: 0.25, ringGrow: SPACE, ringLevel: 0.7}

function hex2(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)))
  return (n < 16 ? "0" : "") + n.toString(16).toUpperCase()
}

/** "#RRGGBB" for a colour (Text rich-text colour tags). */
export function hexOf(c: vec4): string {
  return "#" + hex2(c.x) + hex2(c.y) + hex2(c.z)
}

/**
 * A caption whose one key word (marked *like this*) takes its energy colour. Text renders it with
 * enableRichText (`<color=#RRGGBB>word</color>`); every other word stays ink.
 */
export function keyWord(text: string, color: vec4): string {
  return text.replace(/\*([^*]+)\*/, (_m: string, w: string) => "<color=" + hexOf(color) + ">" + w + "</color>")
}

/**
 * A caption's words with their colours: `<color=#RRGGBB>` runs (see keyWord) or ink. Punctuation
 * touching a word stays with that word, so nothing has to be kerned by hand.
 */
export function captionWords(text: string): {word: string; color: vec4}[] {
  const out: {word: string; color: vec4}[] = []
  let spaced = true
  const add = (run: string, color: vec4) => {
    for (const piece of run.split(/(\s+)/)) {
      if (piece.length === 0) continue
      if (/^\s+$/.test(piece)) spaced = true
      else {
        if (spaced || out.length === 0) out.push({word: piece, color})
        else out[out.length - 1].word += piece
        spaced = false
      }
    }
  }
  const tag = /<color=#([0-9A-Fa-f]{6})>(.*?)<\/color>/g
  let last = 0
  let m = tag.exec(text)
  while (m) {
    add(text.substring(last, m.index), INK)
    add(m[2], hex(parseInt(m[1], 16)))
    last = m.index + m[0].length
    m = tag.exec(text)
  }
  add(text.substring(last), INK)
  return out
}

/** The same colour at another alpha. */
export function withAlpha(c: vec4, a: number): vec4 {
  return new vec4(c.x, c.y, c.z, a)
}

/** Additive "ink": color scaled by k (additive blending ignores alpha, so scale rgb too). */
export function ink(c: vec4, k: number): vec4 {
  return new vec4(c.x * k, c.y * k, c.z * k, c.w * k)
}

/**
 * Vertex colour for light that lands at `level`. The glow material adds source colour × source
 * alpha, so a vertex lands at (rgb × a): ink(c, k) lands at c × k². lit() takes the root, so the
 * tokens above land as written. setLevel (CutawayGeometry) does the same for a material.
 */
export function lit(c: vec4, level: number): vec4 {
  return ink(c, Math.sqrt(Math.max(0, level)))
}

/** The halo on a real object: landed light levels and timing (polish-pass.md §2). */
export const HALO = {
  /** Ink at its brightest, where the surface turns away from the eye. */
  rim: 0.35,
  /** While the object's stage 1 explanation plays. */
  running: 0.15,
  /** While its copy is on the table: the origin the thread arrives into. */
  origin: 0.1,
  /** The ring on the surface under it, when the rim is at full level. */
  contact: 0.12,
  fadeS: 0.25,
  /** One halo clears this fast when another is waiting. */
  switchS: 0.12,
  glintS: 0.5,
  glintLevel: 0.8,
  /** Half the glint's height (cm). */
  glintWidth: 1.2,
  /** Higher keeps the light closer to the silhouette: flat faces seen at a grazing angle stay dark. */
  power: 7,
  /** The lamp is all curves, so its rim can run wider and still never wash a face. */
  powerRound: 3.5,
  /** How far normals lean out from the object's centre (none: a true fresnel on the real normals). */
  lean: 0,
  /** Above the surface, so the ring never fights it (cm). */
  ringLift: 0.3
}

// ---- Typography: one typeface (UI Kit default), two sizes only. ----
export type TextRole = "ui" | "note"
/** ui = chips, questions and pills. note = captions and callout labels. Sizes at the 110 cm design distance. */
export const TYPE: Record<TextRole, {size: number; weight: number}> = {
  ui: {size: 39, weight: 500},
  note: {size: 35, weight: 500}
}
export function applyType(t: Text, role: TextRole): void {
  t.size = TYPE[role].size
  ;(t as Text & {weight?: number}).weight = TYPE[role].weight
}
/** Ink text at `base` alpha (text 92% unless told otherwise), scaled by the 0..1 amount `a`. */
export function setTextAlpha(t: Text, a: number, base: number = ALPHA.text): void {
  t.textFill.color = new vec4(INK.x, INK.y, INK.z, base * Math.max(0, Math.min(1, a)))
}

// ---- Motion ----
/** Word-by-word captions: a 40 ms stagger, each word fading in and rising 2 mm; out in 220 ms. */
export const CAPTION = {
  staggerS: 0.04,
  wordS: 0.18,
  rise: 0.2,
  fadeS: 0.22,
  /** Line pitch: two lines fit the rail's caption slot with a gap under them. */
  line: 1.25 * SPACE,
  /** A word's text box (design cm): wide enough never to wrap on its own. */
  wordBox: 30
}
export const ENTER_S = 0.3
export const EXIT_S = 0.22
export const STAGGER_S = 0.07

/** The one sound-wave shape shown at every stage: groove → signal → air. Period 2π, range ≈ ±1. */
export function wave(x: number): number {
  return (Math.sin(x) + 0.45 * Math.sin(2 * x + 0.9)) / 1.3
}
