/**
 * Cutaway visual direction in code (see devpost/visual-direction.md).
 * - Light is the ink: everything is drawn additively; large surfaces stay at 15% or less.
 * - Color means energy: amber = motion / sound, cyan = electricity / signal, warm white = light.
 * - UI is white: 85% for text, 25–35% for strokes.
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

export const UI_WHITE = new vec4(1, 1, 1, 1)
export const TEXT_ALPHA = 0.85
export const STROKE_ALPHA = 0.3
export const FILL_ALPHA = 0.06

/** Additive "ink": color scaled by k (additive blending ignores alpha, so scale rgb too). */
export function ink(c: vec4, k: number): vec4 {
  return new vec4(c.x * k, c.y * k, c.z * k, c.w * k)
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
export function setTextAlpha(t: Text, a: number): void {
  t.textFill.color = new vec4(1, 1, 1, TEXT_ALPHA * Math.max(0, Math.min(1, a)))
}

// ---- Motion ----
export const ENTER_S = 0.3
export const EXIT_S = 0.22
export const STAGGER_S = 0.07

/** The one sound-wave shape shown at every stage: groove → signal → air. Period 2π, range ≈ ±1. */
export function wave(x: number): number {
  return (Math.sin(x) + 0.45 * Math.sin(2 * x + 0.9)) / 1.3
}
