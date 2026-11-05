import {ALPHA, applyType, CAPTION, captionWords, withAlpha} from "./CutawayStyle"
import {clamp01, easeOutCubic, faceToward} from "./CutawayTween"

/** Where a caption's first line starts: its top-left (on a rail) or top-centre (hanging at a point). */
export interface CaptionPlace {
  position: vec3
  rotation: quat
  /** World cm per design cm. */
  scale: number
}

/** Something a caption can live on (the rail's top slot): it follows without fading or re-revealing. */
export interface CaptionHost {
  captionPlace(): CaptionPlace
  /** Design cm the words wrap to. */
  readonly captionWidth: number
}

interface PlacedWord {
  word: string
  color: vec4
  x: number
  line: number
}

interface Layout {
  plain: string
  words: PlacedWord[]
  lines: number
  /** Bounds of the words in the caption's own space (design cm); top is 0. */
  left: number
  right: number
  at: vec3 | null
  host: CaptionHost | null
  /** The opening's line: it is not one of the story's captions and gives way to any that is. */
  ambient: boolean
}

interface WordSlot {
  so: SceneObject
  tr: Transform
  text: Text
}

export interface CaptionDeps {
  /** Width (design cm) of a word set in the caption's type. */
  measure: (word: string) => number
  scaleAt: (p: vec3) => number
  camera: () => Transform | null
}

export interface CaptionInfo {
  plain: string
  words: {word: string; alpha: number; color: vec4; x: number; y: number}[]
  phase: "idle" | "in" | "out" | "hold"
  ambient: boolean
}

/** A caption this far from where it is showing is a new one, not the same one nudged (cm). */
const SAME_PLACE = 2

/**
 * The one caption: each word is its own Text so it can fade in and rise a little after the one
 * before it, and a key word keeps its energy colour without rich-text tags. A new caption waits for
 * the old one to fade out. What the caller last asked for is the logical caption straight away
 * (captionText, the layout quad); the screen catches up.
 */
export class WordCaption {
  private root: SceneObject
  private slots: WordSlot[] = []
  /** The caption last asked for (null: none). */
  private wanted: Layout | null = null
  /** The caption on screen. */
  private active: Layout | null = null
  private phase: "idle" | "in" | "hold" | "out" = "idle"
  private revealT = 0
  private fadeT = 0

  constructor(
    parent: SceneObject,
    private deps: CaptionDeps
  ) {
    this.root = global.scene.createSceneObject("Caption")
    this.root.setParent(parent)
    this.root.enabled = false
  }

  /** `at` = the top centre to hang from; with a host the words sit on it and `at` isn't used. */
  set(text: string | null, at: vec3 | null, width: number, host: CaptionHost | null, ambient: boolean = false): void {
    if (!text || (!at && !host)) {
      this.wanted = null
      this.kick()
      return
    }
    const plain = text.replace(/<[^>]*>/g, "")
    const w = this.wanted
    if (w && w.plain === plain && w.host === host && w.ambient === ambient) {
      if (host || ambient || !at || !w.at || at.distance(w.at) <= SAME_PLACE) {
        w.at = at
        return
      }
    }
    this.wanted = this.layout(text, plain, at, host ? host.captionWidth : width, host, ambient)
    this.kick()
  }

  /** The opening's line goes, unless a real caption has already replaced it. */
  clearAmbient(): void {
    if (this.wanted && this.wanted.ambient) this.set(null, null, 0, null)
  }

  hide(instant: boolean): void {
    this.wanted = null
    if (instant) {
      this.active = null
      this.phase = "idle"
      this.fadeT = 0
      this.root.enabled = false
    } else this.kick()
  }

  /** The story's caption (not the opening's line), as plain words. */
  text(): string | null {
    return this.wanted && !this.wanted.ambient ? this.wanted.plain : null
  }

  /** The story caption's words as a world quad (4 corners), or null. */
  quad(): vec3[] | null {
    const l = this.wanted
    if (!l || l.ambient) return null
    const p = this.placeOf(l)
    const y1 = -l.lines * CAPTION.line
    return [new vec3(l.left, y1, 0), new vec3(l.right, y1, 0), new vec3(l.right, 0, 0), new vec3(l.left, 0, 0)].map((q) => p.position.add(p.rotation.multiplyVec3(q.uniformScale(p.scale))))
  }

  /** The screen as it stands, for tests. */
  info(): CaptionInfo | null {
    const l = this.active
    if (!l) return null
    return {
      plain: l.plain,
      phase: this.phase,
      ambient: l.ambient,
      words: l.words.map((w, i) => ({word: w.word, alpha: this.wordAlpha(i), color: w.color, x: w.x, y: this.slots[i].tr.getLocalPosition().y}))
    }
  }

  update(dt: number): void {
    if (this.phase === "idle") return
    if (this.phase === "out") {
      this.fadeT += dt
      if (this.fadeT >= CAPTION.fadeS) this.swap()
      else this.draw()
    } else if (this.phase === "in") {
      this.revealT += dt
      this.draw()
      if (this.revealT >= (this.active.words.length - 1) * CAPTION.staggerS + CAPTION.wordS) this.phase = "hold"
    }
  }

  /** After everything has moved this frame: stay on the host, or face the viewer at the point. */
  follow(): void {
    if (!this.active) return
    const p = this.placeOf(this.active)
    const tr = this.root.getTransform()
    tr.setWorldPosition(p.position)
    tr.setWorldRotation(p.rotation)
    tr.setLocalScale(vec3.one().uniformScale(p.scale))
  }

  private kick(): void {
    if (this.wanted === this.active) {
      // Asked for again while it was fading: nothing to wait for but the fade.
      return
    }
    if (this.phase === "idle") this.swap()
    else if (this.phase !== "out") {
      this.phase = "out"
      this.fadeT = 0
    }
  }

  /** The old caption has gone: the wanted one starts. */
  private swap(): void {
    this.active = this.wanted
    this.fadeT = 0
    this.revealT = 0
    if (!this.active) {
      this.phase = "idle"
      this.root.enabled = false
      return
    }
    this.phase = "in"
    this.root.enabled = true
    const words = this.active.words
    for (let i = 0; i < Math.max(words.length, this.slots.length); i++) {
      const s = this.slot(i, i < words.length)
      if (!s) continue
      s.so.enabled = i < words.length
      if (i < words.length) s.text.text = words[i].word
    }
    this.follow()
    this.draw()
  }

  private wordAlpha(i: number): number {
    const k = clamp01((this.revealT - i * CAPTION.staggerS) / CAPTION.wordS)
    const out = this.phase === "out" ? 1 - clamp01(this.fadeT / CAPTION.fadeS) : 1
    return k * out * ALPHA.text
  }

  private draw(): void {
    const words = this.active.words
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      const s = this.slots[i]
      const k = clamp01((this.revealT - i * CAPTION.staggerS) / CAPTION.wordS)
      s.text.textFill.color = withAlpha(w.color, this.wordAlpha(i))
      s.tr.setLocalPosition(new vec3(w.x, -w.line * CAPTION.line - CAPTION.rise * (1 - easeOutCubic(k)), 0))
    }
  }

  private slot(i: number, make: boolean): WordSlot | null {
    if (i < this.slots.length) return this.slots[i]
    if (!make) return null
    const so = global.scene.createSceneObject("CaptionWord" + i)
    so.setParent(this.root)
    const text = so.createComponent("Component.Text") as Text
    text.depthTest = true
    applyType(text, "note")
    text.horizontalAlignment = HorizontalAlignment.Left
    text.verticalAlignment = VerticalAlignment.Top
    text.horizontalOverflow = HorizontalOverflow.Overflow
    text.verticalOverflow = VerticalOverflow.Overflow
    text.layoutRect = Rect.create(0, CAPTION.wordBox, -CAPTION.line, 0)
    const s = {so, tr: so.getTransform(), text}
    this.slots.push(s)
    return s
  }

  private placeOf(l: Layout): CaptionPlace {
    if (l.host) return l.host.captionPlace()
    const cam = this.deps.camera()
    const at = l.at as vec3
    const rotation = cam ? faceToward(cam.getWorldPosition().sub(at), cam.up) : quat.quatIdentity()
    return {position: at, rotation, scale: this.deps.scaleAt(at)}
  }

  /**
   * Break the words to the width: left-aligned on a host, centred under a point. Two lines are
   * balanced, so no word is left alone on the second.
   */
  private layout(text: string, plain: string, at: vec3 | null, width: number, host: CaptionHost | null, ambient: boolean): Layout {
    const m = this.deps.measure
    const space = m(" ")
    const words = captionWords(text)
    const sizes = words.map((w) => m(w.word))
    const span = (from: number, to: number) => {
      let w = 0
      for (let i = from; i < to; i++) w += sizes[i] + (i > from ? space : 0)
      return w
    }
    // Where each line starts: greedy, then for two lines the fitting break with the narrowest widest line.
    const starts = [0]
    for (let i = 1; i < words.length; i++) {
      if (span(starts[starts.length - 1], i + 1) > width) starts.push(i)
    }
    if (starts.length === 2) {
      let best = Math.max(span(0, starts[1]), span(starts[1], words.length))
      for (let i = 1; i < words.length; i++) {
        const widest = Math.max(span(0, i), span(i, words.length))
        if (widest < best) {
          best = widest
          starts[1] = i
        }
      }
    }
    const placed: PlacedWord[] = []
    const lineWidths: number[] = []
    starts.forEach((from, line) => {
      const to = line + 1 < starts.length ? starts[line + 1] : words.length
      lineWidths.push(span(from, to))
      let x = host ? 0 : -lineWidths[line] / 2
      for (let i = from; i < to; i++) {
        placed.push({word: words[i].word, color: words[i].color, x, line})
        x += sizes[i] + space
      }
    })
    const widest = Math.max(...lineWidths)
    return {plain, words: placed, lines: starts.length, left: host ? 0 : -widest / 2, right: host ? widest : widest / 2, at, host, ambient}
  }
}
