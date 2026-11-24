import { describe, expect, it } from 'vitest'
import type { BuildGraph } from './planUtils'
import { computeCarriedMass } from './stabilityAnalysis'

type Box = { id: string; minX: number; maxX: number; minY: number; maxY: number; minZ?: number; maxZ?: number }

const scene = (boxes: Box[], edges: Array<[string, string]>) => {
  const attachmentEdges = new Map<string, Set<string>>(boxes.map(box => [box.id, new Set<string>()]))
  for (const [a, b] of edges) { attachmentEdges.get(a)!.add(b); attachmentEdges.get(b)!.add(a) }
  const items = boxes.map(box => {
    const bounds = { minX: box.minX, maxX: box.maxX, minY: box.minY, maxY: box.maxY, minZ: box.minZ ?? 0, maxZ: box.maxZ ?? 1 }
    return { id: box.id, bounds, centerY: (box.minY + box.maxY) / 2, mass: (box.maxX - box.minX) * (box.maxY - box.minY) * (bounds.maxZ - bounds.minZ) }
  })
  const graph = { attachmentEdges, boundsById: new Map(items.map(item => [item.id, item.bounds])), groundedIds: new Set(boxes.map(box => box.id)), components: [] } as unknown as BuildGraph
  return { items, graph, massById: new Map(items.map(item => [item.id, item.mass])) }
}

describe('computeCarriedMass', () => {
  it('splits an arch keystone between both pillars by contact area', () => {
    const { items, graph, massById } = scene([
      { id: 'left', minX: 0, maxX: 1, minY: 0, maxY: 1.2 },
      { id: 'right', minX: 3, maxX: 4, minY: 0, maxY: 1.2 },
      { id: 'beam', minX: 0, maxX: 4, minY: 1.2, maxY: 2.4 },
    ], [['left', 'beam'], ['right', 'beam']])
    const carried = computeCarriedMass(items, graph)
    expect(carried.get('left')).toBeCloseTo(massById.get('beam')! / 2, 10)
    expect(carried.get('right')).toBeCloseTo(massById.get('beam')! / 2, 10)
    expect(carried.get('beam') ?? 0).toBe(0)
  })

  it('hands a hanging piece to the parent that holds it, not to a lower piece', () => {
    const { items, graph, massById } = scene([
      { id: 'column', minX: 0, maxX: 1, minY: 0, maxY: 2.4 },
      { id: 'arm', minX: 0, maxX: 3, minY: 2.4, maxY: 3.6 },
      { id: 'lamp', minX: 2, maxX: 3, minY: 1.2, maxY: 2.2 },
    ], [['column', 'arm'], ['arm', 'lamp']])
    const carried = computeCarriedMass(items, graph)
    expect(carried.get('lamp') ?? 0).toBe(0)
    expect(carried.get('arm')).toBeCloseTo(massById.get('lamp')!, 10)
    expect(carried.get('column')).toBeCloseTo(massById.get('arm')! + massById.get('lamp')!, 10)
  })

  it('ignores unconnected pieces that merely overlap in plan view', () => {
    const { items, graph } = scene([
      { id: 'floor', minX: 0, maxX: 8, minY: 0, maxY: 0.4 },
      { id: 'other', minX: 2, maxX: 3, minY: 0, maxY: 1.2 },
      { id: 'cap', minX: 2, maxX: 3, minY: 1.2, maxY: 2.4 },
    ], [['other', 'cap']])
    const carried = computeCarriedMass(items, graph)
    expect(carried.get('floor') ?? 0).toBe(0)
  })

  it('conserves the total suspended mass down to the ground pieces', () => {
    const { items, graph, massById } = scene([
      { id: 'a', minX: 0, maxX: 2, minY: 0, maxY: 1.2 },
      { id: 'b', minX: 2, maxX: 4, minY: 0, maxY: 1.2 },
      { id: 'c', minX: 1, maxX: 3, minY: 1.2, maxY: 2.4 },
      { id: 'd', minX: 0, maxX: 4, minY: 2.4, maxY: 3.6 },
    ], [['a', 'c'], ['b', 'c'], ['c', 'd']])
    const carried = computeCarriedMass(items, graph)
    expect((carried.get('a') ?? 0) + (carried.get('b') ?? 0)).toBeCloseTo(massById.get('c')! + massById.get('d')!, 10)
  })
})
