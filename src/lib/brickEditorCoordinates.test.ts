import { describe, expect, it } from 'vitest'
import raw from '../data/legoHogwartsPlan.json'
import type { BuildPlan } from '../types/bricks'
import { getBrickAssemblyPosition, getBrickSelectionReference } from './brickEditorCoordinates'
import { rotateRigidBrickGroup, translateRigidBrickGroup } from './rigidBrickGroup'

const plan = raw as BuildPlan
const structure = plan.structures!.find(item => item.name.includes('海格小屋'))!
const ids = new Set(structure.brickIds)
const bricks = plan.bricks.filter(brick => ids.has(brick.id))

describe('assembly coordinates in the editor', () => {
  it('shows the flower assembly origin instead of its 45-degree envelope corner', () => {
    const flower = bricks.find(brick => brick.brickId === 'hogwarts-ldraw-24866')!
    expect(flower.pose.xStud).toBeCloseTo(30.792893, 6)
    const position = getBrickAssemblyPosition(flower)
    expect(position.x).toBeCloseTo(31.5, 6)
    expect(position.z).toBeCloseTo(63.500022, 6)
    expect(position.y).toBeCloseTo(1.2, 5)
  })
  it('uses the same group reference even if member order or the clicked part changes', () => {
    const reference = getBrickSelectionReference(bricks, structure)!
    expect(getBrickSelectionReference([...bricks].reverse(), structure)).toEqual(reference)
    expect(reference.brick.id).toBe(structure.brickIds[0])
  })
  it('translates the reference exactly and does not modify the original stored poses', () => {
    const before = JSON.stringify(bricks)
    const reference = getBrickSelectionReference(bricks, structure)!
    const moved = translateRigidBrickGroup(bricks, { xStud: 2, zStud: -.2 })
    const after = getBrickSelectionReference(moved, structure)!
    expect(after.position.x - reference.position.x).toBeCloseTo(2, 10)
    expect(after.position.z - reference.position.z).toBeCloseTo(-.2, 10)
    expect(JSON.stringify(bricks)).toBe(before)
  })
  it.each(['horizontal', 'vertical'] as const)('keeps the assembly reference fixed during %s rotation', axis => {
    const reference = getBrickSelectionReference(bricks, structure)!
    const rotated = rotateRigidBrickGroup(bricks, reference.brick, axis, 1, reference.position)
    const after = getBrickSelectionReference(rotated, structure)!
    expect(after.position.x).toBeCloseTo(reference.position.x, 9)
    expect(after.position.y).toBeCloseTo(reference.position.y, 9)
    expect(after.position.z).toBeCloseTo(reference.position.z, 9)
  })
})
