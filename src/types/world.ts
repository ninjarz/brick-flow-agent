export type WorldEntityKind = 'actor' | 'vehicle' | 'projectile' | 'interactive' | 'effect'

export type WorldEntityControllerKind = 'rule' | 'player' | 'ai'

export type WorldTargetKind = 'entity' | 'brick' | 'structure' | 'waypoint'

export type WorldTargetRef =
  | { kind: 'entity'; id: string }
  | { kind: 'brick'; id: string }
  | { kind: 'structure'; id: string }
  | { kind: 'waypoint'; id: string }

export type WorldEntityCommand =
  | { type: 'stop' }
  | { type: 'wander'; seed?: number }
  | { type: 'move'; target: WorldTargetRef }
  | { type: 'attack'; target: Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }> }
  | { type: 'revive'; target: WorldTargetRef & { kind: 'entity' } }
  | { type: 'guard'; target: WorldTargetRef }
  | { type: 'follow'; target: WorldTargetRef & { kind: 'entity' } }
  | { type: 'interact'; target: WorldTargetRef; speechText?: string }
  | { type: 'patrol'; waypointIds: string[] }

export type WorldEntityTransform = {
  x: number
  y: number
  z: number
  rotationRadians: number
}

export type WorldEntityNavigationState = {
  status: 'idle' | 'planning' | 'moving' | 'blocked'
  target?: WorldTargetRef
  plannedTargetPoint?: { x: number; z: number }
  path: Array<{ x: number; y: number; z: number }>
  pathIndex: number
}

export type WorldEntitySpeech = {
  message: WorldEntityCommand['type'] | 'chat-greeting' | 'chat-question' | 'chat-support' | 'chat-reply' | 'chat-agree'
    | 'combat-attack' | 'combat-hurt' | 'combat-victory' | 'revive-success' | 'revived' | 'scenario-dialogue'
  text?: string
  targetName?: string
  expiresAtSeconds: number
}

export type WorldCharacterSpark = {
  /** A durable motivation. The simulation and director may pursue it, but never treat it as a command. */
  motive: string
  /** A few stable behavioral traits used to break ties between otherwise valid actions. */
  temperament: string
  /** A concise style guide for authored or AI-generated speech. */
  voice: string
  /** 0 = reactive, 1 = very likely to volunteer an action or line. */
  initiative: number
}

export type WorldEntityGoal = {
  summary: string
  source: 'seed' | 'player' | 'scenario' | 'ai'
  target?: WorldTargetRef
  commandType?: WorldEntityCommand['type']
  updatedAtSeconds: number
  status: 'active' | 'queued'
}

export type WorldEntity = {
  id: string
  definitionId: string
  kind: WorldEntityKind
  name: string
  description: string
  factionId: string
  partyId?: string
  storylineId?: string
  controller: WorldEntityControllerKind
  health: number
  maxHealth: number
  transform: WorldEntityTransform
  commandQueue: WorldEntityCommand[]
  activeCommand?: WorldEntityCommand
  navigation: WorldEntityNavigationState
  speech?: WorldEntitySpeech
  behaviorState: 'idle' | 'moving' | 'following' | 'guarding' | 'attacking' | 'reviving' | 'blocked' | 'dead'
  combat: {
    cooldownRemainingSeconds: number
    attackTargetId?: string
    lastAttackerId?: string
    lastDamagedAtSeconds?: number
    lastDamageAmount?: number
    damageIndicatorExpiresAtSeconds?: number
  }
  autonomy: {
    nextDecisionAtSeconds: number
    home: { x: number; z: number }
  }
  mind: {
    spark: WorldCharacterSpark
    /** Ordered short-term agenda. Index 0 is the only active goal; the rest are queued. */
    goals: WorldEntityGoal[]
  }
}

export type WorldParty = {
  id: string
  name: string
  leaderId: string
  members: Array<{
    entityId: string
    status: 'active' | 'reserve'
    joinedAtSeconds: number
  }>
}

export type WorldEvent = {
  id: string
  timeSeconds: number
  type: 'attack' | 'damage' | 'miss' | 'defeated' | 'revive' | 'brick-hit' | 'structure-hit' | 'interaction' | 'command-issued' | 'command-complete'
  actorId: string
  actorName?: string
  targetId?: string
  targetName?: string
  amount?: number
  commandType?: WorldEntityCommand['type']
  commandSource?: WorldEntityControllerKind
  dialogueText?: string
  dialogueSpeakerId?: string
  dialogueListenerId?: string
  projectileKind?: 'arrow' | 'stone'
  origin?: { x: number; y: number; z: number }
  impactPoint?: { x: number; y: number; z: number }
}

export type WorldPendingImpact = {
  id: string
  actorId: string
  target: Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }>
  damage: number
  projectileKind: 'arrow' | 'stone'
  impactAtSeconds: number
  impactPoint: { x: number; y: number; z: number }
}

export type WorldMemory = {
  id: string
  eventId: string
  entityId: string
  timeSeconds: number
  type: WorldEvent['type']
  otherId?: string
  otherName?: string
  importance: 1 | 2 | 3
  /** Human-readable event residue used by local relevance retrieval. */
  content?: string
  tags?: string[]
}

export type WorldClue = {
  /** Shared semantic ID. Copies passed between characters keep the same ID. */
  id: string
  holderId: string
  text: string
  kind: 'fact' | 'rumor' | 'secret'
  confidence: number
  tags: string[]
  learnedAtSeconds: number
  sourceEntityId?: string
  sourceEventId?: string
}

export type WorldStory = {
  id: string
  title: string
  body: string
  blocks?: WorldStoryBlock[]
  createdAtSeconds: number
  eventIds: string[]
  characterIds?: string[]
  chapterNumber?: number
  source: 'local' | 'ai'
}

export type WorldStoryBlock =
  | { type: 'narration'; text: string }
  | { type: 'dialogue'; speakerId: string; text: string }

export type WorldRelationship = {
  targetEntityId: string
  affinity: number
  trust?: number
  hostility?: number
  fear?: number
  repeatedInteractionCount?: number
  encounters: number
  lastEventType: WorldEvent['type']
  updatedAtSeconds: number
}

export type WorldDirectorEvent =
  | { type: 'narration'; text: string }
  | { type: 'dialogue'; speakerId: string; listenerId?: string; text: string }
  | { type: 'command'; entityId: string; command: WorldEntityCommand }
  | { type: 'relationship'; fromId: string; toId: string; delta: number; reason: string }
  | { type: 'choice'; label: string; suggestedInput: string }
  | { type: 'end'; summary: string }

export type WorldDirectorEntry = WorldDirectorEvent & {
  id: string
  status?: 'accepted' | 'rejected'
  detail?: string
  before?: number
  after?: number
}

export type WorldDirectorTurn = {
  id: string
  playerText: string
  origin?: 'player' | 'autonomous'
  entries: WorldDirectorEntry[]
  reasoning?: string
  requestMessage?: string
  responseMessage?: string
  validationIssues?: Array<{
    lineNumber: number
    code: string
    raw: string
  }>
  contextStats?: {
    messageCount: number
    estimatedInputTokens: number
    rawTurnCount: number
    memoryTurnCount: number
    compactionTriggered?: boolean
    inputTokens?: number
    outputTokens?: number
    cachedTokens?: number
    totalTokens?: number
    maxOutputTokens?: number
    responseRetryCount?: number
    finishReason?: string
  }
  createdAtSeconds: number
  status: 'completed' | 'stopped' | 'failed'
  error?: string
  checkpoint?: WorldDirectorCheckpoint
}

export type WorldDirectorMemory = {
  summary: string
  lockedFacts?: string[]
  throughTurnId: string
  sourceTurnCount: number
  updatedAtSeconds: number
}

export type WorldNarrativeState = {
  processedEventIds: string[]
  memoriesByEntityId: Record<string, WorldMemory[]>
  cluesByEntityId: Record<string, WorldClue[]>
  relationshipsByEntityId: Record<string, Record<string, WorldRelationship>>
  stories: WorldStory[]
  directorTurns: WorldDirectorTurn[]
  directorMemory?: WorldDirectorMemory
}

export type WorldScenarioTrigger = {
  eventType: WorldEvent['type']
  actorId?: string
  targetId?: string
  commandType?: WorldEntityCommand['type']
  minimumAffinity?: number
  conditions?: WorldScenarioConditionGroup
}

export type WorldScenarioCondition =
  | { type: 'affinity'; actorId: string; targetId: string; comparison: 'gte' | 'lte'; value: number }
  | { type: 'health-ratio'; entityId: string; comparison: 'gte' | 'lte'; value: number }
  | { type: 'faction'; entityId: string; factionId: string }
  | { type: 'party-member'; entityId: string; leaderId?: string; status?: 'active' | 'reserve' }
  | { type: 'clue'; entityId: string; clueId: string; minimumConfidence?: number }
  | { type: 'scenario-outcome'; scenarioId: string; outcomeId?: string }
  | { type: 'visibility'; target: Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }>; visible: boolean }
  | { type: 'entity-alive'; entityId: string; alive: boolean }

export type WorldScenarioConditionGroup = {
  mode: 'all' | 'any'
  negate?: boolean
  conditions: WorldScenarioCondition[]
}

export type WorldScenarioAction = (
  { type: 'set-faction'; entityId: string; factionId: string }
  | { type: 'join-party'; entityId: string; leaderId: string; partyName?: string; status?: 'active' | 'reserve' }
  | { type: 'leave-party'; entityId: string }
  | { type: 'issue-command'; entityId: string; command: WorldEntityCommand }
  | { type: 'add-story'; title: string; body: string; characterIds?: string[] }
  | {
      type: 'grant-clue'
      entityId: string
      clue: Pick<WorldClue, 'id' | 'text' | 'kind' | 'confidence' | 'tags'>
    }
  | { type: 'set-visibility'; target: Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }>; visible: boolean }
) & {
  /** Delay after the previous action before this action is applied. */
  delaySeconds?: number
}

export type WorldScenarioDialogueLine = {
  id: string
  speakerId: string
  text: string
  durationSeconds: number
}

export type WorldScenarioDialogueState = {
  stageId: string
  eventId: string
  branchId?: string
  generatedDialogue?: WorldScenarioDialogueLine[]
  source?: 'authored' | 'ai'
  lineIndex: number
  lineEndsAtSeconds: number
}

export type WorldScenarioTimelineState = {
  stageId: string
  eventId: string
  branchId?: string
  generatedDialogue?: WorldScenarioDialogueLine[]
  source?: 'authored' | 'ai'
  actionIndex: number
  nextActionAtSeconds: number
}

export type WorldScenarioBranch = {
  id: string
  title: string
  aiGuidance?: string
  trigger: WorldScenarioTrigger
  nextStageId?: string
  dialogue?: WorldScenarioDialogueLine[]
  actions?: WorldScenarioAction[]
}

export type WorldScenarioAiConfig = {
  mode: 'dialogue' | 'choice'
  instruction: string
  speakerIds?: string[]
  maxDialogueLines?: number
  fallbackBranchId?: string
}

export type WorldScenarioAiPendingState = {
  stageId: string
  eventId: string
  branchId?: string
  requestedAtSeconds: number
}

export type WorldScenarioStage = {
  id: string
  title: string
  description: string
  status: 'locked' | 'active' | 'completed'
  trigger: WorldScenarioTrigger
  ai?: WorldScenarioAiConfig
  dialogue?: WorldScenarioDialogueLine[]
  actions?: WorldScenarioAction[]
  nextStageId?: string | null
  branches?: WorldScenarioBranch[]
  completedAtSeconds?: number
}

export type WorldScenarioRuntime = {
  id: string
  assetId: string
  title: string
  description: string
  enabled?: boolean
  priority?: number
  mutexGroup?: string
  castEntityIds?: string[]
  stages: WorldScenarioStage[]
  processedEventIds: string[]
  claimedEventIds?: string[]
  pendingAi?: WorldScenarioAiPendingState
  activeDialogue?: WorldScenarioDialogueState
  activeTimeline?: WorldScenarioTimelineState
  queuedTransition?: {
    stageId: string
    eventId: string
    branchId?: string
    queuedAtSeconds: number
  }
  outcomeId?: string
  authoringVersion?: number
}

export type WorldEntityBody =
  | {
      shape: 'capsule'
      radiusStuds: number
      heightStuds: number
      eyeHeightStuds: number
      attackOriginHeightStuds: number
    }
  | {
      shape: 'box'
      widthStuds: number
      heightStuds: number
      depthStuds: number
      eyeHeightStuds: number
      attackOriginHeightStuds: number
    }

export type WorldEntityDefinition = {
  id: string
  displayName: string
  description: string
  kind: WorldEntityKind
  role: 'melee' | 'ranged' | 'siege' | 'civilian' | 'utility'
  nameCandidates: string[]
  visual: {
    kind: 'brick-assembly' | 'minifigure' | 'custom-model'
    heightStuds: number
    widthStuds: number
    depthStuds: number
  }
  body: WorldEntityBody
  movement: {
    speedStudsPerSecond: number
    turningRadiansPerSecond: number
    turningRadiusStuds: number
  }
  perception: {
    detectionRangeStuds: number
  }
  combat: {
    maxHealth: number
    attackRangeStuds: number
    minimumRangeStuds?: number
    damage: number
    windupSeconds: number
    cooldownSeconds: number
    projectileKind?: 'arrow' | 'stone'
  }
  support?: {
    reviveRangeStuds: number
    reviveHealthRatio: number
    reviveWindupSeconds: number
    reviveCooldownSeconds: number
  }
}

export type WorldState = {
  id: string
  planId: string
  randomSeed: number
  elapsedSeconds: number
  paused: boolean
  entities: WorldEntity[]
  parties: WorldParty[]
  events: WorldEvent[]
  pendingImpacts: WorldPendingImpact[]
  narrative: WorldNarrativeState
  scenarios: WorldScenarioRuntime[]
  hiddenTargets: Array<Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }>>
}

export type WorldDirectorCheckpoint = Omit<WorldState, 'narrative'> & {
  narrative: Omit<WorldNarrativeState, 'directorTurns'>
  directorTurnIds: string[]
}
