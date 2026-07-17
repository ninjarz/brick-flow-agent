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
  | { type: 'move'; target: WorldTargetRef }
  | { type: 'attack'; target: Extract<WorldTargetRef, { kind: 'entity' | 'brick' | 'structure' }> }
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
  path: Array<{ x: number; y: number; z: number }>
  pathIndex: number
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
  behaviorState: 'idle' | 'moving' | 'attacking' | 'blocked' | 'dead'
  combat: {
    cooldownRemainingSeconds: number
  }
}

export type WorldEvent = {
  id: string
  timeSeconds: number
  type: 'attack' | 'damage' | 'defeated' | 'brick-hit' | 'structure-hit' | 'command-complete'
  actorId: string
  targetId?: string
  amount?: number
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
  combat: {
    maxHealth: number
    attackRangeStuds: number
    damage: number
    cooldownSeconds: number
    projectileKind?: 'arrow' | 'stone'
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
}
