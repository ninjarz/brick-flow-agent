import type { WorldScenarioAiResolution } from './worldScenarioRuntime'
import type { WorldScenarioRuntime, WorldState } from '../types/world'

export const worldScenarioAiSystemPrompt = `You are the constrained scene writer inside an interactive story graph.
The authored graph owns triggers, legal branches, transitions, and world actions.
You may only write dialogue for existing allowed speakers and, when requested, choose one listed branch ID.
Never invent entities, IDs, coordinates, actions, outcomes, health changes, faction changes, or hidden facts not supported by context.
Return one JSON object and no extra text.`

const compactRecentStory = (world: WorldState) => [
  ...world.narrative.stories.slice(-4).map((story) => ({
    type: 'story',
    title: story.title,
    text: story.body.slice(0, 800),
  })),
  ...world.narrative.directorTurns.slice(-3).map((turn) => ({
    type: 'director',
    player: turn.playerText.slice(0, 400),
    result: [...turn.entries].reverse().find((entry) => entry.type === 'end')?.summary
      ?? turn.entries.filter((entry) => entry.type === 'dialogue').map((entry) => entry.text).join(' ').slice(0, 800),
  })),
].slice(-6)

export const buildWorldScenarioAiPrompt = (
  world: WorldState,
  scenario: WorldScenarioRuntime,
  locale: 'zh-CN' | 'en-US',
) => {
  const pending = scenario.pendingAi
  const stage = pending
    ? scenario.stages.find((candidate) => candidate.id === pending.stageId)
    : undefined
  if (!pending || !stage?.ai) return ''
  const event = world.events.find((candidate) => candidate.id === pending.eventId)
  const allowedSpeakerIds = stage.ai.speakerIds?.length
    ? stage.ai.speakerIds
    : scenario.castEntityIds ?? []
  const allowedSpeakers = world.entities
    .filter((entity) => allowedSpeakerIds.includes(entity.id))
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      description: entity.description,
      factionId: entity.factionId,
      health: `${entity.health}/${entity.maxHealth}`,
    }))
  const branches = stage.ai.mode === 'choice'
    ? (stage.branches ?? []).map((branch) => ({
        id: branch.id,
        title: branch.title,
        guidance: branch.aiGuidance ?? '',
      }))
    : []

  return `${locale === 'zh-CN' ? '用简体中文续写这个流程图节点。' : 'Continue this story-graph node in English.'}

FLOW:
${JSON.stringify({
    title: scenario.title,
    description: scenario.description,
    node: {
      id: stage.id,
      title: stage.title,
      description: stage.description,
      mode: stage.ai.mode,
      instruction: stage.ai.instruction,
    },
  })}

TRIGGER EVENT:
${JSON.stringify(event ?? { id: pending.eventId, type: stage.trigger.eventType })}

ALLOWED SPEAKERS:
${JSON.stringify(allowedSpeakers)}

LEGAL BRANCHES:
${JSON.stringify(branches)}

RECENT CANON:
${JSON.stringify(compactRecentStory(world))}

Return:
{"branchId":${stage.ai.mode === 'choice' ? '"one exact legal branch id"' : 'null'},"dialogue":[{"speakerId":"one allowed speaker id","text":"spoken line"}]}

Rules:
- Write 1 to ${Math.max(1, Math.min(6, stage.ai.maxDialogueLines ?? 3))} short dialogue lines.
- Dialogue must advance the node instruction without restating the entire recent canon.
- ${stage.ai.mode === 'choice' ? 'branchId is required and must exactly match one LEGAL BRANCHES id.' : 'Omit branchId.'}
- If context is insufficient, use the configured fallback direction and keep claims tentative.`
}

export const parseWorldScenarioAiResolution = (content: string): WorldScenarioAiResolution => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = (fenced ?? content).match(/\{[\s\S]*\}/)?.[0] ?? fenced ?? content
  try {
    const parsed = JSON.parse(candidate) as {
      branchId?: unknown
      dialogue?: unknown
    }
    const dialogue = Array.isArray(parsed.dialogue)
      ? parsed.dialogue.flatMap((line) => {
          if (!line || typeof line !== 'object') return []
          const speakerId = 'speakerId' in line ? line.speakerId : undefined
          const text = 'text' in line ? line.text : undefined
          const durationSeconds = 'durationSeconds' in line ? line.durationSeconds : undefined
          if (typeof speakerId !== 'string' || typeof text !== 'string') return []
          return [{
            speakerId,
            text,
            ...(typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
          }]
        })
      : []
    return {
      ...(typeof parsed.branchId === 'string' ? { branchId: parsed.branchId } : {}),
      dialogue,
    }
  } catch {
    return {}
  }
}
