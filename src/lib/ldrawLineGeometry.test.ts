import { expect, it } from 'vitest'
import { Vector3 } from 'three'
import { LineSegmentsGeometry } from 'three-stdlib'
import { LDrawLineGeometry } from './ldrawLineGeometry'

it('keeps every endpoint inside conservative bounds and matches the original bounding box', () => {
  const points = new Float32Array([1, 2, 3, -4, 5, 6, 7, -8, 9, 10, 11, -12])
  const geometry = new LDrawLineGeometry().setPositions(points)
  const original = new LineSegmentsGeometry().setPositions(points)
  expect(geometry.boundingBox).toEqual(original.boundingBox)
  for (let i = 0; i < points.length; i += 3) {
    expect(geometry.boundingSphere!.containsPoint(new Vector3().fromArray(points, i))).toBe(true)
  }
  geometry.dispose()
  original.dispose()
})
