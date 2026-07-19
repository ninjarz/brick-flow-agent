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
  | { type: 'interact'; target: WorldTargetRef }
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
    | 'combat-attack' | 'combat-hurt' | 'combat-victory' | 'revive-success' | 'revived'
  targetName?: string
  expiresAtSeconds: number
}

export type WorldEntity = {
  id: string
  definitionId: string
  kind: WorldEntityKind
  name: string
  description: string
  factionId: string
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
}

export type WorldStory = {
  id: string
  title: string
  body: string
  createdAtSeconds: number
  eventIds: string[]
  characterIds?: string[]
  chapterNumber?: number
  source: 'local' | 'ai'
}

export type WorldRelationship = {
  targetEntityId: string
  affinity: number
  encounters: number
  lastEventType: WorldEvent['type']
  updatedAtSeconds: number
}

export type WorldNarrativeState = {
  processedEventIds: string[]
  memoriesByEntityId: Record<string, WorldMemory[]>
  relationshipsByEntityId: Record<string, Record<string, WorldRelationship>>
  stories: WorldStory[]
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
  events: WorldEvent[]
  pendingImpacts: WorldPendingImpact[]
  narrative: WorldNarrativeState
}
