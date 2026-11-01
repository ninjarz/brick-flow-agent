import { describe, expect, it } from 'vitest'
import { Euler, Matrix4, Vector3 } from 'three'
import { brickById } from '../data/basicBricks'
import { footprintToWorld, getBrickConnectors, isValidOrientationMatrix, transformBrickLocalPoint } from './brickUnits'
import { isValidImportedPose, normalizeImportedPose } from './planImport'
import type { BrickPose } from '../types/bricks'
import { formatLDrawPlan, parseLDrawPlan } from './ldrawPlan'

describe('exact hinged assembly orientation', () => {
  it('preserves handedness when importing an asymmetric LDraw arrangement', () => {
    const references = [[0,0,0],[100,0,0],[0,100,0],[0,0,100]].map(([x,y,z]) =>
      `1 15 ${x} ${y} ${z} 1 0 0 0 1 0 0 0 1 3023.dat`)
    const result = parseLDrawPlan(['0 !BRICK_FLOW_AGENT_EXACT_FRAMES', ...references].join('\n'))!
    expect(result.plan.bricks).toHaveLength(4)
    const [origin, ...rest] = result.plan.bricks.map(b => [b.pose.xStud,b.pose.yStud,b.pose.zStud])
    const [a,b,c] = rest.map(v => v.map((n,i) => n-origin[i]))
    const volume = a[0]*(b[1]*c[2]-b[2]*c[1])-a[1]*(b[0]*c[2]-b[2]*c[0])+a[2]*(b[0]*c[1]-b[1]*c[0])
    expect(volume).toBeCloseTo(125, 6)
    expect(a).toEqual([5,0,0]); expect(b).toEqual([0,-5,0]); expect(c).toEqual([0,0,-5])
    const plain = formatLDrawPlan(result.plan).split('\n').filter(line => !line.startsWith('0 !BRICK_FLOW_AGENT_PLAN')).join('\n')
    const restored = parseLDrawPlan(plain)!
    for (let i=0;i<4;i++) {
      expect(restored.plan.bricks[i].pose.xStud).toBeCloseTo(result.plan.bricks[i].pose.xStud,6)
      expect(restored.plan.bricks[i].pose.yStud).toBeCloseTo(result.plan.bricks[i].pose.yStud,6)
      expect(restored.plan.bricks[i].pose.zStud).toBeCloseTo(result.plan.bricks[i].pose.zStud,6)
    }
  })

  it('matches rendered corners and connector directions after a 45 degree hinge and an editor rotation', () => {
    const definition = brickById.get('plate-1x2')!
    const c = Math.SQRT1_2
    const matrix: NonNullable<BrickPose['orientationMatrix']> = [c, 0, c, 0, 1, 0, -c, 0, c]
    const pose: BrickPose = { xStud: 0.123456, yStud: 3.125, zStud: 4.25, rotationQuarterTurns: 1, rollQuarterTurns: 1, orientationMatrix: matrix }
    const bounds = footprintToWorld(definition, 1, 0, 1, matrix)
    const transform = new Matrix4().set(c, 0, c, 0, 0, 1, 0, 0, -c, 0, c, 0, 0, 0, 0, 1)
    const editorRotation = new Euler(0, -Math.PI / 2, Math.PI / 2, 'YXZ')
    const corners = []
    for (const x of [0, 2]) for (const y of [0, 0.4]) for (const z of [0, 1]) {
      const actual = transformBrickLocalPoint(definition, pose, { x, y, z })
      const expected = new Vector3(x - 1, y - 0.2, z - 0.5).applyMatrix4(transform).applyEuler(editorRotation)
        .add(new Vector3(pose.xStud + bounds.width / 2, pose.yStud + bounds.height / 2, pose.zStud + bounds.depth / 2))
      expect(actual.x).toBeCloseTo(expected.x, 6)
      expect(actual.y).toBeCloseTo(expected.y, 6)
      expect(actual.z).toBeCloseTo(expected.z, 6)
      corners.push(actual)
    }
    expect(Math.min(...corners.map(p => p.x))).toBeCloseTo(pose.xStud)
    expect(Math.max(...corners.map(p => p.y))).toBeCloseTo(pose.yStud + bounds.height)
    const direction = new Vector3(0, 1, 0).applyMatrix4(transform).applyEuler(editorRotation)
    const stud = getBrickConnectors(definition, pose).find(connector => connector.kind === 'stud')!
    expect(stud.direction!.x).toBeCloseTo(direction.x)
    expect(stud.direction!.z).toBeCloseTo(direction.z)
  })

  it('preserves exact coordinates and rejects scaling, shearing and nonfinite matrices on import', () => {
    const pose: BrickPose = { xStud: 0.123456, yStud: 0.0375, zStud: -4.25, rotationQuarterTurns: 0, orientationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] }
    expect(isValidImportedPose(pose)).toBe(true)
    expect(normalizeImportedPose(pose)).toMatchObject(pose)
    for (const matrix of [[2, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0.2, 0, 0, 1, 0, 0, 0, 1], [NaN, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0]]) {
      expect(isValidOrientationMatrix(matrix)).toBe(false)
      expect(isValidImportedPose({ ...pose, orientationMatrix: matrix })).toBe(false)
    }
  })

  it('exports a non-quarter-turn pose with enough precision for plain LDraw reimport', () => {
    const c = Math.SQRT1_2
    const pose: BrickPose = { xStud: 0.123456, yStud: 0, zStud: 4.25, rotationQuarterTurns: 0, orientationMatrix: [c,0,c, 0,1,0, -c,0,c] }
    const plan = { id: 'hinged', title: 'Hinged plate', prompt: '', source: 'template-local' as const, steps: [], bricks: [{ id: 'plate', brickId: 'plate-1x2', color: 'tan' as const, pose }] }
    const plain = formatLDrawPlan(plan).split('\n').filter(line => !line.startsWith('0 !BRICK_FLOW_AGENT_PLAN')).join('\n')
    const restored = parseLDrawPlan(plain)!
    expect(restored.unsupportedPoseCount).toBe(0)
    expect(restored.plan.bricks).toHaveLength(1)
    const expected = transformBrickLocalPoint(brickById.get('plate-1x2')!, pose, { x: 1, y: 0.2, z: 0.5 })
    const actual = transformBrickLocalPoint(brickById.get('plate-1x2')!, restored.plan.bricks[0].pose, { x: 1, y: 0.2, z: 0.5 })
    expect(actual.x).toBeCloseTo(expected.x, 6)
    expect(actual.y).toBeCloseTo(expected.y, 6)
    expect(actual.z).toBeCloseTo(expected.z, 6)
  })
})
