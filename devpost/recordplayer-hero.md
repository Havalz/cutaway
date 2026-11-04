---
status: approved
---

# Cutaway: record player hero stage

The record player gets the same hands-on stage as the camera. A copy flies to the coffee table and lands with real physics. You drop the needle yourself, and the sound comes out of the real speaker across the room. You can make it louder or higher, and you can take it apart.

There is no downloadable model, so the work runs in two phases:
- **Phase A:** model the record player in code from Haval's reference images.
- **Phase B:** build the stage, reusing the camera hero system.

Read `camera-hero.md` and `camera-hero-pass2.md` first. Everything they settled applies here unless this file says otherwise:
- the surface fallback, physics landing and contact accuracy;
- grab, move and turn;
- the hover disc;
- the rail;
- the look on an additive display;
- motion, sound style, and the test and capture rules.

## Phase A: model it from the references

Haval attached reference images. Copy them into `devpost/refs/recordplayer/` and study them together with the real record player in the Evening Room (`recordPlayerMarker`, `needleMarker`).

### What to build
Build the model in its own script, `CutawayRecordPlayerModel.ts`. It produces one SceneObject per part, each with a clear name and its pivot at the real hinge or centre:
- **Plinth (base):** a chamfered box with feet. It carries the start/stop and 33/45 buttons as shallow raised shapes.
- **Dust cover:** smoked clear glass, hinged at the back, open as in the room.
- **Platter:** a cylinder with a fine strobe-dot ring on its edge, and a rubber mat.
- **Record:** a disc with a procedural groove pattern (fine concentric rings with a subtle sheen), a plain centre label with no text or logo, and the spindle.
- **Tonearm:** the shape from the reference, straight or S-shaped.
  - It has a pivot base with a bearing ring and a counterweight.
  - It has an arm rest with a clip and a cue lever.
  - Its headshell has a finger lift.
- **Cartridge:** on the headshell, with the stylus cantilever and tip.
- **Interior** (hidden until taken apart): the motor, the belt around the sub-platter, the magnet and the two coils inside the cartridge, and the signal wires.

### Quality bar
It must not look primitive:
- Every visible edge gets a small bevel or chamfer, with smooth normals on curved surfaces.
- Proportions match the references and the room's record player.
- Main width, depth and height are within 5% of the room object's bounds at scale 1.

Other rules:
- **Look:** follow `camera-hero.md`, "Look on an additive display".
  - Take base colours from the reference, lifted so dark parts read as dark grey, not as holes.
  - Add the warm white fresnel rim.
  - Put the shell in its own material slot, `RecordPlayerShell`.
- **Budget:** 40k triangles or fewer for the whole model, interior included.
- **Branding:** no brand names, logos or text anywhere on the model.

### Checkpoint
Place the model at scale 1 beside the real record player in the preview and save:
- `_review/rp_model_front`, `_review/rp_model_side` and `_review/rp_model_top` (crop and full view);
- one capture with the reference image and the model side by side.

Report the measured dimensions against the room object and the triangle count. **Then stop and wait for Haval's approval before starting Phase B.**

## Phase B: the stage

### Shared system
Refactor the camera hero's shared parts into one shared base that both objects use:
- the flight;
- surface finding and the physics landing;
- grab, move and turn;
- the hover disc;
- the rail;
- the take-apart sequencing;
- Put it back and Reset.

The camera's behaviour and all its tests must stay exactly as they are.

Only one copy can be on the table at a time. Launching the record player while the camera is out first sends the camera home, then launches the record player.

### 1. Entry and launch
- **Entry:** after the record player's stage 1 explanation, a "Bring it closer" pill appears. "Bring it closer" is also its second question. This is the same as the camera.
- **Launch:**
  1. The rim-only copy peels off the real record player and rises.
  2. It flies to the table along the same arc rules, growing on the way.
  3. It drops the last 20 cm under gravity, touches down and settles. Contact accuracy is the same as P2.
- **Scale:** the largest scale, up to 2x, at which the whole footprint fits inside the table radius minus 3 cm. Expect about 1.5x. Report the value.
- **Orientation:** the tonearm side faces the user, so the arm is easy to reach.

### 2. Drop the needle (the hero interaction)
- The rail shows "Take apart" and "Put it back", plus a one-line caption: "Lift the arm and place the needle on the record."
- **Grab the tonearm** by its finger lift (SIK). Its motion is constrained to the real arm:
  - it turns only around its pivot, between the rest position and the record's inner edge;
  - it lifts and lowers only within the real cueing height.
- **Release over the record:**
  1. The stylus lowers onto the record surface, within 1 mm.
  2. The platter spins up to 33⅓ rpm over about 1 s.
  3. A needle-drop crackle plays at the stylus.
- **Release anywhere else:** the arm returns to its rest.
- **While it plays:**
  - **At the stylus:** a magnify bubble opens beside it. It shows the stylus riding a V-groove that wiggles from side to side, and the stylus shaking with it in amber.
    - Caption: "The needle rides the wiggle and shakes."
  - **Signal to the room:** a cyan waveform leaves the cartridge and travels along a thin thread of light from the replica to the real speaker in the room (`speakerMarker`).
    - Caption: "A magnet and coils turn that shaking into signal."
  - **At the real speaker:**
    - the ghost cone pumps;
    - amber rings expand into the room;
    - the tone plays from the speaker's position.

    Caption: "The speaker pushes air. That's the sound you hear."

    This is the shot for the video: you stand at the table and the sound happens across the room.
- **"Loudness" and "Pitch" sliders** appear on the rail once it plays. Their effects are below.
- **Lift the arm off the record:**
  - the platter spins down within 2 s;
  - the sound stops;
  - the signal fades;
  - the bubble closes.

### 3. Live sliders: computed, not keyframed
Every slider change updates everything below in the same frame.

- **Loudness** (0 to 1) sets the groove wiggle's amplitude in the bubble. It also sets:
  - the signal waveform's height;
  - the cone's excursion;
  - the rings' brightness;
  - the tone's gain (a perceptual curve, quiet to comfortable).

  All change in the same direction.
- **Pitch** sets the frequency f, from 110 to 880 Hz on a log scale. It also sets:
  - the number of wiggles across the bubble;
  - the waveform's wavelength;
  - the cone's rate;
  - the ring spacing;
  - the tone's frequency.
- **Real physics shown honestly:**
  - **Ring spacing is the real wavelength in air:** λ = 34300 / f cm, about 78 cm at 440 Hz and about 3.1 m at 110 Hz.
  - **Groove wiggle:** the real wavelength on the record is v / f, where v = 2π·r·(33⅓/60) at the stylus radius r. That is far too fine to see, so the bubble magnifies it by a fixed factor M.
  - **Slow motion:** all motion is slowed by a fixed factor S so the eye can follow it. The cone, the waveform and the rings use the same S.
  - Put M and S in one place in the code and report their values. The Devpost page will say the waves are slowed and magnified.
- **Tone:**
  - Prefer live synthesis through Lens Studio's audio output, if it works in the preview: a warm tone, a sine plus a few soft harmonics.
  - If it doesn't, pre-generate tones for 8 notes across the range and snap Pitch to them, with short crossfades.
  - Report which one you used.
  - The audio source sits at `speakerMarker`.

### 4. Take it apart (works while the arm is at rest)
- Moving the "Take apart" slider above 0 first lifts the copy to hover 12 cm over the disc of light, the same as the camera.
- The parts then separate upward in sequence, with a short stagger:
  1. the dust cover;
  2. the record;
  3. the platter and mat, revealing the belt, sub-platter and motor;
  4. the tonearm, which rises and moves out;
  5. the cartridge, which leaves the headshell and opens to show the magnet between the two coils;
  6. the stylus.
- The plinth fades to an outline at about 15%.
- **Labels** (four words or fewer, at least 8, solid parts and no lines-only parts):
  - "Dust cover"
  - "Record"
  - "Platter"
  - "Belt"
  - "Motor"
  - "Tonearm"
  - "Counterweight"
  - "Cartridge"
  - "Magnet and coils"
  - "Stylus"
- **Live detail while apart:**
  - the motor turns and drives the belt, which turns the sub-platter;
  - inside the open cartridge, the magnet wiggles between the coils, and the coils pulse cyan in step.
  - Caption: "Wiggle a magnet near a coil, and current flows."
- The slider back at 0 reassembles every part exactly, then the copy sets down on the table.

### 5. Put it back and Reset
- **Put it back:**
  1. The arm returns to its rest, and the platter stops.
  2. The copy lifts, flies home, shrinks and melts into the real record player.
- **Reset:** clears everything from any state, the same as the camera.

## Accuracy notes (Haval reviews these)
- The record's groove is one long spiral. Its side-to-side wiggle is the sound wave's shape.
- A moving-magnet cartridge: the stylus shakes a tiny magnet near fixed coils, which makes a small voltage in the same shape as the wiggle.
- That signal is amplified, and the speaker cone pushes the air in the same shape.
- A louder sound is a bigger wiggle. A higher sound means more wiggles per second.
- The sound's wavelength in air is 343 m/s divided by f.
- The motor turns the platter at 33⅓ rpm through the belt.

## Done criteria (LEAF, from the default preview pose)
- **R0. Model (Phase A):**
  - the named parts exist;
  - the main dimensions are within 5% of the room object at scale 1;
  - 40k triangles or fewer;
  - the checkpoint captures are saved.
- **R1. Launch:** within 3.5 s the copy is at rest on the table:
  - its lowest point within 2 mm of the surface;
  - its footprint centre within 1 cm of the table centre;
  - its whole footprint on the table.

  If the camera was out, the camera is home first.
- **R2. Move and turn:** the same as P3 and H3.
- **R3. Needle drop:**
  - Dragging the arm changes only its rotation around the pivot, inside the limits.
  - Releasing it over the record puts the stylus on the record surface within 1 mm, and the platter reaches 33⅓ rpm (±1%) within 1.5 s.
  - Releasing it elsewhere returns the arm to rest.
- **R4. Sound in the room:** while playing:
  - the thread reaches the real speaker;
  - the cone moves;
  - the rings come from `speakerMarker`;
  - the audio source is at `speakerMarker` and is playing.
- **R5. Sliders:**
  - Raising Loudness raises the groove amplitude, the cone excursion and the tone gain.
  - At 110, 440 and 880 Hz, the ring spacing equals 34300 / f cm (±2%), and the tone's frequency matches (or is the snapped note, if pre-generated).
- **R6. Lift:** with the arm lifted, the platter is still within 2 s and no tone is playing.
- **R7. Take apart:**
  - It hovers 12 cm (±1 cm) over the disc.
  - At least 8 labelled solid parts separate.
  - The cartridge and motor animations run.
  - Back at 0, every part is within 1 mm of rest, and the copy rests on the table at P2 accuracy.
- **R8. Put it back and Reset:** the same as H6.
- **R9.** All existing tests (C1–C5, H1–H6, P1–P8) still pass.

## Order and commits
Commit after each step:
1. Phase A model and checkpoint. **Stop for approval here.**
2. Refactor into the shared hero base, with all camera tests still passing.
3. Launch and land.
4. Needle drop and sound in the room.
5. Sliders.
6. Take apart.
7. Put it back, Reset and clean-up.
8. Captures.

## Captures
Save to `_review/` (crop plus full view):
- `rp_rest`;
- `rp_needle`;
- `rp_playing`: a wide view that shows the copy on the table and the rings at the real speaker together;
- `rp_loud`;
- `rp_pitch_low`;
- `rp_pitch_high`;
- `rp_hover`;
- `rp_apart`.

Never use CaptureRuntimeViewTool or QueryRuntimeSceneTool, and never install packages.
