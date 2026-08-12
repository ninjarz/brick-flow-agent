import { describe, expect, it } from 'vitest'
import { resolveDirectorIntentReferences, resolveDirectorIntentTarget } from './worldDirectorIntent'

const entities = [
  { id: 'roland', name: '罗兰', description: '守卫酒馆的骑士' },
  { id: 'envoy', name: '黑岩使者', description: '酒馆外沉默的陌生武士' },
  { id: 'guard', name: '北路斥候', description: '北路归来的骑士' },
]

describe('director intent target resolution', () => {
  it('keeps all explicit references and selects the final mention as the likely target', () => expect(resolveDirectorIntentReferences('让罗兰攻击黑岩使者', entities)).toMatchObject({ status: 'resolved', primary: { id: 'envoy' }, mentions: [{ id: 'roland' }, { id: 'envoy' }] }))
  it('resolves a unique descriptive reference', () => expect(resolveDirectorIntentTarget('询问那个陌生武士', entities)).toMatchObject({ status: 'resolved', entityId: 'envoy' }))
  it('does not guess an absent target', () => expect(resolveDirectorIntentTarget('四处看看', entities).status).toBe('none'))
})
