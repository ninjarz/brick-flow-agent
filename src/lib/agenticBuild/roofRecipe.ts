import { normalizeYStud } from '../brickUnits'
import { getComponentCompletionIssue, type ComponentCompletion } from './completion'
import { applyAgentAction, type AgentPrimitive, type BuildState } from './executor'

type RoofCompletion = Extract<ComponentCompletion, { kind: 'roof' }>

/** Trial builds use the same placement rules as model actions. Only a complete trial can change the live state. */
export const tryRoofRecipe = (state: BuildState, target: RoofCompletion) => {
  const { recipe, x, y, z, width, depth } = target
  if (!recipe) return undefined
  const size = [width, depth]
  const deck: AgentPrimitive = { kind: 'deck', x, y, z, size, color: recipe.color }
  const attempts: AgentPrimitive[][] = [[deck]]
  if (recipe.style === 'gable') {
    const gable: AgentPrimitive = { kind: 'slope-roof', x, y, z, size, ridge: recipe.ridge, color: recipe.color, gableColor: recipe.gableColor }
    attempts[0] = [gable]
    if (recipe.supportDeck) attempts.push([deck, { ...gable, y: normalizeYStud(y + 0.8) }])
  }

  for (const items of attempts) {
    const trial: BuildState = { bricks: [...state.bricks], nextId: state.nextId }
    const result = applyAgentAction(trial, { action: 'place', items })
    if (!result.ok || !result.placedIds.length || getComponentCompletionIssue(target, trial.bricks, new Set(result.placedIds))) continue
    state.bricks = trial.bricks
    state.nextId = trial.nextId
    return result
  }
  return undefined
}
