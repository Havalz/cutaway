/**
 * The one UI language (polish-pass.md): a glass capsule drawn with light, the pill built on it, and
 * the press ring. Every colour, alpha and size comes from CutawayStyle. Only transforms and opacity
 * animate: a capsule changes width by moving its end caps and scaling its straight middle.
 */
import {Button} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import {MeshKit, setLevel, spawnMesh} from "./CutawayGeometry"
import {ALPHA, applyType, GLASS, HOVER, INK, lit, NO_LIGHT, PRESS, setTextAlpha, STROKE, TextRole} from "./CutawayStyle"
import {clamp01, easeOutCubic, Pop, Spring} from "./CutawayTween"

/**
 * primary: filled glass with a soft warm glow (the main action of a step).
 * glass: filled glass (chips, questions, the rail's plate).
 * outline: the rim only (secondary actions).
 */
export type PillKind = "primary" | "glass" | "outline"

const NZ = new vec3(0, 0, 1)

/** Meshes are shared between capsules of the same kind and height. */
const meshCache: {[key: string]: RenderMesh} = {}
function cachedMesh(key: string, make: () => MeshKit): RenderMesh {
  if (!meshCache[key]) meshCache[key] = make().build()
  return meshCache[key]
}

/** An arc whose colour runs from c0 at a0 to c1 at a1 (the highlight trailing off round a cap). */
function gradientArc(k: MeshKit, r: number, width: number, a0: number, a1: number, c0: vec4, c1: vec4, seg: number): void {
  let base = -1
  for (let s = 0; s <= seg; s++) {
    const t = s / seg
    const a = a0 + (a1 - a0) * t
    const c = vec4.lerp(c0, c1, t)
    const i = k.vert(new vec3(Math.cos(a) * (r - width / 2), Math.sin(a) * (r - width / 2), 0), NZ, c)
    if (base < 0) base = i
    k.vert(new vec3(Math.cos(a) * (r + width / 2), Math.sin(a) * (r + width / 2), 0), NZ, c)
  }
  for (let s = 0; s < seg; s++) {
    const i = base + s * 2
    k.tri(i, i + 1, i + 3)
    k.tri(i, i + 3, i + 2)
  }
}

/** Three meshes, two caps and a middle, that together make one capsule of any width. */
class CapsuleShape {
  readonly root: SceneObject
  private left: SceneObject
  private right: SceneObject
  private mid: SceneObject

  constructor(parent: SceneObject, name: string, material: Material, shared: Material, private height: number, key: string, paintCap: (k: MeshKit, sign: number) => void, paintMid: (k: MeshKit) => void) {
    this.root = global.scene.createSceneObject(name)
    this.root.setParent(parent)
    const cap = (sign: number) =>
      cachedMesh(key + (sign < 0 ? "L" : "R"), () => {
        const k = new MeshKit()
        paintCap(k, sign)
        return k
      })
    const midMesh = cachedMesh(key + "M", () => {
      const k = new MeshKit()
      paintMid(k)
      return k
    })
    this.left = spawnMesh(this.root, name + "CapL", cap(-1), material, undefined, shared).so
    this.right = spawnMesh(this.root, name + "CapR", cap(1), material, undefined, shared).so
    this.mid = spawnMesh(this.root, name + "Mid", midMesh, material, undefined, shared).so
  }

  /** Outer width and height (design cm). */
  setShape(w: number, h: number): void {
    const s = Math.max(1e-4, h / this.height)
    const straight = Math.max(0, w - h) / s
    this.root.getTransform().setLocalScale(new vec3(s, s, 1))
    this.left.getTransform().setLocalPosition(new vec3(-straight / 2, 0, 0))
    this.right.getTransform().setLocalPosition(new vec3(straight / 2, 0, 0))
    this.mid.getTransform().setLocalScale(new vec3(Math.max(1e-4, straight), 1, 1))
  }
}

/**
 * A capsule of glass: a 7% fill, a 1.5 px rim at 30% and a 1 px highlight at 45% along the top
 * inner edge. Rim and fill have their own materials, so hovering takes the rim to 100% while the
 * fill stays quiet. The rim's vertices sit below the highlight's, and its material runs at the
 * highlight's level: at rest they land at 30% and 45%, and 1.5 × brings the rim to exactly 100%.
 */
export class GlassCapsule {
  readonly root: SceneObject
  private rim: CapsuleShape
  private fill: CapsuleShape | null = null
  private rimMat: Material
  private fillMat: Material | null = null
  private fillLevel = 0
  private opacity = 1
  private hover = new Spring(HOVER.stiffness, 1, 0)

  constructor(parent: SceneObject, name: string, material: Material, private height: number, kind: PillKind = "glass") {
    this.root = global.scene.createSceneObject(name)
    this.root.setParent(parent)
    this.root.getTransform().setLocalPosition(new vec3(0, 0, 0.02))
    const r = height / 2
    const S = STROKE.rim
    const H = STROKE.highlight
    const rimInk = lit(INK, GLASS.rim / GLASS.highlight)
    const top = lit(INK, 1)
    const withHighlight = kind !== "outline"
    this.rimMat = material.clone()
    const rimKey = "rim" + (withHighlight ? "H" : "") + height
    this.rim = new CapsuleShape(
      this.root,
      name + "Rim",
      material,
      this.rimMat,
      height,
      rimKey,
      (k, sign) => {
        const a0 = sign < 0 ? Math.PI / 2 : -Math.PI / 2
        k.addArcXY(0, 0, r - S / 2, S, a0, a0 + Math.PI, rimInk, 20)
        if (withHighlight) gradientArc(k, r - S - H / 2, H, Math.PI / 2, Math.PI / 2 - sign * 1.1, top, NO_LIGHT, 12)
      },
      (k) => {
        k.addRectXY(-0.5, r - S, 0.5, r, rimInk)
        k.addRectXY(-0.5, -r, 0.5, -r + S, rimInk)
        if (withHighlight) k.addRectXY(-0.5, r - S - H, 0.5, r - S, top)
      }
    )
    if (kind !== "outline") {
      const glow = kind === "primary"
      this.fillLevel = glow ? GLASS.glow : GLASS.fill
      const fillInk = lit(INK, GLASS.fill / this.fillLevel)
      const G = GLASS.glowSpread
      this.fillMat = material.clone()
      this.fill = new CapsuleShape(
        this.root,
        name + "Fill",
        material,
        this.fillMat,
        height,
        "fill" + kind + height,
        (k, sign) => {
          const a0 = sign < 0 ? Math.PI / 2 : -Math.PI / 2
          k.addFanXY(0, 0, r - S, a0, a0 + Math.PI, fillInk, fillInk, 20)
          if (glow) softHalf(k, r, r + G, a0, a0 + Math.PI, top, 20)
        },
        (k) => {
          k.addRectXY(-0.5, -r + S, 0.5, r - S, fillInk)
          if (glow) {
            k.addRectXY(-0.5, r, 0.5, r + G, top, top, NO_LIGHT, NO_LIGHT)
            k.addRectXY(-0.5, -r - G, 0.5, -r, NO_LIGHT, NO_LIGHT, top, top)
          }
        }
      )
    }
  }

  setShape(w: number, h: number): void {
    this.rim.setShape(w, h)
    if (this.fill) this.fill.setShape(w, h)
  }

  setOpacity(a: number): void {
    this.opacity = a
  }

  /** Aimed at: the rim brightens to 100% (over 120 ms). */
  setHover(h: boolean): void {
    this.hover.target = h ? 1 : 0
  }

  /** 0..1: how far the hover state has come. */
  get hoverAmount(): number {
    return clamp01(this.hover.value)
  }

  update(dt: number): void {
    const h = this.hover.update(dt)
    const rest = GLASS.highlight
    const aimed = GLASS.highlight / GLASS.rim
    setLevel(this.rimMat, this.opacity * (rest + (aimed - rest) * clamp01(h)))
    if (this.fillMat) setLevel(this.fillMat, this.opacity * this.fillLevel)
  }
}

/** A half annulus from c0 at r0 to nothing at r1: a primary pill's soft glow round each cap. */
function softHalf(k: MeshKit, r0: number, r1: number, a0: number, a1: number, c0: vec4, seg: number): void {
  let base = -1
  for (let s = 0; s <= seg; s++) {
    const a = a0 + ((a1 - a0) * s) / seg
    const c = Math.cos(a)
    const d = Math.sin(a)
    const i = k.vert(new vec3(c * r0, d * r0, 0), NZ, c0)
    if (base < 0) base = i
    k.vert(new vec3(c * r1, d * r1, 0), NZ, NO_LIGHT)
  }
  for (let s = 0; s < seg; s++) {
    const i = base + s * 2
    k.tri(i, i + 1, i + 3)
    k.tri(i, i + 3, i + 2)
  }
}

/** How many press rings each control has played (LEAF checks). */
export const PRESS_RINGS: {[name: string]: number} = {}

/** One thin ring that expands from a control and fades (250 ms). Built on first use. */
export class PressRing {
  private holder: SceneObject | null = null
  private shape: CapsuleShape | null = null
  private mat: Material | null = null
  private t = -1

  constructor(private parent: SceneObject, private name: string, private material: Material | null, private w: number, private h: number) {}

  play(at: vec3, scale: vec3): void {
    PRESS_RINGS[this.name] = (PRESS_RINGS[this.name] ?? 0) + 1
    if (!this.material) return
    if (!this.holder) this.build()
    const tr = this.holder.getTransform()
    tr.setLocalPosition(new vec3(at.x, at.y, at.z + 0.01))
    tr.setLocalScale(scale)
    this.holder.enabled = true
    this.t = 0
    this.apply()
  }

  update(dt: number): void {
    if (this.t < 0) return
    this.t += dt
    if (this.t >= PRESS.ringSeconds) {
      this.t = -1
      this.holder.enabled = false
      return
    }
    this.apply()
  }

  private apply(): void {
    const k = easeOutCubic(this.t / PRESS.ringSeconds)
    const grow = PRESS.ringGrow * k
    this.shape.setShape(this.w + 2 * grow, this.h + 2 * grow)
    setLevel(this.mat, PRESS.ringLevel * (1 - k))
  }

  private build(): void {
    this.holder = global.scene.createSceneObject(this.name)
    this.holder.setParent(this.parent)
    this.mat = this.material.clone()
    const r = this.h / 2
    const S = STROKE.highlight
    const c = lit(INK, 1)
    this.shape = new CapsuleShape(
      this.holder,
      this.name + "Shape",
      this.material,
      this.mat,
      this.h,
      "ring" + this.h,
      (k, sign) => {
        const a0 = sign < 0 ? Math.PI / 2 : -Math.PI / 2
        k.addArcXY(0, 0, r - S / 2, S, a0, a0 + Math.PI, c, 20)
      },
      (k) => {
        k.addRectXY(-0.5, r - S, 0.5, r, c)
        k.addRectXY(-0.5, -r, 0.5, -r + S, c)
      }
    )
  }
}

export interface PillOptions {
  parent: SceneObject
  /** The Button's SceneObject name (LEAF presses it by name). */
  name: string
  label: string
  width: number
  height: number
  material: Material | null
  kind: PillKind
  role?: TextRole
  /** Scale at 0 visibility (see Pop). */
  minScale?: number
  startShown?: boolean
  /** Names for the show / hide wrap and the capsule (default <name>Pop and <name>Glow). */
  popName?: string
  glassName?: string
}

/**
 * A pill: a UI Kit Button for the input, its own visual masked, drawn with glass and light.
 * States: hover brightens rim and text to 100% and scales to 1.04 (120 ms); press scales to 0.97
 * and expands one thin ring (250 ms) with the tick; disabled is 35% alpha.
 */
export class UiPill {
  readonly pop: Pop
  readonly wrap: SceneObject
  readonly so: SceneObject
  readonly btn: Button
  readonly glass: GlassCapsule | null = null
  readonly label: Text
  /** Fired on every pinch (world position of the pill), for the tick sound. */
  onPinch: ((p: vec3) => void) | null = null
  private ring: PressRing
  private masked = false
  private glassOpacity = 0
  private textOpacity = 0
  private dim = 1
  private dimTarget = 1

  constructor(o: PillOptions) {
    this.wrap = global.scene.createSceneObject(o.popName ?? o.name + "Pop")
    this.wrap.setParent(o.parent)
    this.so = global.scene.createSceneObject(o.name)
    this.so.setParent(this.wrap)
    this.btn = this.so.createComponent(Button.getTypeName()) as Button
    this.btn.setVariant({theme: "SnapOS2", shape: "Capsule", style: "Ghost"})
    this.btn.size = new vec3(o.width, o.height, 1)
    if (o.material) {
      this.glass = new GlassCapsule(this.so, o.glassName ?? o.name + "Glow", o.material, o.height, o.kind)
      this.glass.setShape(o.width, o.height)
    }
    this.label = this.buildLabel(o)
    this.ring = new PressRing(o.parent, o.name + "PressRing", o.material, o.width, o.height)
    this.pop = new Pop(this.wrap, vec3.one(), o.startShown ?? false, {
      minScale: o.minScale ?? 0,
      onAmount: (a) => {
        this.glassOpacity = a
        this.textOpacity = a
      }
    })
    this.btn.onTriggerDown.add(() => {
      this.pop.setPressed(true)
      const tr = this.wrap.getTransform()
      this.ring.play(tr.getLocalPosition(), tr.getLocalScale())
      if (this.onPinch) this.onPinch(this.so.getTransform().getWorldPosition())
    })
    this.btn.onTriggerUp.add(() => this.pop.setPressed(false))
    this.btn.onHoverEnter.add(() => this.setHover(true))
    this.btn.onHoverExit.add(() => {
      this.pop.setPressed(false)
      this.setHover(false)
    })
  }

  get isShown(): boolean {
    return this.pop.isShown
  }

  /** Disabled: 35% alpha. The look only: what a press does stays with the owner. */
  setDisabled(v: boolean): void {
    this.dimTarget = v ? ALPHA.disabled : 1
  }

  /** For a pill that shapes its own entrance (the chip): overrides the Pop's opacity this frame. */
  setOpacities(glass: number, text: number): void {
    this.glassOpacity = glass
    this.textOpacity = text
  }

  /** Pop, then look: most owners call this once a frame. */
  update(dt: number): void {
    this.pop.update(dt)
    this.updateLook(dt)
  }

  /** Masks the UI Kit visual, runs the ring and applies hover, opacity and disabled. */
  updateLook(dt: number): void {
    if (!this.masked) this.maskVisual()
    this.ring.update(dt)
    if (!this.so.isEnabledInHierarchy) return
    this.dim += (this.dimTarget - this.dim) * (1 - Math.exp(-dt / 0.05))
    const hover = this.glass ? this.glass.hoverAmount : 0
    if (this.glass) {
      this.glass.setOpacity(this.glassOpacity * this.dim)
      this.glass.update(dt)
    }
    setTextAlpha(this.label, this.textOpacity * this.dim, ALPHA.text + (1 - ALPHA.text) * hover)
  }

  private setHover(h: boolean): void {
    this.pop.setHovered(h)
    if (this.glass) this.glass.setHover(h)
  }

  private maskVisual(): void {
    const v = this.btn.visual
    if (!v || !v.renderMeshVisual) return
    v.renderMeshVisual.mainPass.colorMask = new vec4b(false, false, false, false)
    this.masked = true
  }

  private buildLabel(o: PillOptions): Text {
    const so = global.scene.createSceneObject("ButtonLabel")
    so.setParent(this.so)
    so.getTransform().setLocalPosition(new vec3(0, 0, 0.08))
    const t = so.createComponent("Component.Text") as Text
    t.text = o.label
    t.depthTest = true
    applyType(t, o.role ?? "ui")
    setTextAlpha(t, 0)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const hw = o.width / 2 - 0.3
    t.layoutRect = Rect.create(-hw, hw, -1.2, 1.2)
    return t
  }
}
