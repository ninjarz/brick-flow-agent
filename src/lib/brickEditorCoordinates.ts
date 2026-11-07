import sourceFrames from '../data/ldrawSourceFrames.json'
import { brickById } from '../data/basicBricks'
import { transformBrickLocalPoint } from './brickUnits'
import type { BrickStructure, PlacedBrick } from '../types/bricks'

export type AssemblyPosition = { x: number; y: number; z: number }
const frames = sourceFrames as Record<string, { origin: number[]; swapped: boolean }>

/** LDraw's authored assembly origin, independent of the rotated size envelope. */
export const getBrickAssemblyPosition = (brick: PlacedBrick): AssemblyPosition => {
  const definition = brickById.get(brick.brickId)
  const frame = definition && frames[definition.partNumber.replace(/\.dat$/i, '').toLowerCase()]
  if (definition?.pack === 'lego' && frame) {
    const [x, y, z] = frame.origin.map(value => -value / 20)
    return transformBrickLocalPoint(definition, brick.pose, { x: frame.swapped ? z : x, y: -y, z: frame.swapped ? x : z })
  }
  return { x: brick.pose.xStud, y: brick.pose.yStud, z: brick.pose.zStud }
}

/** Authored member order fixes the group reference, regardless of the clicked part. */
export const getBrickSelectionReference = (bricks: PlacedBrick[], structure?: BrickStructure) => {
  const byId = new Map(bricks.map(brick => [brick.id, brick]))
  const brick = structure?.brickIds.map(id => byId.get(id)).find(Boolean) ?? bricks[0]
  return brick ? { brick, position: getBrickAssemblyPosition(brick) } : undefined
}
