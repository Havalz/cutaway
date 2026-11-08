# Cutaway

See how everyday objects work. Cutaway is a Snap Spectacles lens for the Learn AR with SPECS hackathon. Look at a camera, a record player or a lamp in the room, and a light copy lands on your table. Take it apart, focus it, play it, light it, with just your hands.

Demo video: [VIDEO_URL](https://youtu.be/APZkHGdODLE)

## What it does
- **Camera:** take it apart with one slider, put a candle in front of the lens, turn the focus, and take a photo. The image is computed with the real thin-lens equation.
- **Lamp:** press the foot switch and the real lamp in the room lights up too. Lift the shade to see why light turns harsh, then change brightness and warmth.
- **Record player:** place the needle yourself. The sound plays from the real speaker across the room. Change loudness and pitch, then take it apart.

## Who it's for
Students, families and anyone curious about how the things around them work.

## Run it
1. Install Git LFS (`git lfs install`), then clone the repository.
2. Open the project in Lens Studio.
3. Run the Preview. Interactions use the Spectacles Interaction Kit.

## How it was built
- Planned with the Devpost Learn skill pack. Its output is in the `devpost/` folder (design brief, visual direction, and the spec for each stage).
- Built with CLAD in Lens Studio, using the Lens Studio MCP.
- Behavior is checked with LEAF tests in `Assets/Tests/`.
- Models (except the camera) and all sounds are generated in code.

## Honest notes
- Recorded in the Lens Studio preview, not on a device.
- Object recognition is replaced by hand-placed markers in the preview scene.
- Explanations are pre-written, with no live AI.
- Wave motion is slowed and magnified so the eye can follow it.

## Credits
Camera model based on "Canon EOS 5D Mark IV" by RAW (https://sketchfab.com/ocbsketch), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). See `devpost/CREDITS.md`.
