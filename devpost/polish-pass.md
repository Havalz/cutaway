---
status: approved
---

# Cutaway: polish pass ("finish")

All three hero stages work. This pass makes the whole Lens feel like one finished, elegant product:
- one visual language for the UI;
- a halo that shows which object you are looking at;
- an opening that invites you in, and a finale that ties the three objects together.

No new teaching content and no new hero mechanics. Everything here is taste, clarity and cohesion.

Rules that still apply:
- `visual-direction.md`: light is the ink, colour means energy, sentence case, one caption at a time.
- Specs is an additive display, so nothing relies on dark or black to be seen.
- All existing tests must keep passing. Hero behaviour must not change, only how it looks and feels.

## 1. One UI language (tokens first)

### Tokens
Extend `CutawayStyle.ts` into the single source of every UI colour, alpha and size. No UI file may hard-code a colour after this pass.

- **Ink:** text and strokes become a warm white, `#FFF4E6`, instead of pure white. This matches the Evening Room's warm interior and the energy palette.

  | Use | Alpha |
  | --- | --- |
  | Text | 92% |
  | Secondary text (slider labels, units) | 55% |
  | Hairlines | 22% |

- **Glass:** pills and the rail use a very light fill (ink at 7%), a 1.5 px rim (ink at 30%), and a brighter 1 px highlight along the top inner edge (ink at 45%). Together these read as frosted glass on an additive display. Never use dark panels.
- **Energy accents:** the existing amber, cyan and warm white. In the UI they appear **only** where a control acts on that energy (see Sliders). The rest of the UI stays ink.
- **Spacing:** a 1.2 cm base unit (at the 110 cm design distance). Every gap and padding in the rail is a whole multiple of it.

### Buttons (pills)
- **Hierarchy:**
  - The primary action of a step is a filled glass pill with a soft warm glow. Examples: "Bring it closer", "Take a photo", and the lamp switch hint.
  - Secondary actions are outline-only pills. Examples: "Put it back", "Reset", Stop.
- **States, on every pill and slider knob:**

  | State | What happens |
  | --- | --- |
  | Hover (SIK) | Rim and text brighten to 100%, scale 1.04 over 120 ms |
  | Press | One thin ring expands from the pill and fades (250 ms), with the existing tick sound |
  | Disabled | 35% alpha |

### Sliders: instruments, not lines
- **Track:** a 2 px hairline. The filled part glows in the colour of the energy the slider controls:

  | Slider | Fill |
  | --- | --- |
  | Loudness, Pitch | Amber |
  | Focus, Brightness | Warm white |
  | Take apart | Ink |
  | Warmth | A true colour-temperature gradient from 2700 K to 6500 K, computed with the same formula the lamp uses, so the track *is* the colour scale |

- **Knob:** a small glass disc with a soft halo in the fill colour.
- **Live value above the knob,** in real units and in secondary text. The numbers make it feel like a real instrument:

  | Slider | Value shown |
  | --- | --- |
  | Focus | `L 22.4 cm` |
  | Subject distance (while dragged) | `d 50 cm` |
  | Pitch | `440 Hz` |
  | Loudness | percent |
  | Brightness | percent |
  | Warmth | `3000 K` |

- **Take apart:** one small tick on the track per part. Each tick lights as its part frees itself.

### The rail
- **Layout:** one vertical column on the user's side of the copy, laid out on the spacing grid. A thin hairline leader joins the rail's top to the copy, so the controls clearly belong to it.
- **Order inside the rail:** caption, then sliders (each label left, value right), then the primary pill, then the secondary pill.
- **Placement:** the rail must stay fully inside the view from the default pose and from the capture poses. Fix the right-edge clipping seen in `lamp_on_full`.

### Captions
- Each caption reveals word by word: a 40 ms stagger, with each word fading in and rising 2 mm.
- The key word keeps its energy colour.
- A caption fades out over 220 ms before the next one appears.
- Still only one caption at a time.

### Chips and labels
- Chips and question pills use the glass style.
- Callout labels use secondary text, with an anchor dot in ink on the part.
- Only the labels in the active step are at full alpha.

## 2. Object halos: see which object you're looking at

Each object gets a halo that traces its **real silhouette**. The Phase A models already match the room objects within about 1%, so their shells can draw a precise outline over the real objects. On real Specs this would come from object segmentation. Here the scale-1 models stand in for it, the same way the markers stand in for recognition.

### Look
- **Rim:** a fresnel-only rim, with no fill, drawn with each object's scale-1 shell:
  - camera: body only, since the real lens sits in its bag;
  - record player: deck and dust cover;
  - lamp: whole lamp.

  Colour: ink, at 35% at its brightest.
- **Contact ring:** a soft ring of light on the surface under the object (the shelf, or the floor for the lamp), at 12%.
- **Glint:** when the halo appears, one thin bright line sweeps along the silhouette from bottom to top once (500 ms).

### Behaviour
- The halo fades in over 250 ms when an object's chip appears (gaze), and out over 250 ms when the chip shrinks.
- Only one halo shows at a time, and only the gazed object's halo meshes are enabled. The others are disabled entirely, to keep triangles down.
- **While an object's stage 1 explanation plays,** its halo dims to 15% so it doesn't compete.
- **While its copy is on the table,** the real object's halo stays at 10% as "the origin", with the thread arriving into it.
- **Explained objects** keep only their existing dot rings, with no permanent halo.

### Budget
Keep halo materials and meshes simple, and report the added triangles while a halo is visible.

## 3. Opening: "Look at something"
When the Lens starts:
1. One soft horizontal sweep of light crosses the room at eye level (1.2 s).
2. The three idle dots appear one at a time, 250 ms apart, each with a very soft tick from its position.
3. A single caption, low in view: "Look at something to see how it works." It fades after 5 s, or at the first chip.

This plays once per session, and again after Reset. It never blocks input: any pinch skips it.

## 4. Discovery trio
- Three small slots in a row, just above the Reset pill. Each is a hollow ring in ink.
- When an object's stage 1 explanation finishes, its slot fills with that object's main energy colour, with a small pop (scale 1.15 → 1, 200 ms):
  - record player: amber;
  - camera: warm white;
  - lamp: cyan.
- Reset empties all three.
- No numbers or text. It quietly invites you to find all three.

## 5. Finale: "Now you've seen inside"
When all three slots are full, the finale plays once (about 8 s), and only when no stage and no copy is active. If a copy is out, wait until it is put back.

1. A thread of light leaves each object and meets the others in the air above the coffee table:
   - the record player's thread is amber, carrying the same wave shape;
   - the camera's is warm white;
   - the lamp's is cyan.
2. Where the threads meet, they braid into a single soft point of light that pulses once.
3. Caption: "Sound, light, signal. You've seen inside all three." The words "Sound", "light" and "signal" take their energy colours.
4. The threads retract into the objects. The trio slots glow once.

Reset re-arms the finale. This is the closing shot of the video, so it must read clearly from the default pose.

## Sound
- Hover: no sound.
- Press: the existing tick.
- Opening: very soft ticks.
- Finale: one warm three-note chord, the root at the record player, the third at the camera and the fifth at the lamp, played spatially from each object.

Everything is generated in code and stays quiet.

## Done criteria (LEAF, from the default preview pose)
- **U1. Tokens:** every UI colour comes from `CutawayStyle.ts`. Report the files changed and confirm there are no hard-coded UI colours left (grep).
- **U2. Sliders:**
  - Each slider shows its live value with units.
  - Its fill colour matches its energy.
  - The Warmth track's colour at 2700, 4000 and 6500 K matches the lamp formula within 2% per channel.
  - The Take apart ticks light in step with the parts.
- **U3. States:** hovering a pill raises it to scale 1.04 (±0.01). Pressing it spawns one ring.
- **U4. Rail:** at every hero step, the whole rail is inside the view from the default pose (checked by projecting its corners).
- **U5. Halo:**
  - Gazing at each object enables its halo within 0.3 s, at the correct object.
  - At most one halo is enabled at any time.
  - Looking away disables it within 0.4 s.
  - While a copy is out, its real object's halo is at 10% (±2%).
- **U6. Opening:** it plays on start and after Reset, shows the three dots in sequence, and a pinch skips it.
- **U7. Trio:** each slot fills, in the right colour, when its object's explanation finishes. Reset empties them.
- **U8. Finale:** it plays once all three are explained and nothing is active, does not play while a copy is out, and Reset re-arms it.
- **U9.** All existing tests (C, H, P, R, L) still pass. Hero behaviour is unchanged.

## Order and commits
Commit after each step:
1. Tokens, pills and states (U1, U3).
2. Sliders and the rail (U2, U4).
3. Captions, chips and labels.
4. Halos (U5).
5. Opening and trio (U6, U7).
6. Finale and sound (U8).
7. Captures.

## Captures
Save to `_review/`, each as a crop plus full view:
- `ui_rail_camera`, `ui_rail_rp`, `ui_rail_lamp` (each rail mid-interaction, with values visible);
- `ui_warmth_track`;
- `halo_camera`, `halo_rp`, `halo_lamp`;
- `opening`;
- `trio_two_found`;
- `finale` (the braid moment, wide).

Never use CaptureRuntimeViewTool or QueryRuntimeSceneTool, and never install packages. Run tests one at a time from the default pose.
