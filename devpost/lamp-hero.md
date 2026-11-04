---
status: approved
---

# Cutaway: lamp hero stage

The paper floor lamp gets the same hands-on stage as the camera and the record player.

- A small copy of the lamp flies to the coffee table and stands on it with real physics.
- You click its foot switch, and current runs up the cord. The miniature glows, and the real lamp across the room lights up with it.
- You lift the paper shade off with your hand and see why the light turns harsh.
- You dim it, warm it up, and take it apart.

The work runs in two phases, like the record player:
- **Phase A:** model the lamp in code from Haval's reference image. Then stop for approval.
- **Phase B:** build the stage on the shared stage kit from the record player's step 2.

Read these first: `camera-hero.md`, `camera-hero-pass2.md` and `recordplayer-hero.md`. Everything they settled applies here unless this file says otherwise:
- surface finding, the physics landing and contact accuracy;
- grab, move and turn;
- the hover disc and the rail;
- the look on an additive display;
- one copy on the table at a time;
- motion, sound, tests and captures.

**Do not modify any camera or record player file.** Build only on the shared stage kit, plus the lamp's own new code.

## Phase A: model it from the reference

Haval attached a reference image. Copy it into `devpost/refs/lamp/`, then study it together with the real lamp in the Evening Room (`lampMarker`, `lampBaseMarker`, `cordStartMarker`).

### What to build
Build the model in its own script, `CutawayLampModel.ts`. It makes one SceneObject per part, each named, with its pivot at the part's real centre or joint.

- **Base:** a brushed-steel weighted disc, gently domed, with a soft rounded edge, and a small collar where the stem meets it.
- **Stem:** a thin steel tube from the base to the bottom ring of the shade.
- **Shade:** a tall, slim spindle shape, widest slightly above its middle and tapering to both ends, exactly as in the reference.
  - Rice paper look: soft warm white, with faint irregular horizontal crinkle bands from a procedural texture or vertex shading.
  - A thin steel ring at the bottom and another at the top.
- **Shade frame (inside, seen only when the shade is off or taken apart):** thin wire rings at regular heights, joined by a few vertical wires.
- **Bulb and socket:** a socket on top of the stem inside the shade, holding an LED bulb.
  - The bulb has a frosted glass envelope.
  - Inside it: a small board with LED chips, and a driver board in the bulb's base.
- **Cord and switch:** a cord leaving the base along the floor, with an inline foot switch (a small rounded box with a button) partway along it.
  - Stretch only: the plug at the end.
- **Interior wiring:** two thin wires up through the stem to the socket.

### Quality bar
- It must not look primitive. Use a smooth lathe profile for the shade and the base, with enough segments that no facets show. Bevel the rings, and give curved surfaces smooth normals.
- Proportions match the reference and the room's lamp. The total height, the shade's widest diameter and the base diameter are each within 5% of the room lamp at scale 1.

### Look
- Follow the look of the earlier copies: lifted for the additive display, with the warm white fresnel rim.
- The paper shade is the star. It must read as paper (soft, slightly translucent, warm), not as plastic.
- Put the shell in its own material slot, `LampShell`.

### Budget and branding
- Budget: 30k triangles or fewer, interior included.
- No brand names or logos anywhere.

### Checkpoint
Place the model at scale 1 beside the real lamp in the preview and save:
- `_review/lamp_model_front` and `_review/lamp_model_side`, each as a crop plus a full view;
- one capture showing the reference and the model side by side.

Report the measured dimensions against the room lamp and the triangle count. **Then stop and wait for Haval's approval.**

## Phase B: the stage

### 1. Entry and launch
- **Entry:** after the lamp's stage 1 explanation, a "Bring it closer" pill appears. "Bring it closer" is also the lamp's second question.
- **Launch:** the copy peels off the real lamp and flies to the table. Then it drops the last 20 cm under gravity and stands on its base, with P2 contact accuracy.
- **Scale:** the lamp is taller than anything else, so this copy *shrinks* on the way. Its standing height on the table is about 60 cm, so expect roughly 0.4x. It must stand upright and stable, centred on the table. Report the value.
- **Cord:** the cord and foot switch lie flat on the table top, curving toward the user, so the switch is easy to reach.
- If another copy is out, send it home first, using its existing public path.

### 2. Switch it on (the hero interaction)
The rail shows "Take apart" and "Put it back", plus a caption: "Press the switch on the cord."

**Pinching the foot switch** turns the lamp on. The button moves down with a soft click from the switch, then:
1. **Current flows.** Cyan pulses travel from the switch along the cord, up through the stem, into the bulb. They are drawn as energy moving, not as electrons racing along the wire.
   - Caption: "Electric energy flows up the cord."
2. **The bulb lights.**
   - A magnify bubble opens at the LED chips. Blue light leaves a tiny chip, and part of it turns yellow in a coating over the chip. Together they come out white.
   - Caption: "The chip glows blue. A coating turns it white."
3. **The shade glows.** Warm white light scatters inside the paper, and the whole shade glows softly from within.
   - Caption: "The paper scatters it into a soft glow."
4. **The real lamp lights too.**
   - A thin cyan thread runs from the miniature's cord to the real lamp in the room.
   - The real lamp's shade fills with the same soft glow, as a large additive glow on its paper at `lampMarker`.
   - A warm pool of light appears on the floor around its base.

   This is the shot for the video: you press a switch on the table, and the real lamp across the room comes on.

**Pinching the switch again** turns everything off: the pulses stop, the bubble closes, and both glows fade over 0.4 s.

### 3. Lift the shade off (grab)
While the lamp is on, grab the shade and lift it straight up. It is constrained to vertical movement, from 0 up to 25 cm above its seat.

The light changes continuously with the lift:
- **Shade on:**
  - the light source looks large and soft;
  - the pool of light on the table has a soft, wide edge.
- **Shade off:**
  - the bare bulb is a small bright point;
  - thin sharp rays leave it in every direction;
  - the pool on the table becomes smaller and brighter, with a crisp edge.
  - Caption: "Without the paper, all the light comes from one tiny point. That's harsh light."

Releasing the shade lowers it back onto its seat, and the light softens again.

Accuracy:
- Softness comes from the size of the source. The shade turns a tiny source into a big one.
- On the additive display, show the difference through the pool's edge softness and the rays, never through dark shadows.

### 4. Live sliders: computed, not keyframed
When the lamp is on, the rail shows two sliders:
- **Brightness** (the dimmer, 0 to 1). It sets:
  - the pulse rate and density in the cord;
  - the LED intensity;
  - the shade glow;
  - the pool brightness;
  - the real lamp's glow.

  All of them rise and fall together. Brightness 0 looks the same as off.
- **Warmth** (2700 K to 6500 K). It sets the colour of all emitted light: in the bubble, in the shade glow, in the pool and on the real lamp.
  - Compute the colour from the colour temperature with a standard blackbody approximation.
  - Report which formula you used.
  - In the bubble, the coating's yellow share grows as the light gets warmer.
  - Caption, the first time Warmth moves: "More coating, warmer light."

Accuracy:
- A white LED is a blue chip with a phosphor coating. The phosphor converts part of the blue light to yellow.
- Warmer LEDs use more phosphor (and a red phosphor), so less blue escapes.

### 5. Take it apart (works whether the lamp is on or off)
- Moving the "Take apart" slider above 0 first lifts the copy to hover 12 cm above the disc of light.
- The parts then separate vertically, in sequence:
  1. the top ring;
  2. the shade, which rises and opens up to reveal its wire frame;
  3. the bulb envelope, which lifts off the LED board;
  4. the driver board, which slides out of the bulb's base;
  5. the socket;
  6. the stem;
  7. the base.

  The cord and switch stay on the table.
- Labels, each four words or fewer. There must be at least 8, and every labelled part must be solid:
  - "Shade"
  - "Wire frame"
  - "Bulb"
  - "LED chips"
  - "Driver"
  - "Socket"
  - "Stem"
  - "Switch"
  - "Base"
- If the lamp is on while apart, a live detail plays on the driver:
  - a cyan sine wave (wall power) flows into the driver;
  - a steady flat current flows out to the LED chips.
  - Caption: "The driver turns wall power into steady current."
- Moving the slider back to 0 reassembles every part exactly. The copy then sets down and stands on the table.

### 6. Put it back and Reset
- **Put it back:**
  1. The lamp switches off, and both glows fade.
  2. The copy lifts, flies home, and grows back to scale 1 as it melts into the real lamp.
- **Reset:** clears everything from any state, including the real lamp's glow and the floor pool.

### Sound
All sounds are generated in code and placed in space:
- a soft switch click at the foot switch;
- a gentle rising power-up tone at the bulb;
- a faint paper rustle when the shade lifts and when it sets down;
- the same landing tap as the other copies.

## Done criteria (LEAF, from the default preview pose)
- **L0. Model (Phase A):** the named parts exist. Height, shade width and base diameter are within 5% of the room lamp. 30k triangles or fewer. The checkpoint captures are saved.
- **L1. Launch:** within 3.5 s the copy stands upright on the table:
  - its base is within 2 mm of the surface;
  - it is centred within 1 cm;
  - its tilt is under 1°;
  - its whole footprint, including the cord and switch, is on the table.

  If another copy was out, that copy is home first.
- **L2. Move and turn:** the same as P3 and H3. The cord and switch move with the lamp.
- **L3. Switch:** pinching the switch turns the lamp on.
  - The pulses run along the cord.
  - The bubble shows the chip.
  - The shade glows.
  - The thread reaches the real lamp, and the real lamp's glow and floor pool are on.

  Pinching it again turns all of these off within 0.5 s.
- **L4. Shade:** lifting the shade changes only its height, within 0 to 25 cm.
  - As the lift increases, the pool's edge gets sharper and its size shrinks.
  - The rays appear only above 60% of the lift.
  - On release, the shade rests on its seat within 1 mm.
- **L5. Sliders:**
  - Raising Brightness raises the LED intensity, the shade glow, the pool and the real lamp's glow, and Brightness 0 equals off.
  - At 2700, 4000 and 6500 K, the emitted colour matches the reported formula to within 2% per channel, on the miniature and on the real lamp.
- **L6. Take apart:**
  - It hovers 12 cm (±1 cm) above the disc.
  - At least 8 labelled solid parts separate.
  - The driver detail runs when the lamp is on.
  - Back at 0, every part is within 1 mm of rest, and the lamp stands on the table at L1 accuracy.
- **L7. Put it back and Reset:** the same as H6. The real lamp's glow and the floor pool are gone.
- **L8.** All existing tests still pass: C1–C5, H1–H6, P1–P8, R0–R8. No camera or record player file appears in `git diff`.

## Order and commits
Commit after each step:
1. Phase A model and checkpoint. **Stop here for approval.**
2. Launch and land.
3. Switch, current, bubble, shade glow and the real lamp.
4. Lifting the shade.
5. Sliders.
6. Take apart.
7. Put it back, Reset and clean-up.
8. Captures.

## Captures
Save these to `_review/`, each as a crop plus a full view:
- `lamp_rest`
- `lamp_on`: a wide view showing the miniature and the real lamp glowing together
- `lamp_bubble`
- `lamp_shade_off`
- `lamp_warm`
- `lamp_cool`
- `lamp_dim`
- `lamp_hover`
- `lamp_apart`

Never use CaptureRuntimeViewTool or QueryRuntimeSceneTool, and never install packages.
