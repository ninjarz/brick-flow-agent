import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'

export type WorkspaceStorageValue = {
  schemaVersion: 2
  savedAt: number
  prompt: string
  plan: BuildPlan
  world: WorldState
}

export const createWorkspaceSerializer = (
  stringify: (value: unknown) => string = JSON.stringify,
) => {
  let cachedPlan: BuildPlan | undefined
  let cachedPlanJson = ''

  return (plan: BuildPlan, prompt: string, world: WorldState, inlineLimit: number, savedAt = Date.now()) => {
    if (cachedPlan !== plan) {
      cachedPlan = plan
      cachedPlanJson = stringify(plan)
    }
    const promptJson = stringify(prompt)
    const worldJson = stringify(world)
    const prefix = `{"schemaVersion":2,"savedAt":${savedAt},"prompt":${promptJson},"plan":`
    const middle = ',"world":'
    const totalLength = prefix.length + cachedPlanJson.length + middle.length + worldJson.length + 1
    const value: WorkspaceStorageValue = { schemaVersion: 2, savedAt, prompt, plan, world }
    return {
      value,
      totalLength,
      serialized: totalLength <= inlineLimit
        ? `${prefix}${cachedPlanJson}${middle}${worldJson}}`
        : undefined,
    }
  }
}
