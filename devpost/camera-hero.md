---
status: approved
---

# Cutaway: camera hero stage ("Bring it closer")

This file adds a second stage to the camera. It sits next to `design-brief.md` (what the Lens does) and `visual-direction.md` (how it looks). Everything already built stays as it is, and all existing LEAF tests must keep passing. Where this file and those two disagree, this file wins for the camera hero stage only.

## The one spatial moment
After the camera explains itself, you pinch "Bring it closer". A glowing copy of the DSLR lifts off the real camera. The lens rises out of its bag and clicks onto the body in mid-air. The assembled camera flies across the room, growing as it comes, and lands hovering over the round coffee table in front of the sofa at 3x size. You walk around it, take it apart with one slider, put a subject in front of the lens, focus it yourself, and take a photo. The photo comes out as sharp or as blurry as you focused it. Then the camera flies home and melts back into the real one.

This is the hero shot of the video. It has to feel finished and deliberate in every frame.

## Why it is stronger than stage 1
- Stage 1 is watched. Stage 2 is done with your hands.
- It uses real scale and real places: the copy leaves a real object and lands on a real table, and you walk around it.
- The optics are live. What you see on the sensor is computed from the real lens equation, so every choice the user makes changes the result.

## The 3D model
Haval attached a DSLR model of nearly the same type as the one in the Evening Room. It has the body and the lens, with all exterior parts.

1. Import it into `Assets/Models/CameraReplica/` with the Lens Studio MCP. If no MCP tool can import it, stop and ask Haval to drag it into the Asset Browser. Lens Studio imports FBX, OBJ and glTF/GLB. If the file is another format, ask Haval for an FBX or GLB.
2. Before building anything, report an inventory in one short table:
   - each mesh or object name;
   - its triangle count;
   - its materials and texture sizes;
   - the import scale and units;
   - where its pivot sits.

   Also say whether the lens is a separate mesh, and whether the model has any interior parts.
3. Normalize the model so that at scale 1 it matches the real camera's size in the room (body about 14 cm wide), with the lens pointing along local +Z. Put the pivot at the lens mount.
4. Budget: the replica stays at or under 80k triangles, with textures at 2048 or below (1024 preferred). If it is over, decimate it and report the change. Report the lens size at the end.
5. If the model is a single merged mesh: do not stop. Treat it as the outer shell. Build the separable parts as clean code-made parts (see below), skip the lens-from-the-bag moment, and say so in the report. Haval can split the mesh in Blender later.

## Anchors (hand-placed, like the existing markers)
Add these as inspector inputs on the controller, next to the existing markers, with clear hints:
- `tableMarker`: the centre of the top surface of the round coffee table in front of the sofa in the Evening Room.
- `lensBagMarker`: the lens inside its bag next to the camera on the console.

Locate them the same way the camera marker was located. Haval will nudge them by eye.

## Look on an additive display
The real camera is black, and black is invisible on Specs. The replica must read as the real camera made of light:
- Keep the model's own textures so it is recognisably this camera. Lift them for the additive display by adding emissive equal to about 35% of albedo, so dark plastic reads as dark grey, not as a hole.
- Add a warm white (`#FFF1D6`) fresnel rim at about 30%.
- Light it with a small light rig parented to the replica (one key light and soft fill). It must not change any other content.
- Code-made interior parts use the existing fresnel-rim and edge-line style, in the colour of the energy they handle: warm white for glass and light, cyan for the sensor and signal.
- Put the replica's shell material in its own slot called `ReplicaShell`. If authoring a graph material through the MCP is unreliable, use PBR plus emissive and say so. Haval will author the final shader himself.

## Flow

### 1. Entry
- After the camera's stage 1 explanation finishes and collapses to its dot, a "Bring it closer" pill appears under the camera. It uses the same style as the Stop pill.
- "Bring it closer" is also the camera's second question in its question fan. The question mechanism already supports up to three.
- Both entry points run the same launch.

### 2. Launch (the hero moment, about 3 s total)
1. The scan brackets on the real camera flash once. A 1x copy of the body peels off the real camera, drawn as rim and edges only.
2. At the same time the lens rises out of its bag at `lensBagMarker`.
3. Body and lens meet about 30 cm above the console. The lens turns 45° into the mount, a real bayonet twist, and clicks. The click sound plays from that point.
4. The assembled camera travels to the table along a smooth arc (1.6–2.0 s, ease in-out) and grows from 1x to 3x on the way. It leaves a soft light trail.
5. The trail settles into a thin warm white thread from the real camera to the replica. The thread is about 30% opacity, with a slow pulse travelling toward the replica. It stays while the replica is out.
6. The replica lands with its lowest point 10 cm above the table top.
   - A ring of light spreads across the table under it, in place of a shadow.
   - A soft landing tone plays from the table.
   - The rim-only copy fills in to the full lifted textures over 400 ms.
7. The replica faces so that its optical axis runs across the user's view, left to right, measured from where the user stands when they pinch. This way the light path later reads sideways, never toward the eye.

### 3. Take it apart
- A small control rail floats beside the replica on the user's side. It has a constant apparent size and big pinch targets. It shows only the controls the current step needs.
- First it shows a "Take apart" slider (UI Kit) and a "Put it back" pill.
- Dragging the slider from 0 to 1 separates the parts in sequence along the optical axis, with a short stagger:
  1. The lens unlocks (reverse twist) and moves forward.
  2. The lens elements spread out inside the barrel.
  3. The aperture appears between them.
  4. The body shell lifts up and back and fades to an outline at about 15%.
  5. The reflex mirror, the pentaprism, the shutter and the image sensor separate along their real positions.
- Each part gets a callout label once its own progress passes 0.8 (four words or fewer): "Lens elements", "Aperture", "Lens mount", "Reflex mirror", "Pentaprism", "Viewfinder", "Shutter", "Image sensor".
- A soft click plays from each part as it frees itself.
- Dragging back reverses everything exactly.
- Parts the model does not have are code-made, in the same style.
- Grabbing the replica (SIK) turns it around the vertical axis only. It never moves off the table and never scales.

### 4. Light path: try it yourself
When the slider reaches 1, the light path starts automatically.

1. A glowing 3D subject arrow appears in front of the lens on the optical axis. Its grab handle is clearly visible.
2. Viewfinder beat (about 3 s): the mirror is down. Warm white rays leave the subject's tip and base, bend through the lens, reflect off the mirror up into the pentaprism, and leave through the viewfinder.
   - Caption: "Until you shoot, a mirror sends light to your eye."
3. The mirror lifts with a soft click (live view). The rays now reach the sensor.
   - Caption: "Mirror up: now the light reaches the sensor."
4. The rail now shows a "Focus" slider and a "Take a photo" button.
5. Live interaction:
   - Grab the subject and slide it along the axis. It is constrained to the axis, inside a fixed range.
   - Move the Focus slider. It moves the lens group along the axis.
   - The rays, the image position, its size and its blur on the sensor all update every frame.
6. When the image is sharp, the sensor image gets a thin cyan outline.
   - Caption when sharp: "Sharp. The rays meet exactly on the sensor."
   - Caption when not: "Blurry. Turn the focus until the rays meet."

#### Optics: computed, never keyframed
Use a thin-lens model with distances scaled to the replica:
- Focal length f = 15 cm in replica space (a 50 mm lens at 3x).
- Subject distance d_o ranges from 25 to 90 cm.
- Lens-to-sensor distance L ranges from 16 to 40 cm and is set by the Focus slider.
- Image distance: 1/f = 1/d_o + 1/d_i.
- Image on the sensor:
  - inverted (upside down and left-right reversed);
  - height h_i = h_o × L / d_o;
  - blur circle diameter c = A × |L − d_i| / d_i, where A = f / N and N = 2.8.
- Draw the rays from the subject's tip and base through the lens to their real crossing point, so the user sees the rays meet in front of, on, or behind the sensor.
- The subject arrow is 5 cm tall. The sensor is a full-frame sensor at 3x, about 11 x 7 cm.
- Render the sensor image as the subject's silhouette with a blur set from c. If it reads too small from a normal viewing spot, add the existing magnify bubble on the sensor.
- Expose the numbers to tests: d_o, d_i, L, h_i and c.

### 5. Take a photo
1. The shutter's two curtains travel across the sensor (first opens, second closes), with a two-part shutter sound from the replica.
2. The sensor pixels flash cyan where the image fell.
   - Caption: "Each pixel turns light into signal."
3. A photo print (about 15 x 10 cm) slides out of the replica and floats beside it. It shows the subject upright, with exactly the blur the sensor had.
4. Taking another photo replaces the print. The user can refocus and try again.

### 6. Put it back
1. The parts reassemble (the slider animates back to 0) and the lens twists into the mount.
2. The replica flies back along the thread, shrinking to 1x.
3. The lens drops back into its bag, and the body melts into the real camera.
4. The thread and the table ring fade out. The camera's explained dot keeps its rings.

Stop and Reset:
- "Put it back" is the stop for this stage.
- "Reset" clears the replica, thread, print and rail from any state, instantly and cleanly.
- Other stations keep working while the replica is out.

## Sound (generated in code, like the existing sounds, all spatial)
- Lift: a soft rising tone at the camera.
- Bayonet click: in mid-air, where the lens mounts.
- Flight: a soft air sweep that follows the replica.
- Landing tone: at the table.
- Part clicks: one per part.
- Mirror lift: reuse `MirrorClick.wav`.
- Shutter: a two-part sound.
- Print: a slide.

Everything stays quiet and short.

## Motion and comfort
- Follow `visual-direction.md` for easing and stagger. The flight arc is the only long motion.
- Never fly anything through the user's head.
- Nothing is head-locked.
- One caption at a time, beside the replica, on the user's side.

## Accuracy notes (Haval reviews these)
- In a DSLR the mirror sends light up to the pentaprism and out of the viewfinder until the shot. The pentaprism turns the image upright for the eye.
- The mirror lifts for the shot, and also for live view.
- The shutter is a focal-plane shutter with two curtains. The exposure is the gap between them.
- Focusing moves the lens relative to the sensor until the image distance equals the lens-to-sensor distance.
- The optics are a scaled thin-lens model. It uses the same equation as the real lens, with distances scaled to fit the table. The Devpost page will say so.

## Done criteria (each checkable in the preview with LEAF)
- H1. **Launch:** pinching "Bring it closer", from either the pill or the second question, ends with the replica at rest above `tableMarker` within 3 s:
  - scale 3x (±5%), with its lowest point 10 cm (±2 cm) above the table top;
  - the thread connects it to the real camera;
  - the landing sound plays from the table.
- H2. **Take apart:** the slider at 1 separates at least 6 named parts along the optical axis, each with its label visible. The slider back at 0 returns every part to within 1 mm of rest.
- H3. **Turn it:** grabbing the replica only changes its rotation around the vertical axis. Its position and scale stay the same.
- H4. **Light path:** at full separation the subject appears and the rays reach the sensor after the viewfinder beat.
  - For three subject distances (30, 50 and 80 cm), with focus set to L = d_i: c is under 0.1 cm, and h_i matches h_o × d_i / d_o within 2%.
  - With focus at L = d_i + 5 cm, c is above 0.8 cm.
- H5. **Photo:** "Take a photo" plays the shutter, flashes the sensor, and shows a print whose blur equals the sensor's blur at that moment.
- H6. **Put it back and Reset:** "Put it back" ends with no replica, thread, print or rail in the scene, and the camera in its explained state. Reset from each step (launching, apart, light path, photo) does the same.
- H7. All existing LEAF tests (C1–C5) still pass.

Stretch, only after H1–H7 pass:
- S1. An "Aperture" slider (f/2.8 to f/16): iris blades close, the ray cone narrows, the image dims and the blur shrinks.
- S2. A slow, subtle hover bob on the replica (5 mm, 4 s).

## Build order
1. Commit the current work first.
2. Inventory and import, then normalize.
3. Anchors.
4. Launch and land.
5. Take apart and turn.
6. Light path and focus.
7. Photo.
8. Put it back and Reset.
9. Sound.
10. Tests, then captures.

Get each step working before polishing it.

## Tests and captures
- Write LEAF scenarios H1–H6 next to the existing ones. Use test-only hooks in the same style as `setHeadOverride` and `holdExplanation`. Run the full suite and report pass or fail per criterion.
- Extend `DemoPlayScenario` with `station=cameraHero` and `step=launch|land|apart|light|focus|blurry|photo|back`, holding each step for screenshots.
- Save captures to `_review/hero_<step>.png` (full view and a crop), using the same capture method as the previous passes.
- Never use CaptureRuntimeViewTool or QueryRuntimeSceneTool. They install packages and break the TypeScript compile.
- Run tests from the default preview pose.
- Commit at the end with a short message.
