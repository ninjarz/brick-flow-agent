import { describe, expect, it } from 'vitest'
import { worldEntityDefinitionById } from '../data/worldEntityDefinitions'
import { grantWorldClue, propagateWorldClueFromDialogue } from './worldClues'
import { createEmptyWorldState, createWorldEntity } from './worldEntity'

const knightDefinition = worldEntityDefinitionById.get('knight')!

describe('world clues', () => {
  it('upserts a shared clue while preserving the strongest confidence', () => {
    const narrative = createEmptyWorldState('clues').narrative
    const first = grantWorldClue(narrative, {
      id: 'arrow',
      holderId: 'eileen',
      text: '断箭上有黑岩纹章',
      kind: 'fact',
      confidence: 0.9,
      tags: ['断箭'],
      learnedAtSeconds: 2,
    })
    const second = grantWorldClue(first, {
      id: 'arrow',
      holderId: 'eileen',
      text: '断箭上有黑岩纹章',
      kind: 'fact',
      confidence: 0.6,
      tags: ['黑岩'],
      learnedAtSeconds: 4,
    })
    expect(second.cluesByEntityId.eileen).toHaveLength(1)
    expect(second.cluesByEntityId.eileen[0].confidence).toBe(0.9)
    expect(second.cluesByEntityId.eileen[0].tags).toEqual(['断箭', '黑岩'])
  })

  it('propagates a grounded clue through matching dialogue with confidence loss', () => {
    const speaker = createWorldEntity(knightDefinition, { id: 'speaker' })
    const listener = createWorldEntity(knightDefinition, { id: 'listener' })
    let world = { ...createEmptyWorldState('rumor'), elapsedSeconds: 10, entities: [speaker, listener] }
    world = {
      ...world,
      narrative: grantWorldClue(world.narrative, {
        id: 'quarry',
        holderId: speaker.id,
        text: '旧采石场藏着失踪商队',
        kind: 'fact',
        confidence: 0.95,
        tags: ['旧采石场', '失踪商队'],
        learnedAtSeconds: 1,
      }),
    }
    const propagated = propagateWorldClueFromDialogue(
      world,
      speaker.id,
      listener.id,
      '我在旧采石场看见了失踪商队。',
    )
    expect(propagated.narrative.cluesByEntityId[listener.id][0]).toMatchObject({
      id: 'quarry',
      holderId: listener.id,
      sourceEntityId: speaker.id,
    })
    expect(propagated.narrative.cluesByEntityId[listener.id][0].confidence).toBeLessThan(0.95)
  })

  it('does not leak a secret to an untrusted listener', () => {
    const speaker = createWorldEntity(knightDefinition, { id: 'speaker' })
    const listener = createWorldEntity(knightDefinition, { id: 'listener' })
    let world = { ...createEmptyWorldState('secret'), entities: [speaker, listener] }
    world = {
      ...world,
      narrative: grantWorldClue(world.narrative, {
        id: 'secret',
        holderId: speaker.id,
        text: '密门藏在旧采石场',
        kind: 'secret',
        confidence: 1,
        tags: ['密门', '旧采石场'],
        learnedAtSeconds: 0,
      }),
    }
    const propagated = propagateWorldClueFromDialogue(world, speaker.id, listener.id, '旧采石场有一扇密门。')
    expect(propagated).toBe(world)
  })
})
