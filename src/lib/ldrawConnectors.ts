import type { BrickConnector, ConnectorPose } from '../types/bricks'

export type LDrawPoint = {
  x: number
  y: number
  z: number
}

export type LDrawBrickFrame = {
  minX: number
  maxY: number
  minZ: number
  lduPerStud?: number
}

const round = (value: number) => Number(value.toFixed(6))

export const ldrawPointToBrickLocal = (
  point: LDrawPoint,
  frame: LDrawBrickFrame,
): ConnectorPose => {
  const lduPerStud = frame.lduPerStud ?? 20

  return {
    xStud: round((point.z - frame.minZ) / lduPerStud),
    yStud: round((frame.maxY - point.y) / lduPerStud),
    zStud: round((point.x - frame.minX) / lduPerStud),
  }
}

const yAxisConnectorCenterToPose = (center: ConnectorPose): ConnectorPose => ({
  xStud: round(center.xStud - 0.5),
  yStud: center.yStud,
  zStud: round(center.zStud - 0.5),
})

export const createLDrawStudConnector = (
  id: string,
  point: LDrawPoint,
  frame: LDrawBrickFrame,
): BrickConnector => ({
  id,
  kind: 'stud',
  gender: 'male',
  axis: 'y',
  direction: { x: 0, y: 1, z: 0 },
  pose: yAxisConnectorCenterToPose(ldrawPointToBrickLocal(point, frame)),
})

export const createLDrawTubeConnector = (
  id: string,
  point: LDrawPoint,
  frame: LDrawBrickFrame,
): BrickConnector => ({
  id,
  kind: 'tube',
  gender: 'female',
  axis: 'y',
  direction: { x: 0, y: -1, z: 0 },
  pose: yAxisConnectorCenterToPose(ldrawPointToBrickLocal(point, frame)),
})
