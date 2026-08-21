import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { createWorldEntity } from './worldEntity'
import { createWorldEntityProximityIndex, queryNearbyWorldEntities } from './worldEntityProximity'

describe('world entity proximity index', () => {
  it('returns living nearby entities in source order', () => {
    const definition = worldEntityDefinitionById.get('knight')!
    const origin = createWorldEntity(definition, { id: 'origin', transform: { x: 0, z: 0 } })
    const first = createWorldEntity(definition, { id: 'first', transform: { x: 3, z: 0 } })
    const second = createWorldEntity(definition, { id: 'second', transform: { x: -2, z: 0 } })
    const far = createWorldEntity(definition, { id: 'far', transform: { x: 20, z: 0 } })
    const defeated = { ...createWorldEntity(definition, { id: 'defeated', transform: { x: 1, z: 0 } }), health: 0 }
    const index = createWorldEntityProximityIndex([origin, first, second, far, defeated])
    expect(queryNearbyWorldEntities(index, origin, 4).map((entity) => entity.id)).toEqual(['first', 'second'])
  })
})
