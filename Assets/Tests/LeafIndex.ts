import {scenariosIndex} from "Leaf.lspkg/Scenarios/decorator/ScenarioIndexDecorator"
import {ScenarioMetadata} from "Leaf.lspkg/Scenarios/scenario/ScenarioMetadata"
import {C1IdleAndGazeScenario} from "./C1IdleAndGazeScenario"
import {C2RecordPlayerScenario} from "./C2RecordPlayerScenario"
import {C3CameraScenario} from "./C3CameraScenario"
import {C3LampScenario} from "./C3LampScenario"
import {C4FinishAndStopScenario} from "./C4FinishAndStopScenario"
import {C5ResetScenario} from "./C5ResetScenario"
import {DemoPlayScenario} from "./DemoPlayScenario"

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
    {id: "helper-demo-play", typename: DemoPlayScenario.getTypeName(), parameters: {station: "recordPlayer"}}
  ]
}
