import { useMemo, useLayoutEffect, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { BatchedMesh, Box3, BoxGeometry, Matrix4, MeshStandardMaterial, Sphere, Vector3, type InterleavedBufferAttribute } from 'three'
import { LineMaterial, LineSegments2, LineSegmentsGeometry } from 'three-stdlib'
import type { PlacedBrick } from '../../types/bricks'
import { getBrickBounds } from '../../lib/planUtils'
import { getLDrawEdgePoints } from '../../lib/ldrawEdgePoints'

// Keep the existing large-group box preview, with sorted transparent instances
// instead of thousands of React meshes/materials on every pointer movement.
export const LargePlacementGhosts = ({ bricks }: { bricks: PlacedBrick[] }) => {
  const size = useThree(state => state.size)
  const bounds = useMemo(() => bricks.flatMap(brick => {
    const value = getBrickBounds(brick)
    return value ? [value] : []
  }), [bricks])
  const resources = useMemo(() => {
    const box = new BoxGeometry(1, 1, 1)
    const edges = getLDrawEdgePoints(box, 12)
    const material = new MeshStandardMaterial({ color: '#22d3ee', transparent: true, opacity: .24, depthWrite: false })
    const mesh = new BatchedMesh(Math.max(1, bounds.length), 24, 36, material)
    const geometryId = mesh.addGeometry(box)
    const ids = Array.from({ length: bounds.length }, () => mesh.addInstance(geometryId))
    mesh.raycast = () => undefined
    const line = new LineSegments2(new LineSegmentsGeometry().setPositions(new Float32Array(bounds.length * edges.length)), new LineMaterial({ color: 0x0891b2, linewidth: 1 }))
    line.raycast = () => undefined
    return { box, edges, mesh, ids, line }
  }, [bounds.length])
  useLayoutEffect(() => {
    const matrix = new Matrix4()
    const sceneBounds = new Box3()
    const min = new Vector3(), max = new Vector3()
    const attribute = resources.line.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    const data = attribute.data.array as Float32Array
    let offset = 0
    bounds.forEach((box, index) => {
      const width = box.maxX - box.minX, height = box.maxY - box.minY, depth = box.maxZ - box.minZ
      const x = (box.minX + box.maxX) / 2, y = (box.minY + box.maxY) / 2, z = (box.minZ + box.maxZ) / 2
      matrix.makeScale(width, height, depth)
      matrix.setPosition(x, y, z)
      sceneBounds.expandByPoint(min.set(box.minX, box.minY, box.minZ))
      sceneBounds.expandByPoint(max.set(box.maxX, box.maxY, box.maxZ))
      resources.mesh.setMatrixAt(resources.ids[index], matrix)
      for (let i = 0; i < resources.edges.length; i += 3) {
        data[offset++] = resources.edges[i] * width + x
        data[offset++] = resources.edges[i + 1] * height + y
        data[offset++] = resources.edges[i + 2] * depth + z
      }
    })
    attribute.data.needsUpdate = true
    // Include Float32 rounding without rescanning every preview vertex.
    if (!sceneBounds.isEmpty()) sceneBounds.expandByScalar(Math.max(1, sceneBounds.min.length(), sceneBounds.max.length()) * 1e-7)
    resources.line.geometry.boundingBox = sceneBounds
    resources.line.geometry.boundingSphere = sceneBounds.getBoundingSphere(new Sphere())
  }, [bounds, resources])
  useLayoutEffect(() => { resources.line.material.resolution.set(size.width, size.height) }, [resources, size.width, size.height])
  useEffect(() => () => {
    resources.mesh.dispose(); resources.mesh.material.dispose(); resources.box.dispose()
    resources.line.geometry.dispose(); resources.line.material.dispose()
  }, [resources])
  return <group renderOrder={30} userData={{ placementGhost: true }}><primitive object={resources.mesh} /><primitive object={resources.line} /></group>
}
