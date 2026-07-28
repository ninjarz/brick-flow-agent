import type { LlmChatMessage } from './llmGenerator'
import type { WorldDirectorEntry, WorldDirectorMemory, WorldDirectorTurn } from '../types/world'

export const directorRecentRawTurnCount = 4
export const directorCompactionTurnThreshold = 10
export const directorHistoryTokenThreshold = 8_000
export const directorTotalTokenThreshold = 16_000

const compactEntry = (entry: WorldDirectorEntry) => {
  if (entry.type === 'narration') return { type: entry.type, text: entry.text }
  if (entry.type === 'dialogue') {
    return {
      type: entry.type,
      speakerId: entry.speakerId,
      ...(entry.listenerId ? { listenerId: entry.listenerId } : {}),
      text: entry.text,
    }
  }
  if (entry.type === 'command') return { type: entry.type, entityId: entry.entityId, command: entry.command }
  if (entry.type === 'relationship') {
    return {
      type: entry.type,
      fromId: entry.fromId,
      toId: entry.toId,
      delta: entry.delta,
      reason: entry.reason,
    }
  }
  if (entry.type === 'choice') return { type: entry.type, label: entry.label, suggestedInput: entry.suggestedInput }
  return { type: entry.type, summary: entry.summary }
}

export const serializeDirectorAssistantMessage = (turn: WorldDirectorTurn) => (
  turn.responseMessage?.trim()
  || turn.entries.map((entry) => JSON.stringify(compactEntry(entry))).join('\n')
)

export const getDirectorTurnsAfterMemory = (
  turns: WorldDirectorTurn[],
  memory?: WorldDirectorMemory,
) => {
  if (!memory) return turns
  const checkpointIndex = turns.findIndex((turn) => turn.id === memory.throughTurnId)
  return checkpointIndex >= 0 ? turns.slice(checkpointIndex + 1) : turns
}

export const buildDirectorMessages = ({
  systemPrompt,
  memory,
  turns,
  currentRequest,
}: {
  systemPrompt: string
  memory?: WorldDirectorMemory
  turns: WorldDirectorTurn[]
  currentRequest: string
}): LlmChatMessage[] => {
  const messages: LlmChatMessage[] = [{ role: 'system', content: systemPrompt }]
  if (memory?.summary.trim()) {
    messages.push({
      role: 'user',
      content: `Compacted story memory checkpoint. Treat these established facts as prior conversation:\n${memory.summary.trim()}`,
    })
    messages.push({
      role: 'assistant',
      content: 'Memory checkpoint acknowledged. I will preserve these established facts and continue from the recent turns.',
    })
  }
  for (const turn of getDirectorTurnsAfterMemory(turns, memory)) {
    const assistantMessage = serializeDirectorAssistantMessage(turn)
    if (!assistantMessage) continue
    messages.push({
      role: 'user',
      content: turn.requestMessage?.trim() || `Player direction from an earlier turn:\n${turn.playerText}`,
    })
    messages.push({ role: 'assistant', content: assistantMessage })
  }
  messages.push({ role: 'user', content: currentRequest })
  return messages
}

export const estimateDirectorTokens = (text: string) => {
  const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  return Math.ceil(cjkCount + (text.length - cjkCount) / 4)
}

export const estimateDirectorMessagesTokens = (messages: LlmChatMessage[]) => (
  messages.reduce((total, message) => total + 4 + estimateDirectorTokens(message.content), 2)
)

export type DirectorCompactionPlan = {
  candidateTurns: WorldDirectorTurn[]
  retainedTurns: WorldDirectorTurn[]
  estimatedHistoryTokens: number
  estimatedTotalTokens: number
}

export const planDirectorCompaction = ({
  systemPrompt,
  memory,
  turns,
  currentRequest,
}: {
  systemPrompt: string
  memory?: WorldDirectorMemory
  turns: WorldDirectorTurn[]
  currentRequest: string
}): DirectorCompactionPlan | undefined => {
  const activeTurns = getDirectorTurnsAfterMemory(turns, memory)
  if (activeTurns.length <= directorRecentRawTurnCount) return undefined
  const candidateTurns = activeTurns.slice(0, -directorRecentRawTurnCount)
  const retainedTurns = activeTurns.slice(-directorRecentRawTurnCount)
  const historyMessages = buildDirectorMessages({
    systemPrompt,
    memory,
    turns,
    currentRequest: '',
  }).slice(0, -1)
  const estimatedHistoryTokens = estimateDirectorMessagesTokens(historyMessages)
  const estimatedTotalTokens = estimateDirectorMessagesTokens([
    ...historyMessages,
    { role: 'user', content: currentRequest },
  ])
  const shouldCompact = (
    activeTurns.length >= directorCompactionTurnThreshold
    || estimatedHistoryTokens >= directorHistoryTokenThreshold
    || estimatedTotalTokens >= directorTotalTokenThreshold
  )
  return shouldCompact
    ? { candidateTurns, retainedTurns, estimatedHistoryTokens, estimatedTotalTokens }
    : undefined
}

export const buildDirectorCompactionPrompt = (
  memory: WorldDirectorMemory | undefined,
  turns: WorldDirectorTurn[],
  locale: 'zh-CN' | 'en-US',
) => `${locale === 'zh-CN' ? '压缩以下互动剧情历史，供后续导演模型继续故事。' : 'Compact this interactive story history for a later director model.'}

${locale === 'zh-CN' ? '已有摘要' : 'Existing summary'}:
${memory?.summary || 'none'}

${locale === 'zh-CN' ? '待压缩轮次' : 'Turns to compact'}:
${JSON.stringify(turns.map((turn) => ({
  player: turn.playerText,
  events: turn.entries.map(compactEntry),
})))}

${locale === 'zh-CN'
    ? '返回 JSON：{"summary":"..."}。摘要必须保留角色身份与目标、已确认事实、关系变化、承诺、冲突结果、未解决线索、已触发或隐藏要素、玩家的重要选择。不要把意图写成已经成功的结果，不要虚构坐标或 ID。控制在 1200 个汉字以内。'
    : 'Return JSON: {"summary":"..."}. Preserve character identities and goals, established facts, relationship changes, promises, conflict outcomes, unresolved clues, revealed or hidden elements, and important player choices. Do not turn attempted actions into successful outcomes or invent coordinates or IDs. Stay under 1800 words.'}`

export const createFallbackDirectorSummary = (
  memory: WorldDirectorMemory | undefined,
  turns: WorldDirectorTurn[],
  locale: 'zh-CN' | 'en-US',
) => {
  const lines = turns.flatMap((turn) => {
    const ending = [...turn.entries].reverse().find((entry) => entry.type === 'end')
    const dialogue = turn.entries
      .filter((entry) => entry.type === 'dialogue')
      .map((entry) => `${entry.speakerId}: ${entry.text}`)
      .join('；')
    return [
      `${locale === 'zh-CN' ? '玩家' : 'Player'}: ${turn.playerText}`,
      ending?.type === 'end' ? ending.summary : dialogue,
    ].filter(Boolean)
  })
  return [memory?.summary, ...lines].filter(Boolean).join('\n').slice(0, 4_000)
}

export const parseDirectorCompactionSummary = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? content).match(/\{[\s\S]*\}/)?.[0] ?? fenced ?? content
  try {
    const parsed = JSON.parse(candidate) as { summary?: unknown }
    return typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 4_000) : ''
  } catch {
    return ''
  }
}
