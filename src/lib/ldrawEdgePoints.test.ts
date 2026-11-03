import { BoxGeometry, EdgesGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { getLDrawEdgePoints } from './ldrawEdgePoints'

describe('shared mould outlines', () => {
  it('retains every edge coordinate and threshold while reusing repeated instances', () => {
    const geometry = new BoxGeometry(2, 1.2, 1)
    const reference = new EdgesGeometry(geometry, 15)
    const points = getLDrawEdgePoints(geometry, 15)
    expect(new Float32Array(points)).toEqual(reference.getAttribute('position').array)
    expect(getLDrawEdgePoints(geometry, 15)).toBe(points)
    expect(getLDrawEdgePoints(geometry, 45)).not.toBe(points)
    expect(getLDrawEdgePoints(geometry.clone(), 15)).not.toBe(points)
    reference.dispose()
  })
})
