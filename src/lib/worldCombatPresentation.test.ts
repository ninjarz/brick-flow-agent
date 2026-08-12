import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntity } from './worldEntity'
import { getWorldCombatPresentationPhase } from './worldCombatPresentation'

describe('combat presentation phase', () => {
  it('distinguishes windup, recovery and hurt without changing combat rules', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const entity = createWorldEntity(definition, { id: 'knight' })
    entity.behaviorState = 'attacking'
    entity.combat.cooldownRemainingSeconds = definition.combat.windupSeconds
    expect(getWorldCombatPresentationPhase(entity, definition, 1)).toBe('windup')
    entity.combat.cooldownRemainingSeconds = definition.combat.cooldownSeconds
    expect(getWorldCombatPresentationPhase(entity, definition, 1)).toBe('recover')
    entity.combat.damageIndicatorExpiresAtSeconds = 2
    expect(getWorldCombatPresentationPhase(entity, definition, 1)).toBe('hurt')
  })
})
