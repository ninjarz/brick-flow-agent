import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import type { WorldEntity, WorldEvent } from '../types/world'

export type WorldProjectileVisual = {
  id: string
  kind: 'arrow' | 'stone'
  createdAtSeconds: number
  lifetimeSeconds: number
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  arcHeightStuds: number
}

export const getWorldProjectileVisuals = (
  events: WorldEvent[],
  entities: WorldEntity[],
  elapsedSeconds: number,
) => {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]))
  return events.flatMap((event): WorldProjectileVisual[] => {
    if (event.type !== 'attack' || !event.targetId) return []
    const actor = entitiesById.get(event.actorId)
    const target = entitiesById.get(event.targetId)
    const actorDefinition = actor ? worldEntityDefinitionById.get(actor.definitionId) : undefined
    const targetDefinition = target ? worldEntityDefinitionById.get(target.definitionId) : undefined
    const kind = actorDefinition?.combat.projectileKind
    if (!actor || !target || !kind) return []
    const distance = Math.hypot(target.transform.x - actor.transform.x, target.transform.z - actor.transform.z)
    const lifetimeSeconds = kind === 'arrow'
      ? Math.max(0.22, Math.min(0.75, distance / 18))
      : Math.max(0.55, Math.min(1.35, distance / 10))
    if (elapsedSeconds - event.timeSeconds > lifetimeSeconds + 0.15) return []
    return [{
      id: event.id,
      kind,
      createdAtSeconds: event.timeSeconds,
      lifetimeSeconds,
      start: {
        x: actor.transform.x,
        y: actor.transform.y + actorDefinition.body.attackOriginHeightStuds,
        z: actor.transform.z,
      },
      end: {
        x: target.transform.x,
        y: target.transform.y + (targetDefinition?.body.heightStuds ?? 2) * 0.55,
        z: target.transform.z,
      },
      arcHeightStuds: kind === 'stone' ? Math.max(2.2, distance * 0.28) : Math.min(0.45, distance * 0.03),
    }]
  })
}

export const sampleWorldProjectilePosition = (projectile: WorldProjectileVisual, elapsedSeconds: number) => {
  const progress = Math.max(0, Math.min(1, (elapsedSeconds - projectile.createdAtSeconds) / projectile.lifetimeSeconds))
  return {
    x: projectile.start.x + (projectile.end.x - projectile.start.x) * progress,
    y: projectile.start.y + (projectile.end.y - projectile.start.y) * progress + Math.sin(Math.PI * progress) * projectile.arcHeightStuds,
    z: projectile.start.z + (projectile.end.z - projectile.start.z) * progress,
    progress,
  }
}
