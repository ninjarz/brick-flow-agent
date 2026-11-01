import collisionBoxes from '../data/lddCollisionBoxes.json' with { type: 'json' }
import frames from '../data/ldrawSourceFrames.json' with { type: 'json' }
import type { BrickDefinition, PlacedBrick } from '../types/bricks'
import { transformBrickLocalPoint } from './brickUnits'
import type { CellAxes } from './orientedCellBounds'
import type { WorldStructuralCellBox } from './structuralGrid'

type SourceBox = { center: number[]; axes: number[][]; halfSize: number[] }
const boxesByPart = collisionBoxes as Record<string, SourceBox[]>
const framesByPart = frames as Record<string, { origin: number[]; swapped: boolean }>

// These envelopes describe molded bodies in the original part library. Stud
// clutches are represented separately by connectors, as in the voxel path.
export const getLDDWorldCollisionBounds = (
  definition: BrickDefinition,
  brick: PlacedBrick,
): WorldStructuralCellBox[] | undefined => {
  if (definition.pack !== 'lego' || !brick.pose.orientationMatrix) return undefined
  const part = definition.partNumber.replace(/\.dat$/, '')
  const source = boxesByPart[part], frame = framesByPart[part]
  if (!source || !frame) return undefined
  const point = (p: number[], vector = false) => {
    const v = vector ? [p[0], -p[1], p[2]] : [
      (p[0] - frame.origin[0]) / 20,
      (frame.origin[1] - p[1]) / 20,
      (p[2] - frame.origin[2]) / 20,
    ]
    if (frame.swapped) [v[0], v[2]] = [v[2], v[0]]
    return { x: v[0], y: v[1], z: v[2] }
  }
  return source.map(box => {
    const local = point(box.center)
    const center = transformBrickLocalPoint(definition, brick.pose, local)
    const axes = box.axes.map(axis => {
      const v = point(axis, true)
      const end = transformBrickLocalPoint(definition, brick.pose, { x: local.x + v.x, y: local.y + v.y, z: local.z + v.z })
      const a = [end.x - center.x, end.y - center.y, end.z - center.z]
      const length = Math.hypot(...a)
      return a.map(n => n / length)
    }) as unknown as CellAxes
    const halfSize = box.halfSize.map(n => n / 20) as [number, number, number]
    const radius = [0, 1, 2].map(i => axes.reduce((sum, axis, j) => sum + Math.abs(axis[i]) * halfSize[j], 0))
    return {
      kind: 'solid',
      minX: center.x - radius[0], maxX: center.x + radius[0],
      minY: center.y - radius[1], maxY: center.y + radius[1],
      minZ: center.z - radius[2], maxZ: center.z + radius[2],
      oriented: { axes, halfSize },
    }
  })
}
