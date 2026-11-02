---
status: approved
---

# Design brief: Cutaway

## The one spatial moment
You stand about 3 m from the console in the Evening Room, pinch a question about the record player, and the explanation plays out on the real objects: a magnifying bubble opens at the needle, then a line of light travels from the record player across the room to the speaker, the speaker cone starts to move, and a soft chime plays from the speaker's position. Both objects are in view without turning your head.

## Why it belongs on glasses
- Uses: draws in the world (the answer is drawn on the real objects, where they are), leaves your body free (hands-only pinch, no typing or reading text), shares your view (it responds to the object you are looking at).
- Why it's better than the phone or laptop version: the answer moves through your space. A line of light that travels from the record player to the speaker across the room can't happen on a flat screen.

## Product or overlay
- Type: overlay: it responds to real objects in the room.
- What the real version would sense: which object you are looking at and where it is in 3D (record player, camera, lamp), and the speaker's position.
- Stand-in for the preview: each object has an empty marker placed by hand over it in the Evening Room scene. The "Record player", "Camera" and "Lamp" chips sit at their markers, and pinching the chip is the stand-in for recognition. The chip is obvious in the scene. Nothing in the Lens reads depth or recognizes anything. Reading depth from a pinch is an optional extra for later and is unproven; it is not a done criterion.
- Direction scripts: hard-coded, one per object and question. No live AI is used, so the demo never depends on it.

## Where things live
- Where the user is looking during the main task: at the record player and the nearest speaker, from about 3 m, standing at eye height, looking slightly down.
- Record player marker: on the record player. The magnifying bubble opens at a needle marker. The needle inside the bubble is the learner's own model drawn on top of the room, pinned to that marker (default marker name; the learner places it by eye).
- Speaker marker: on the nearest speaker, about 1.2 m from the record player (default; the learner hasn't measured, and will adjust the markers by eye in the preview).
- Speaker cone: the cone that moves is the learner's own model drawn on top of the room, pinned to the speaker marker. The room's speaker meshes do not move.
- Line of light: runs from the record player to the speaker along the shelf. It replaces the cable and has no physical object in the room.
- Camera and lamp markers: to the sides, in the same room. You turn your head to reach them; each has its own explanation and doesn't need the others in view.
- Chips, questions and labels: sized large enough to read at 3 m (default).
- "Stop" pill: small, directly under the object being explained (default).
- "Reset" pill: floating low and slightly to the left of the user, inside the view when looking down a little.
- Idle dots: small and quiet, one at each marker.

## Hands and input
- Open an object: pinch its chip.
- Choose a question: pinch a big question around the object (one is guaranteed; up to three if the stretch questions get built).
- Replay or ask another question: pinch the dot left on the object.
- Cancel: pinch the "Stop" pill.
- Clear everything: pinch the "Reset" pill.
- Targets are big and highlight when aimed at.
- No voice. Every action is a pinch.

## When things show
- Idle dot: shows at each marker at the start and stays until the object is explained.
- Name chip: grows from the dot when the object is near the center of your view, and shrinks back to the dot when you look away.
- Three questions: appear around the object after you pinch its chip. Their wording is hard-coded (default; the learner hasn't written them). Only one question per object is guaranteed; the other two are stretch and may not be built, in which case only the built questions show.
- Chip and other two questions: fade out when you pinch one question.
- Effect: plays for about 15 to 20 seconds. The "Stop" pill shows under the object during that time.
- Chime: plays from the speaker's position when the line of light reaches the speaker, so you notice it even if you are looking elsewhere.
- When the effect finishes: everything shrinks into one small dot that stays on the object, marking that it has been explained.
- Stop: cancels the effect and returns the object to its dot.
- Reset: clears every dot and returns all three objects to idle, with only their small idle dots showing.

## Effects (library of about eight)
Flow, rays, magnify, cutaway shell, labels, pulse, and the line of light and cone motion built from them. The explanations for the three objects:
- Record player: magnifying bubble at the needle showing the vibration, then a line of light to the speaker, then the cone moves, with a chime.
- Camera: a light path through the lens to the sensor.
- Lamp: current along the cord, then light.

## Done criteria
Each one can be checked in Lens Studio's preview.
1. At start, each of the three objects (record player, camera, lamp) shows only a small dot at its marker. Looking at one makes its chip appear with its name, and looking away makes it shrink back to the dot.
2. Pinching the "Record player" chip shows its big question(s) around it; at least one is guaranteed. Pinching the guaranteed question plays the explanation: a magnifying bubble opens at the needle, then a line of light travels from the record player to the speaker, the speaker cone (the learner's own model, pinned to the speaker marker) starts to move, and a chime plays from the speaker's position. From 3 m, the record player and the speaker are both in view without turning your head.
3. The camera and the lamp each play their own explanation when you pinch their guaranteed question: the camera shows a light path through the lens to the sensor, and the lamp shows current along the cord and then light. You only need to turn your head to reach them.
4. When an explanation finishes, everything shrinks into one small dot on the object. Pinching that dot reopens the question(s). Pinching "Stop" in the middle of an explanation cancels it and returns the object to its dot.
5. Pinching "Reset" clears all dots and returns all three objects to idle.

## Out of scope
- Real object recognition and reading 3D position from depth.
- Live AI: no AI-written scripts, text, or video.
- Only one question per object is guaranteed and counted in the done criteria. The other two questions per object are stretch and may not be built.
- More than three objects.
- Voice input.
- Recording, identifying, or following people.
- Remembering explained objects between sessions.

## Risks and open questions
- Depth-to-3D from a pinch is unproven; it stays an optional extra and is not a done criterion.
- Marker positions and the 1.2 m record player to speaker distance are defaults, to be adjusted by eye in the preview after the build.
- The needle in the bubble and the speaker cone motion are the learner's own models pinned to markers, not the room's meshes moving. Nothing depends on the room's meshes being separable.
- The learner must review the accuracy of the explanations themselves, since the direction scripts are pre-written, not live AI.
- Feel unproven: readability of chips at 3 m, comfort of turning your head to reach the camera and lamp, and how looking at an object triggers its chip on real glasses.
- The learner couldn't sign in to Lens Studio when this plan was made. This doesn't affect the plan, but it may affect the build.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) and UI Kit for all interactions, so they work with the mouse in Interactive Preview and with LEAF.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Write LEAF scenarios for each done criterion, run them in preview, and report which pass. Say which criteria have no test.
- Don't record, identify, or follow people.

## After the build: judge it
This part is for you, after CLAD finishes.

1. **Does it work?** Ask your agent which LEAF tests passed and which done criteria have no test.
2. **Walk around it.** Open the preview in Interactive Preview. Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch. Stand where a user would and look at the task.
3. **Ask the three questions.**
   - Does it use what I'm looking at?
   - Does it put something in my space, where it belongs?
   - Does it free my hands or let me keep my eyes up?
   - Would it be just as good on a phone? If so, what would make it need the glasses?
4. **Check comfort.**
   - Everything I need is in view while I do the task. Nothing sits at the edges, behind me, or stuck to my face.
   - Every control is within reach of someone standing there.
   - Text reads easily from where I stand. No dark UI disappearing.
   - Things show when needed and get out of the way.
5. **Label what you know.** Write "logic proven" next to anything the tests and preview show working, and "feel unproven" next to anything only real glasses could tell you (comfort over time, real hand tracking, real recognition).
6. **Fix with design notes, not code.** Tell your agent what to change in design terms, for example: "Move the step card 15 cm lower and next to the pan. Make the Next button twice as big. Re-run the tests." If a fix takes under a minute, like nudging a panel, do it yourself in the scene.
7. **Submit.** Record a video under 3 minutes of your Lens in the preview, public on YouTube. Make your repo public with your Lens Studio project and this `devpost/` folder. Details are on the hackathon site: https://learn-specs.devpost.com/resources

## Stage 2: Bring it closer (added after the first build)
The camera gets a hands-on second stage: a 3x copy of the DSLR flies from the real camera to the round coffee table, comes apart with a slider, and lets the user focus a live, computed light path and take a photo. The full spec and its done criteria (H1–H7) are in `camera-hero.md`. The record player and the lamp may get the same stage later; they are out of scope for now.
