import type { WorldState } from '../types/world'
import { rankWorldCognitionCandidates } from './worldCognition'

export const continuousDirectorPulseIntervalMs = 6_000
export const continuousDirectorPollIntervalMs = 1_000

export const getContinuousDirectorBackoffMs = (failureCount: number) => (
  Math.min(60_000, continuousDirectorPulseIntervalMs * (2 ** Math.max(0, failureCount)))
)

export const getContinuousDirectorCadenceMs = (world: WorldState) => {
  const recentEvent = world.events.at(-1)
  if (recentEvent && world.elapsedSeconds - recentEvent.timeSeconds <= 3) return 4_000
  const candidates = rankWorldCognitionCandidates(world, 4)
  if (candidates.some((candidate) => candidate.reasons.some((reason) => (
    reason === 'blocked' || reason === 'threatened' || reason === 'recent-event'
  )))) return 4_000
  if (candidates.some((candidate) => candidate.reasons.includes('active-focus'))) return 8_000
  return 14_000
}

export const shouldRunContinuousDirectorPulse = ({
  enabled,
  llmConfigured,
  worldPaused,
  directorThinking,
  llmTesting,
  scenarioPerformanceActive,
  inputInProgress,
  now,
  nextAllowedAt,
}: {
  enabled: boolean
  llmConfigured: boolean
  worldPaused: boolean
  directorThinking: boolean
  llmTesting: boolean
  scenarioPerformanceActive: boolean
  inputInProgress: boolean
  now: number
  nextAllowedAt: number
}) => (
  enabled
  && llmConfigured
  && !worldPaused
  && !directorThinking
  && !llmTesting
  && !scenarioPerformanceActive
  && !inputInProgress
  && now >= nextAllowedAt
)

export const buildContinuousDirectorIntent = (
  locale: 'zh-CN' | 'en-US',
  elapsedSeconds: number,
) => locale === 'zh-CN'
  ? `自动世界导演脉冲（世界时间 ${elapsedSeconds.toFixed(1)} 秒）：观察所有可见且存活的角色，但先查看 cognitionCandidates，只让真正需要重新判断的角色行动。结合角色的长期动机、当前意图、聚焦记忆、私有线索、关系、队伍和最近事件生成高层命令，也可以安排简短对白。角色不能使用自己不知道的线索；低可信传闻只能作为猜测。不要重复仍在执行的命令，不要为了凑数让所有人闲聊。没有必要时允许只输出 end。让行为自然推进当前剧情，并以 end 总结本次脉冲。`
  : `Autonomous world-director pulse (world time ${elapsedSeconds.toFixed(1)}s): inspect cognitionCandidates first and act only for characters who genuinely need to reconsider. Combine each character's motive, current focus, focused memories, private clues, relationships, party, and recent events into high-level commands or brief dialogue. A character cannot use a clue they do not know, and low-confidence rumors remain suspicions. Do not repeat active orders or make everyone chat to fill space. It is valid to output only end. Advance the story naturally and finish this pulse with end.`
