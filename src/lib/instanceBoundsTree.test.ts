import { expect, it } from 'vitest'
import { Box3, Matrix4, Ray, Vector3 } from 'three'
import { createInstanceBoundsQuery } from './instanceBoundsTree'

it('matches exhaustive world-space bounds queries with transformed parents and stable ordering', () => {
  const bounds = Array.from({ length: 160 }, (_, i) => {
    const min = new Vector3((i % 10) * 3, Math.floor(i / 40), Math.floor(i / 10) * 2)
    return new Box3(min, min.clone().addScalar(1))
  })
  const query = createInstanceBoundsQuery(bounds)
  const transforms = [new Matrix4(), new Matrix4().makeRotationY(.7).scale(new Vector3(-2, .5, 3)).setPosition(10, -3, 2)]
  for (const matrix of transforms) {
    for (let i = 0; i < 100; i++) {
      const ray = new Ray(new Vector3(i - 30, i % 7, -30), new Vector3(.1, -.02, 1).normalize())
      const expected = bounds.flatMap((box, index) => ray.intersectsBox(box.clone().applyMatrix4(matrix)) ? [index] : [])
      expect(query(ray, matrix)).toEqual(expected)
    }
  }
  expect(createInstanceBoundsQuery([])(new Ray(), new Matrix4())).toEqual([])
})
