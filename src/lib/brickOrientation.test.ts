import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import { footprintToWorld, getBrickConnectors, transformBrickLocalPoint } from './brickUnits'
import { formatLDrawPlan, parseLDrawPlan } from './ldrawPlan'
import type { BrickPose, BuildPlan } from '../types/bricks'

describe('full orthogonal brick orientation', () => {
  it('matches Three.js rendering and footprint dimensions for all 24 orientations', () => {
    const definition = brickById.get('plate-1x2')!
    const matrices = new Set<string>()
    for (let yaw = 0; yaw < 4; yaw++) for (let pitch = 0; pitch < 4; pitch++) for (let roll = 0; roll < 4; roll++) {
      const pose = { xStud: 2, yStud: 4, zStud: 6, rotationQuarterTurns: yaw, verticalQuarterTurns: pitch, rollQuarterTurns: roll } as BrickPose
      const size = footprintToWorld(definition, pose.rotationQuarterTurns, pose.verticalQuarterTurns, pose.rollQuarterTurns)
      const point = { x: 0.3, y: 0.15, z: 0.7 }
      const actual = transformBrickLocalPoint(definition, pose, point)
      const expected = new Vector3(point.x - 1, point.y - 0.2, point.z - 0.5)
        .applyEuler(new Euler(-pitch * Math.PI / 2, -yaw * Math.PI / 2, roll * Math.PI / 2, 'YXZ'))
        .add(new Vector3(pose.xStud + size.widthStuds / 2, pose.yStud + size.heightStuds / 2, pose.zStud + size.depthStuds / 2))
      expect(actual.x).toBeCloseTo(expected.x)
      expect(actual.y).toBeCloseTo(expected.y)
      expect(actual.z).toBeCloseTo(expected.z)
      const origin = transformBrickLocalPoint(definition, pose, { x: 0, y: 0, z: 0 })
      matrices.add(JSON.stringify(['x','y','z'].map((axis) => {
        const p = transformBrickLocalPoint(definition, pose, { x: +(axis === 'x'), y: +(axis === 'y'), z: +(axis === 'z') })
        return [p.x - origin.x, p.y - origin.y, p.z - origin.z].map((n) => Math.round(n))
      })))
      expect(getBrickConnectors(definition, pose).length).toBeGreaterThan(0)
    }
    expect(matrices.size).toBe(24)
  })

  it('retains roll in embedded LDraw metadata', () => {
    const plan: BuildPlan = { id: 'rolled', title: 'Rolled plate', prompt: '', source: 'template-local', steps: [], bricks: [{ id: 'plate', brickId: 'plate-1x2', color: 'tan', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 1, verticalQuarterTurns: 2, rollQuarterTurns: 1 } }] }
    const restored = parseLDrawPlan(formatLDrawPlan(plan))!.plan
    expect(restored.bricks[0].pose.rollQuarterTurns).toBe(1)
  })
})
