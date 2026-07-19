import type { BuildPlan } from './bricks'
import type { WorldState } from './world'

export type WorldScenarioAsset = {
  id: string
  title: string
  category: string
  description: string
  plan: BuildPlan
  world: WorldState
}

export type WorldScenarioLoadResult = {
  plan: BuildPlan
  world: WorldState
  importedBrickIds: string[]
  importedEntityIds: string[]
}
