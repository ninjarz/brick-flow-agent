import { describe, expect, it } from 'vitest'
import type { WorldDirectorTurn } from '../types/world'
import {
  buildDirectorMessages,
  directorRecentRawTurnCount,
  getDirectorTurnsAfterMemory,
  parseDirectorCompactionSummary,
  planDirectorCompaction,
} from './worldDirectorContext'

const turn = (index: number): WorldDirectorTurn => ({
  id: `turn-${index}`,
  playerText: `玩家指令 ${index}`,
  requestMessage: `完整世界快照与玩家指令 ${index}`,
  responseMessage: `{"type":"end","summary":"结果 ${index}"}`,
  entries: [{ id: `entry-${index}`, type: 'end', summary: `结果 ${index}` }],
  createdAtSeconds: index,
  status: 'completed',
})

describe('world director context', () => {
  it('extends the exact previous request prefix with alternating messages', () => {
    const firstRequest = buildDirectorMessages({
      systemPrompt: 'stable system',
      turns: [],
      currentRequest: '完整世界快照与玩家指令 1',
    })
    const secondRequest = buildDirectorMessages({
      systemPrompt: 'stable system',
      turns: [turn(1)],
      currentRequest: '完整世界快照与玩家指令 2',
    })

    expect(secondRequest.slice(0, firstRequest.length)).toEqual(firstRequest)
    expect(secondRequest.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('compacts on the high-water mark while retaining recent raw turns', () => {
    const turns = Array.from({ length: 10 }, (_, index) => turn(index + 1))
    const plan = planDirectorCompaction({
      systemPrompt: 'stable system',
      turns,
      currentRequest: '继续',
    })

    expect(plan?.candidateTurns).toHaveLength(turns.length - directorRecentRawTurnCount)
    expect(plan?.retainedTurns.map((item) => item.id)).toEqual(['turn-7', 'turn-8', 'turn-9', 'turn-10'])
  })

  it('allows manual compaction below the automatic high-water mark', () => {
    const turns = Array.from({ length: 6 }, (_, index) => turn(index + 1))
    expect(planDirectorCompaction({
      systemPrompt: 'stable system',
      turns,
      currentRequest: '',
    })).toBeUndefined()
    expect(planDirectorCompaction({
      systemPrompt: 'stable system',
      turns,
      currentRequest: '',
      force: true,
    })?.candidateTurns.map((item) => item.id)).toEqual(['turn-1', 'turn-2'])
  })

  it('uses a memory checkpoint without deleting persisted older turns', () => {
    const turns = Array.from({ length: 8 }, (_, index) => turn(index + 1))
    const memory = {
      summary: '前四轮的事实摘要',
      throughTurnId: 'turn-4',
      sourceTurnCount: 4,
      updatedAtSeconds: 4,
    }

    expect(getDirectorTurnsAfterMemory(turns, memory).map((item) => item.id)).toEqual([
      'turn-5',
      'turn-6',
      'turn-7',
      'turn-8',
    ])
    expect(buildDirectorMessages({
      systemPrompt: 'stable system',
      memory,
      turns,
      currentRequest: '继续',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('前四轮的事实摘要') }),
      expect.objectContaining({ content: '完整世界快照与玩家指令 5' }),
    ]))
  })

  it('accepts fenced JSON compaction responses', () => {
    expect(parseDirectorCompactionSummary('```json\n{"summary":"保留线索"}\n```')).toBe('保留线索')
  })

  it('places locked facts in the persistent memory prefix', () => {
    const messages = buildDirectorMessages({
      systemPrompt: 'stable system',
      memory: {
        summary: '罗兰正在调查商队。',
        lockedFacts: ['罗兰是玩家角色', '黑岩使者尚未招供'],
        throughTurnId: 'turn-1',
        sourceTurnCount: 1,
        updatedAtSeconds: 1,
      },
      turns: [turn(1)],
      currentRequest: '继续',
    })

    expect(messages[1].content).toContain('罗兰是玩家角色')
    expect(messages[1].content).toContain('黑岩使者尚未招供')
  })
})
