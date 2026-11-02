---
status: approved
---

# Camera hero, pass 2: real surface, real physics, solid parts

This pass revises `camera-hero.md`. Where the two disagree, this file wins. Everything not mentioned here stays as built.

Haval's feedback on pass 1:
- The replica is not in the centre of the table.
- It does not sit on the table: it hangs in the air.
- He wants it to behave like a real object. It travels and lands on the table top. You can move it around the table. It lifts a little off the table, over a disc of light, when you take it apart and do the experiment.

Haval will not model any parts. Everything new is built in code.

## 1. Find the real table surface
- Use Spectacles World Query hit testing (`WorldQueryModule`, `HitTestSession`). It is built in, so no package install is needed, and it is how a real Specs Lens finds surfaces.
- At launch, cast rays straight down over a grid of about 9 x 9 covering 1.2 m x 1.2 m, centred on `tableMarker`.
  - Keep hits whose normal is within 10° of up, and whose height is within 3 cm of the median.
  - That median height is the table top.
  - Fit a circle to the outermost kept hits. That gives the table centre and radius.
- Log the surface height, centre and radius, and how far they are from `tableMarker`.
- If hit testing returns nothing in the preview, use a fallback: a table top defined by inspector inputs (`tableTopHeight`, `tableRadius`) at `tableMarker`, with defaults measured as carefully as you can. Report clearly which method is in use.
- Build a static Physics collider (a cylinder) from the surface you found.

## 2. Land on the table with real physics
- Use Lens Studio's built-in Physics (Body and Collider components, no packages).
- Give the replica a compound collider fitted to the model: a box for the body and a cylinder for the lens.
- The replica is kinematic during the flight, while it is grabbed and while it hovers. It is dynamic only while dropping and settling.
- The flight arc now ends 20 cm above the table centre. From there it drops under gravity, touches the surface and settles:
  - friction high, bounciness about 0.05;
  - no visible bounce above 3 mm;
  - still within 0.3 s.
- A soft contact tap plays from the contact point. Keep the landing tone, played at contact.
- At rest:
  - it sits on its real underside, as the model's own geometry decides;
  - its lowest point is within 2 mm of the surface, and no part is below it;
  - its footprint centre is within 1 cm of the table centre;
  - it keeps the yaw from `camera-hero.md`, with the optical axis running across the user's view.
- A faint contact glow hugs the footprint on the surface. It replaces the old table ring. Keep it 2 mm above the surface so it never z-fights.
- "Put it back" first lifts the replica 3 cm off the surface (0.25 s), then flies it home as before.

## 3. Move it around the table
- Grab it (SIK) and slide it across the table top:
  - while held, it lifts 1.5 cm, so it feels picked up;
  - it follows the hand only in the table plane;
  - it can turn only around the vertical axis (H3 still holds).
- Clamp the movement so the whole footprint always stays on the table. Dragged past the edge, it stops there with soft resistance and never falls off.
- On release it drops the 1.5 cm under gravity and settles, with the same contact accuracy as landing.
- The contact glow follows it.

## 4. Hover over a disc of light for the experiment
- When the "Take apart" slider leaves 0, the camera first rises smoothly to hover 12 cm above the surface (0.5 s, ease-out). A disc of light fades in on the table under it:
  - a thin warm white ring with about 10% fill;
  - its diameter is the footprint;
  - it sits 2 mm above the surface.

  After that the parts separate.
- While hovering it bobs slowly (4 mm, 4 s).
- Grab still works while it hovers. Dragging moves the hovering camera and its disc together, with the same clamp, and turning works the same.
- When the slider returns to 0, the parts reassemble. Then the camera descends, touches down and settles with the landing accuracy, and the disc fades out.
- This replaces "lowest point 10 cm above the table" from H1.

## 5. Interior parts with real volume (code-built)
Pass 1 drew the internals as thin lines. That looks flat at the moment that matters most. Rebuild every interior part as a solid mesh in code (lathe, extrude, bevel), with real DSLR proportions at 3x. Glass gets a fresnel rim, a 8–12% fill and bright edge highlights. Lines stay only as accents.
- **Lens elements:** three surfaces of revolution with real curvature and visible thickness: a biconvex front element, a meniscus, and a biconvex rear element.
- **Aperture:** seven curved, overlapping blades forming a real iris, open at f/2.8. Build them so they can close later (stretch S1).
- **Reflex mirror:** a thin bevelled plate with a visible hinge. A slow bright sheen line sweeps across it.
- **Pentaprism:** a solid glass roof prism of the correct shape.
- **Shutter:** a frame with two curtains of 4–5 thin slats each. The slats really move when the shutter fires.
- **Image sensor:** a thin plate in a frame, with a fine pixel grid glowing faintly cyan. It glows brighter where the image lands.
- **Lens mount:** a solid ring with bayonet tabs.
- **Viewfinder:** a small eyepiece tube with a lens.
- **Body shell:** during the light path it moves further away, up and back, clear of every interior part, and fades to about 6%. The internals then stand alone.

Report the triangle count of the new parts. Keep the whole replica at or under 80k triangles.

## 6. A candle instead of the arrow
- Replace the subject arrow with a small candle:
  - a white candle (code-built, softly lit);
  - a living flame (animated flicker, warm white with an amber core).
- The flame top is the subject height h_o, about 6 cm.
- Rays leave the flame tip and the candle base.
- The sensor image is the candle and its flame, inverted and blurred by c.
- The optics model and its ranges stay the same. Update the H4 checks to use the candle.

## 7. Light that flows
Bright pulses travel along every ray from the flame to the sensor, or to the viewfinder while the mirror is down, about one pulse per 0.6 s. Light must visibly move, not just sit there.

## 8. The photo is the payoff
1. After the shutter, the print slides out of the top of the camera, rises, turns to face the user, and floats 55 cm in front of them at chest height, a little below the eye line.
2. It looks like a real photo:
   - 20 x 13 cm;
   - a 1 cm white border;
   - a soft glossy sheen.
3. It develops like instant film: it starts blank and the image fades in over 1.2 s.
4. It shows the candle upright with exactly the sensor's blur.
5. A small tag reads "Sharp" or "Out of focus".
6. The next photo replaces it. Pinching the print dismisses it.
7. Find and fix the root cause of the flaky H5, where the print was sometimes missing. The print must appear every single time.

## 9. Clean up
- Sensor magnify bubble: beside the sensor, at sensor height, on the side away from the rail, at most 25 cm from it. It never overlaps the shell or the wall poster.
- Labels: no label overlaps another label or part. This includes the "Lens mount" label touching the pentaprism.
- The Reset pill is fully inside the view from the default pose.

## 10. Lens bag
Haval says the lens sits in its bag right next to the camera on the console. Try once more to locate it (hit test and preview inspection). If you still can't find it, leave `lensBagMarker` where it is and say so, and Haval will place it by hand.

## Done criteria for this pass (LEAF, from the default preview pose)
- P1. **Surface:** the method in use is reported (hit test or fallback), with the found height, centre and radius against `tableMarker`.
- P2. **Landing:** within 3.5 s of the pinch, the replica is still (speed under 0.5 cm/s):
  - its lowest point is within 2 mm of the surface;
  - no part is below the surface;
  - its footprint centre is within 1 cm of the table centre.

  This replaces H1's height check. The rest of H1 stays.
- P3. **Move:** a drag changes position only in the table plane. Even when dragged far past the edge, the footprint stays on the table. Within 0.5 s of release it rests with the P2 contact accuracy.
- P4. **Hover:** with the slider above 0, the replica hovers 12 cm (±1 cm) above the surface with the disc under it. With the slider back at 0, it rests with the P2 contact accuracy.
- P5. **Solid parts:** all eight interior parts are solid meshes, not only lines.
- P6. **Candle optics:** the H4 numeric checks pass with the candle.
- P7. **Photo:** in a 10-run loop the print appears 10 out of 10 times. It faces the user, 55 cm (±5 cm) in front of them.
- H2, H3, H5, H6 and C1–C5 still pass.

## Order and commits
Build in this order and commit after each step, so a usage limit never loses work:
1. Surface and physics (P1–P4).
2. Solid interior parts (P5).
3. Candle, flowing light and photo (P6–P7).
4. Clean-up and captures.

## Captures
Save these to `_review/` (crop plus full view, using the same method as before):
- `hero2_rest`, plus a low side view at table height that shows the contact;
- `hero2_drag`;
- `hero2_hover`;
- `hero2_apart`;
- `hero2_light`;
- `hero2_focus`;
- `hero2_blurry`;
- `hero2_photo`.

Never use CaptureRuntimeViewTool or QueryRuntimeSceneTool.
