---
status: draft
---

# Cutaway: visual direction

This file is the single reference for how Cutaway looks, moves and sounds. It sits next to `design-brief.md`. The brief decides what the Lens does; this file decides how it looks. Don't change behavior, flow or done criteria to follow it.

## Principles

1. **Light is the ink.** The display is additive, so black is invisible. Draw with thin emissive lines, particles and soft glows. No solid or dark fills. Any large surface stays at 15% opacity or less, so the real room always shows through.
2. **Color means energy.** The same color is the same kind of energy in every explanation. Nothing else uses these colors.
   - Amber `#FFB347`: motion, vibration and sound (mechanical waves)
   - Cyan `#5CE1FF`: electricity and signals
   - Warm white `#FFF1D6`: light
   - UI neutral: white, 85% for text, 25–35% for strokes and outlines
3. **Born from the object, returns to it.** Every element grows out of the object's dot. At the end, everything collapses back into that same dot along the path it came from.
4. **One idea per beat.** Each explanation is 4–5 beats of about 3–4 seconds. Only the current beat is bright. Earlier beats dim to about 30% and stay as context.
5. **The Lens narrates itself.** Each beat has one caption, nine words or fewer, next to the object. Only one caption shows at a time. The explanation must make sense with the sound off.
6. **Precise, not decorative.** Every visual stands for a real part or real physics. No generic sparkles, no random particles.

## Shared building blocks

- **Idle dot:** small soft white dot, breathing slowly (2.5 s cycle, 85–100% scale, 40–60% opacity).
- **Chip:** the dot stretches into the capsule (width animates, 250 ms ease-out, 3% overshoot). Label in sentence case.
- **Scan:** when the chip is pinched, a thin horizontal line of light sweeps top to bottom over the object's bounds (600 ms), then four corner brackets lock onto the bounds (150 ms). A soft rising sweep sound plays from the object.
- **Questions:** fan out from the object, staggered 70 ms. Show only questions that are built. No dead buttons.
- **Ghost shell:** the object's bounds drawn as thin edges and corner brackets only, never a filled box. A circular x-ray window shows the internal parts.
- **Internal parts:** clean, simple forms rendered as a fresnel rim plus thin edge lines, in the color of the energy they handle. Never solid.
- **Magnify bubble:** thin double rim, faint inner glow, contents at 4–6x scale. A hairline leader line connects it to the exact spot it magnifies.
- **Flow:** particles moving along a spline with short trails and eased speed. Where it carries a signal, the particles trace the waveform's shape.
- **Rays:** thin straight lines with a bright head traveling along them. Refraction is a clean bend at the lens.
- **Callout label:** hairline leader line, small anchor dot on the part, label text of four words or fewer.
- **Waves:** concentric rings expanding from the source and fading with distance.
- **Finish:** everything reverses into the dot (400 ms) with a small flash. The explained dot gets a thin ring in the color of each energy that explanation used.

## Motion

- Enter: 250–350 ms, ease-out cubic. Exit: 200–250 ms, ease-in.
- Stagger groups by 60–80 ms. No bounce or overshoot, except the dot-to-chip stretch.
- UI keeps a constant apparent size (already built). Explanation content stays at real scale on the object.

## Typography

- One typeface (UI Kit default), two sizes only: chips and questions, then captions and labels.
- Sentence case. No all caps, no exclamation marks.
- Text is white. The one key word in a caption may take its energy color.

## Sound

- Quiet and spatial, always coming from where the event happens.
- A soft tick on every pinch, plus the scan sweep.
- Record player: a needle-drop crackle at the stylus, then a short warm tone from the speaker when the waves leave it (this replaces the current chime).
- Camera: a mirror flip and shutter click at the camera body.
- Lamp: a soft rising power-up tone as the light comes on.

## The three explanations

### Record player: "How does it make sound?" (hero, shown first in the video)

The key idea: the same wave shape is visible at every stage, first in the groove, then in the signal, then in the air.

1. Scan and ghost shell on the turntable. A ghost ring over the platter spins at 33⅓ rpm.
   Caption: "The groove is the sound, carved as a wiggle."
2. Magnify bubble at the stylus. The stylus tip rides a wavy amber groove and shakes with it.
   Caption: "The needle rides the wiggle and shakes."
3. Inside the cartridge: a tiny magnet and coil. The amber wiggle turns into a cyan wave of the same shape.
   Caption: "A magnet and coil turn shaking into signal."
4. The cyan waveform travels along the line of light to the speaker, keeping its shape.
   Caption: "The signal is boosted and sent to the speaker."
5. At the speaker, a ghost cone pushes in and out, amber rings expand into the room, and the warm tone plays from the speaker.
   Caption: "The cone pushes air. That's what you hear."

### Camera: "How does it take a photo?"

1. Scan and ghost shell on the DSLR. The x-ray window shows the lens elements, the mirror and the sensor.
   Caption: "Light from the scene enters the lens."
2. A small glowing arrow, the subject, appears about 40 cm in front of the lens. Warm white rays leave its tip and base and enter the lens.
3. The rays bend through the lens and cross.
   Caption: "The lens bends the light so the rays cross."
4. The mirror flips up with a click, and the rays land on the sensor as the same arrow, upside down.
   Caption: "On the sensor, the image lands upside down."
5. The sensor grid flashes cyan where the image lands.
   Caption: "Each pixel turns light into signal."

Accuracy note: in a DSLR the mirror sends light up to the viewfinder until the shutter is pressed. Then it flips up so the light reaches the sensor.

### Lamp: "How does it make light?"

Assume an LED bulb.

1. Scan and ghost shell on the lamp column. The x-ray window shows the bulb and the cord's path.
2. Cyan pulses travel up the cord into the lamp.
   Caption: "Electric energy flows up the cord."
   Accuracy note: draw the pulses as energy moving, not as electrons racing along the wire.
3. Magnify bubble at the LED chip. Cyan goes into the chip and warm white light comes out.
   Caption: "A tiny chip turns electricity into light."
4. Warm white rays hit the paper shade and scatter, spreading a soft glow over the whole column.
   Caption: "The paper scatters it into a soft glow."
5. The glow settles, then everything collapses into the dot.

## Don'ts

- No solid panels or boxes behind content. No dark colors.
- Never more than one caption on screen.
- Nothing extends beyond the object's area, except the path from the record player to the speaker and the camera's subject arrow.
- Don't use CaptureRuntimeViewTool. It installed packages and broke the compiler earlier.

## Visual checks (in the preview)

1. From a normal viewing spot for each object, its whole explanation stays inside the view.
2. Only one caption is visible at a time, and it reads easily.
3. Every content color matches the energy colors above.
4. Every element starts from the object's dot and returns to it.
5. All existing LEAF tests still pass.
