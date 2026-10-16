import type { WorldScenarioRuntime, WorldScenarioStage, WorldState } from '../types/world'

export const resolveScenarioDialogue = (stage: WorldScenarioStage, active: NonNullable<WorldScenarioRuntime['activeDialogue']>) => (
  active.generatedDialogue ?? stage.branches?.find((branch) => branch.id === active.branchId)?.dialogue ?? stage.dialogue ?? []
)

export const visibleScenarioDialogue = (world: WorldState, stage: WorldScenarioStage, active: NonNullable<WorldScenarioRuntime['activeDialogue']>) => {
  const speakers = new Set(world.entities.map((entity) => entity.id))
  const hidden = new Set(world.hiddenTargets.filter((target) => target.kind === 'entity').map((target) => target.id))
  return resolveScenarioDialogue(stage, active).filter((line) => speakers.has(line.speakerId) && !hidden.has(line.speakerId))
}
