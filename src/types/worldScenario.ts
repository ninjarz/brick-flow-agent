import type { BuildPlan } from './bricks'
import type { WorldScenarioRuntime, WorldState } from './world'

export type WorldScenarioAsset = {
  id: string
  title: string
  category: string
  description: string
  plan: BuildPlan
  world: WorldState
  scenario?: WorldScenarioRuntime
  additionalScenarios?: WorldScenarioRuntime[]
}

export type WorldScenarioLoadResult = {
  plan: BuildPlan
  world: WorldState
  importedBrickIds: string[]
  importedEntityIds: string[]
}
