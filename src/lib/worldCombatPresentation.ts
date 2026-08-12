import type { WorldEntity } from '../types/world'
import type { WorldEntityDefinition } from '../types/world'

export type WorldCombatPresentationPhase = 'idle' | 'windup' | 'recover' | 'hurt' | 'defeated'

export const getWorldCombatPresentationPhase = (
  entity: WorldEntity,
  definition: WorldEntityDefinition | undefined,
  elapsedSeconds: number,
): WorldCombatPresentationPhase => {
  if (entity.health <= 0) return 'defeated'
  if ((entity.combat.damageIndicatorExpiresAtSeconds ?? 0) > elapsedSeconds) return 'hurt'
  if (entity.behaviorState !== 'attacking' && entity.behaviorState !== 'reviving') return 'idle'
  const windup = entity.behaviorState === 'reviving'
    ? definition?.support?.reviveWindupSeconds ?? 0
    : definition?.combat.windupSeconds ?? 0
  return entity.combat.cooldownRemainingSeconds <= windup + 0.001 ? 'windup' : 'recover'
}
