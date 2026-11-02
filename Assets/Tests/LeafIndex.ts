import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {C1IdleAndGazeScenario} from "./C1IdleAndGazeScenario"
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
    {id: "helper-demo-play", typename: DemoPlayScenario.getTypeName(), parameters: {station: "recordPlayer", step: "", untilPhase: "", extraMs: ""}}
  ]
}
