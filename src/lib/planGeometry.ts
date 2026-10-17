import { brickById } from '../data/basicBricks'
import type { BuildPlan } from '../types/bricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'

// Structural validation must use the same precise geometry as the rendered scene.
export const preparePlanGeometry = (plan: BuildPlan) => loadLDrawGeneratedVisual(
  [...new Set(plan.bricks.flatMap((brick) => {
    const definition = brickById.get(brick.brickId)
    return definition?.pack === 'lego' ? [definition.partNumber] : []
  }))],
)
