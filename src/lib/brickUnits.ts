import type {
  BrickConnector,
  BrickDefinition,
  BrickFootprint,
  BrickPose,
  BrickRotationQuarterTurns,
  BrickVerticalQuarterTurns,
} from '../types/bricks'

export const STUD_PITCH_WORLD = 1
export const PLATE_HEIGHT_WORLD = 2 / 5
export const WORLD_EDIT_STEP_STUDS = 1 / 5
export const WORLD_SNAP_STEP_STUDS = 1 / 10
export const HORIZONTAL_EDIT_STEP_STUDS = WORLD_EDIT_STEP_STUDS
export const HORIZONTAL_SNAP_STEP_STUDS = WORLD_SNAP_STEP_STUDS

type WorldPoint = {
  x: number
  y: number
  z: number
}

type WorldVector = WorldPoint

export const normalizeQuarterTurns = (
  turns: number,
): BrickRotationQuarterTurns => (((turns % 4) + 4) % 4) as BrickRotationQuarterTurns

export const normalizeVerticalQuarterTurns = (
  turns: number,
): BrickVerticalQuarterTurns => (((turns % 4) + 4) % 4) as BrickVerticalQuarterTurns

export const roundToGrid = (value: number, step: number) => {
  if (!Number.isFinite(value)) return 0
  return Number((Math.round(value / step) * step).toFixed(6))
}

export const normalizeHorizontalStud = (value: number) =>
  roundToGrid(value, WORLD_SNAP_STEP_STUDS)

export const normalizeEditableStud = (value: number) =>
  roundToGrid(value, WORLD_EDIT_STEP_STUDS)

export const isHorizontalStudOnGrid = (value: number) =>
  Math.abs(value - normalizeHorizontalStud(value)) < 0.000001

export const normalizeWorldStud = (value: number) =>
  Math.max(0, roundToGrid(Number.isFinite(value) ? value : 0, WORLD_SNAP_STEP_STUDS))

export const isWorldStudOnGrid = (value: number) =>
  Math.abs(value - normalizeWorldStud(value)) < 0.000001

export const normalizeYStud = normalizeWorldStud

export const isYStudOnGrid = isWorldStudOnGrid

export const plateHeightToWorldStud = (value: number) =>
  normalizeWorldStud(value * PLATE_HEIGHT_WORLD)

export const legoPlateFootprint = (widthStuds: number, depthStuds: number, heightPlates: number): BrickFootprint => ({
  widthStuds,
  depthStuds,
  heightStuds: plateHeightToWorldStud(heightPlates),
})

export const poseToWorld = (pose: BrickPose) => ({
  x: pose.xStud * STUD_PITCH_WORLD,
  y: pose.yStud * STUD_PITCH_WORLD,
  z: pose.zStud * STUD_PITCH_WORLD,
})

const getVerticalSize = (definition: BrickDefinition, verticalQuarterTurns: BrickVerticalQuarterTurns) => {
  const isVertical = verticalQuarterTurns % 2 === 1
  const baseHeightStuds = definition.footprint.heightStuds

  return {
    widthStuds: definition.footprint.widthStuds,
    depthStuds: isVertical ? baseHeightStuds : definition.footprint.depthStuds,
    heightStuds: isVertical ? definition.footprint.depthStuds : baseHeightStuds,
  }
}

export const footprintToWorld = (
  definition: BrickDefinition,
  rotationQuarterTurns: BrickRotationQuarterTurns,
  verticalQuarterTurns: BrickVerticalQuarterTurns = 0,
) => {
  const vertical = getVerticalSize(definition, verticalQuarterTurns)
  const rotated = rotationQuarterTurns % 2 === 1
  const widthStuds = rotated ? vertical.depthStuds : vertical.widthStuds
  const depthStuds = rotated ? vertical.widthStuds : vertical.depthStuds

  return {
    width: widthStuds * STUD_PITCH_WORLD,
    depth: depthStuds * STUD_PITCH_WORLD,
    height: vertical.heightStuds * STUD_PITCH_WORLD,
    widthStuds,
    depthStuds,
    heightStuds: vertical.heightStuds,
  }
}

export const getBrickWorldFrame = (definition: BrickDefinition, pose: BrickPose) => {
  const footprint = footprintToWorld(definition, pose.rotationQuarterTurns, pose.verticalQuarterTurns ?? 0)
  const origin = poseToWorld(pose)

  return {
    ...footprint,
    x: origin.x + footprint.width / 2,
    y: origin.y + footprint.height / 2,
    z: origin.z + footprint.depth / 2,
  }
}

const axisVector: Record<BrickConnector['axis'], WorldPoint> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
}

const normaliseVector = (vector: WorldVector): WorldVector => {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
  if (length === 0) return { x: 0, y: 1, z: 0 }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  }
}

const vectorToAxis = (vector: WorldPoint): BrickConnector['axis'] => {
  const magnitudes = [
    { axis: 'x' as const, value: Math.abs(vector.x) },
    { axis: 'y' as const, value: Math.abs(vector.y) },
    { axis: 'z' as const, value: Math.abs(vector.z) },
  ].sort((source, target) => target.value - source.value)

  return magnitudes[0].axis
}

const rotateVerticalPoint = (
  point: WorldPoint,
  verticalQuarterTurns: BrickVerticalQuarterTurns,
  footprint: BrickFootprint,
) => {
  const height = footprint.heightStuds
  const depth = footprint.depthStuds

  switch (verticalQuarterTurns) {
    case 1:
      return { x: point.x, y: point.z, z: height - point.y }
    case 2:
      return { x: point.x, y: height - point.y, z: depth - point.z }
    case 3:
      return { x: point.x, y: depth - point.z, z: point.y }
    default:
      return point
  }
}

const rotateVerticalVector = (
  vector: WorldVector,
  verticalQuarterTurns: BrickVerticalQuarterTurns,
) => {
  switch (verticalQuarterTurns) {
    case 1:
      return { x: vector.x, y: vector.z, z: -vector.y }
    case 2:
      return { x: vector.x, y: -vector.y, z: -vector.z }
    case 3:
      return { x: vector.x, y: -vector.z, z: vector.y }
    default:
      return vector
  }
}

const rotateYawPoint = (
  point: WorldPoint,
  rotationQuarterTurns: BrickRotationQuarterTurns,
  footprint: { widthStuds: number; depthStuds: number },
) => {
  switch (rotationQuarterTurns) {
    case 1:
      return { x: footprint.depthStuds - point.z, y: point.y, z: point.x }
    case 2:
      return { x: footprint.widthStuds - point.x, y: point.y, z: footprint.depthStuds - point.z }
    case 3:
      return { x: point.z, y: point.y, z: footprint.widthStuds - point.x }
    default:
      return point
  }
}

const rotateYawVector = (
  vector: WorldVector,
  rotationQuarterTurns: BrickRotationQuarterTurns,
) => {
  switch (rotationQuarterTurns) {
    case 1:
      return { x: -vector.z, y: vector.y, z: vector.x }
    case 2:
      return { x: -vector.x, y: vector.y, z: -vector.z }
    case 3:
      return { x: vector.z, y: vector.y, z: -vector.x }
    default:
      return vector
  }
}

export const transformBrickLocalPoint = (
  definition: BrickDefinition,
  pose: BrickPose,
  point: WorldPoint,
) => {
  const verticalQuarterTurns = normalizeVerticalQuarterTurns(pose.verticalQuarterTurns ?? 0)
  const verticalPoint = rotateVerticalPoint(point, verticalQuarterTurns, definition.footprint)
  const verticalFootprint = footprintToWorld(definition, 0, verticalQuarterTurns)
  const rotated = rotateYawPoint(verticalPoint, pose.rotationQuarterTurns, verticalFootprint)

  return {
    x: pose.xStud + rotated.x,
    y: pose.yStud + rotated.y,
    z: pose.zStud + rotated.z,
  }
}

export const getConnectorLocalPoint = (definition: BrickDefinition, connector: BrickConnector): WorldPoint => {
  const y = connector.pose.yStud

  const usesFaceAnchor = connector.kind === 'stud' || connector.kind === 'tube' || connector.kind === 'studsocket'
  if (!usesFaceAnchor) {
    return {
      x: connector.pose.xStud,
      y: connector.pose.yStud,
      z: connector.pose.zStud,
    }
  }

  if (connector.axis === 'x') {
    return {
      x: (connector.direction?.x ?? 1) < 0 ? connector.pose.xStud : connector.pose.xStud + definition.footprint.widthStuds,
      y,
      z: connector.pose.zStud + 0.5,
    }
  }

  if (connector.axis === 'z') {
    return {
      x: connector.pose.xStud + 0.5,
      y,
      z: (connector.direction?.z ?? 1) < 0 ? connector.pose.zStud : connector.pose.zStud + definition.footprint.depthStuds,
    }
  }

  return {
    x: connector.pose.xStud + 0.5,
    y,
    z: connector.pose.zStud + 0.5,
  }
}

export const getBrickConnectors = (definition: BrickDefinition, pose: BrickPose) =>
  definition.connectors.map((connector) => {
    const verticalQuarterTurns = normalizeVerticalQuarterTurns(pose.verticalQuarterTurns ?? 0)
    const localPoint = getConnectorLocalPoint(definition, connector)
    const transformedPoint = transformBrickLocalPoint(definition, pose, localPoint)
    const baseDirection = connector.direction ?? axisVector[connector.axis]
    const direction = normaliseVector(
      rotateYawVector(
        rotateVerticalVector(baseDirection, verticalQuarterTurns),
        pose.rotationQuarterTurns,
      ),
    )

    return {
      ...connector,
      axis: vectorToAxis(direction),
      direction,
      pose: {
        xStud: transformedPoint.x,
        yStud: transformedPoint.y,
        zStud: transformedPoint.z,
      },
    } satisfies BrickConnector
  })

export const poseToLabel = (pose: BrickPose) =>
  `${pose.xStud}, ${pose.yStud}, ${pose.zStud} • 水平 ${pose.rotationQuarterTurns * 90}° · 垂直 ${(pose.verticalQuarterTurns ?? 0) * 90}°`
