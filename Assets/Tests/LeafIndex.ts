import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {C1IdleAndGazeScenario} from "./C1IdleAndGazeScenario"
import {L1LampLaunchScenario} from "./L1LampLaunchScenario"
import {L2LampMoveTurnScenario} from "./L2LampMoveTurnScenario"
import {L3LampSwitchScenario} from "./L3LampSwitchScenario"
import {L4LampShadeScenario} from "./L4LampShadeScenario"
import {LampCaptureScenario} from "./LampCaptureScenario"
import {C2RecordPlayerScenario} from "./C2RecordPlayerScenario"
import {C3CameraScenario} from "./C3CameraScenario"
import {C3LampScenario} from "./C3LampScenario"
import {C4FinishAndStopScenario} from "./C4FinishAndStopScenario"
import {C5ResetScenario} from "./C5ResetScenario"
import {DemoPlayScenario} from "./DemoPlayScenario"
import {H1LaunchScenario} from "./H1LaunchScenario"
import {H2TakeApartScenario} from "./H2TakeApartScenario"
import {H3TurnScenario} from "./H3TurnScenario"
import {H4LightPathScenario} from "./H4LightPathScenario"
import {H5PhotoScenario} from "./H5PhotoScenario"
import {H6PutBackResetScenario} from "./H6PutBackResetScenario"
import {P1SurfaceScenario} from "./P1SurfaceScenario"
import {P2LandingScenario} from "./P2LandingScenario"
import {P3MoveScenario} from "./P3MoveScenario"
import {P4HoverScenario} from "./P4HoverScenario"
import {P5SolidPartsScenario} from "./P5SolidPartsScenario"
import {P6CandleOpticsScenario} from "./P6CandleOpticsScenario"
import {P7PhotoScenario} from "./P7PhotoScenario"
import {P8CleanUpScenario} from "./P8CleanUpScenario"
import {HeroLayoutScenario} from "./HeroLayoutScenario"
import {R0ModelScenario} from "./R0ModelScenario"
import {RpModelScenario} from "./RpModelScenario"
import {R1RpLaunchScenario} from "./R1RpLaunchScenario"
import {R2RpMoveTurnScenario} from "./R2RpMoveTurnScenario"
import {R3RpNeedleScenario} from "./R3RpNeedleScenario"
import {R4RpSoundScenario} from "./R4RpSoundScenario"
import {R5RpSlidersScenario} from "./R5RpSlidersScenario"
import {R6RpLiftScenario} from "./R6RpLiftScenario"
import {R7RpApartScenario} from "./R7RpApartScenario"
import {R8RpPutBackResetScenario} from "./R8RpPutBackResetScenario"
import {RpCaptureScenario} from "./RpCaptureScenario"
import {L0LampModelScenario} from "./L0LampModelScenario"
import {LampModelScenario} from "./LampModelScenario"

@component
export class LeafIndex extends BaseScriptComponent {
  @scenariosIndex
  static scenariosIndex: ScenarioMetadata[] = [
    {id: "c1-idle-dots-and-gaze-chips", typename: C1IdleAndGazeScenario.getTypeName()},
    {id: "c2-record-player-explanation", typename: C2RecordPlayerScenario.getTypeName()},
    {id: "c3-camera-explanation", typename: C3CameraScenario.getTypeName()},
    {id: "c3-lamp-explanation", typename: C3LampScenario.getTypeName()},
    {id: "c4-finish-dot-and-stop", typename: C4FinishAndStopScenario.getTypeName()},
    {id: "c5-reset-clears-dots", typename: C5ResetScenario.getTypeName()},
    {id: "h1-hero-launch", typename: H1LaunchScenario.getTypeName()},
    {id: "h2-hero-take-apart", typename: H2TakeApartScenario.getTypeName()},
    {id: "h3-hero-turn", typename: H3TurnScenario.getTypeName()},
    {id: "h4-hero-light-path", typename: H4LightPathScenario.getTypeName()},
    {id: "h5-hero-photo", typename: H5PhotoScenario.getTypeName()},
    {id: "h6-hero-put-back-and-reset", typename: H6PutBackResetScenario.getTypeName()},
    {id: "p1-hero-surface", typename: P1SurfaceScenario.getTypeName()},
    {id: "p2-hero-landing", typename: P2LandingScenario.getTypeName()},
    {id: "p3-hero-move", typename: P3MoveScenario.getTypeName()},
    {id: "p4-hero-hover", typename: P4HoverScenario.getTypeName()},
    {id: "p5-hero-solid-parts", typename: P5SolidPartsScenario.getTypeName()},
    {id: "p6-hero-candle-optics", typename: P6CandleOpticsScenario.getTypeName()},
    {id: "p7-hero-photo-print", typename: P7PhotoScenario.getTypeName()},
    {id: "p8-hero-clean-up", typename: P8CleanUpScenario.getTypeName()},
    {id: "helper-hero-layout", typename: HeroLayoutScenario.getTypeName()},
    {id: "r0-rp-model", typename: R0ModelScenario.getTypeName()},
    {id: "r1-rp-launch", typename: R1RpLaunchScenario.getTypeName()},
    {id: "r2-rp-move-turn", typename: R2RpMoveTurnScenario.getTypeName()},
    {id: "r3-rp-needle", typename: R3RpNeedleScenario.getTypeName()},
    {id: "r4-rp-sound", typename: R4RpSoundScenario.getTypeName()},
    {id: "r5-rp-sliders", typename: R5RpSlidersScenario.getTypeName()},
    {id: "r6-rp-lift", typename: R6RpLiftScenario.getTypeName()},
    {id: "r7-rp-apart", typename: R7RpApartScenario.getTypeName()},
    {id: "r8-rp-put-back-reset", typename: R8RpPutBackResetScenario.getTypeName()},
    {id: "helper-rp-capture", typename: RpCaptureScenario.getTypeName(), parameters: {beat: "rest", extraMs: ""}},
    {id: "helper-rp-model", typename: RpModelScenario.getTypeName(), parameters: {dx: "", dz: "", interior: "", hide: "", at: "", scale: "", yaw: ""}},
    {id: "l0-lamp-model", typename: L0LampModelScenario.getTypeName()},
    {id: "l1-lamp-launch", typename: L1LampLaunchScenario.getTypeName()},
    {id: "l2-lamp-move-turn", typename: L2LampMoveTurnScenario.getTypeName()},
    {id: "l3-lamp-switch", typename: L3LampSwitchScenario.getTypeName()},
    {id: "l4-lamp-shade", typename: L4LampShadeScenario.getTypeName()},
    {id: "helper-lamp-capture", typename: LampCaptureScenario.getTypeName(), parameters: {beat: "rest", extraMs: ""}},
    {id: "helper-lamp-model", typename: LampModelScenario.getTypeName(), parameters: {dx: "", dz: "", interior: "", hide: "", at: "", scale: "", yaw: ""}},
    {id: "helper-demo-play", typename: DemoPlayScenario.getTypeName(), parameters: {station: "recordPlayer", step: "", untilPhase: "", extraMs: "", layout: ""}}
  ]
}
