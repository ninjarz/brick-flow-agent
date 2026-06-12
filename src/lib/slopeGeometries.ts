import { BufferGeometry, Float32BufferAttribute } from 'three'

type ProfilePoint = {
  z: number
  y: number
}

const makeExtrudedProfileGeometry = (width: number, profile: ProfilePoint[]) => {
  const x0 = width / -2
  const x1 = width / 2
  const triangles: number[][] = []

  const push = (...points: number[][]) => {
    triangles.push(...points)
  }

  for (let index = 0; index < profile.length; index += 1) {
    const current = profile[index]
    const next = profile[(index + 1) % profile.length]
    push(
      [x0, current.y, current.z], [x1, current.y, current.z], [x1, next.y, next.z],
      [x0, current.y, current.z], [x1, next.y, next.z], [x0, next.y, next.z],
    )
  }

  for (let index = 1; index < profile.length - 1; index += 1) {
    push(
      [x1, profile[0].y, profile[0].z], [x1, profile[index].y, profile[index].z], [x1, profile[index + 1].y, profile[index + 1].z],
      [x0, profile[0].y, profile[0].z], [x0, profile[index + 1].y, profile[index + 1].z], [x0, profile[index].y, profile[index].z],
    )
  }

  const geometry = makeIndexedGeometry(triangles)
  geometry.computeVertexNormals()
  return geometry
}

const makeIndexedGeometry = (triangles: number[][]) => {
  const vertices: number[] = []
  const indices: number[] = []
  const vertexIndexByKey = new Map<string, number>()

  triangles.forEach((point) => {
    const key = point.map((value) => value.toFixed(6)).join(',')
    const existingIndex = vertexIndexByKey.get(key)
    if (existingIndex !== undefined) {
      indices.push(existingIndex)
      return
    }

    const nextIndex = vertices.length / 3
    vertexIndexByKey.set(key, nextIndex)
    vertices.push(point[0], point[1], point[2])
    indices.push(nextIndex)
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(vertices), 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

const makeExtrudedLengthProfileGeometry = (depth: number, profile: Array<{ x: number; y: number }>) => {
  const z0 = depth / -2
  const z1 = depth / 2
  const triangles: number[][] = []

  const push = (...points: number[][]) => {
    triangles.push(...points)
  }

  for (let index = 0; index < profile.length; index += 1) {
    const current = profile[index]
    const next = profile[(index + 1) % profile.length]
    push(
      [current.x, current.y, z0], [current.x, current.y, z1], [next.x, next.y, z1],
      [current.x, current.y, z0], [next.x, next.y, z1], [next.x, next.y, z0],
    )
  }

  for (let index = 1; index < profile.length - 1; index += 1) {
    push(
      [profile[0].x, profile[0].y, z1], [profile[index].x, profile[index].y, z1], [profile[index + 1].x, profile[index + 1].y, z1],
      [profile[0].x, profile[0].y, z0], [profile[index + 1].x, profile[index + 1].y, z0], [profile[index].x, profile[index].y, z0],
    )
  }

  const geometry = makeIndexedGeometry(triangles)
  geometry.computeVertexNormals()
  return geometry
}

export const createSlope45Geometry = (width: number, height: number, depth: number) => {
  const y0 = height / -2
  const y1 = height / 2
  const x0 = width / -2
  const x1 = width / 2
  const platformStartX = Math.max(x0, x1 - 1)
  const ldrawLowEndRise = Math.min(height, 0.2)

  return makeExtrudedLengthProfileGeometry(depth, [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: platformStartX, y: y1 },
    { x: x0, y: y0 + ldrawLowEndRise },
  ])
}

export const createInvertedSlope45Geometry = (width: number, height: number, depth: number) => {
  const geometry = createSlope45Geometry(width, height, depth)
  const positions = geometry.getAttribute('position')

  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, -positions.getY(index))
  }

  positions.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

export const createCheeseSlopeGeometry = (width: number, height: number, depth: number) => {
  const y0 = height / -2
  const y1 = height / 2
  const z0 = depth / -2
  const z1 = depth / 2
  const frontLipHeight = Math.min(height * 0.1, 0.06)

  return makeExtrudedProfileGeometry(width, [
    { z: z0, y: y0 },
    { z: z1, y: y0 },
    { z: z1, y: y1 },
    { z: z0, y: y0 + frontLipHeight },
  ])
}

const curvedSlope3x1Profile = (width: number, height: number) => {
  const x0 = width / -2
  const y0 = height / -2
  const y1 = height / 2
  const toPoint = (ldrawZ: number, ldrawY: number) => ({
    x: x0 + (ldrawZ + 30) / 20,
    y: y1 - ldrawY / 20,
  })

  return [
    { x: x0, y: y0 },
    { x: width / 2, y: y0 },
    toPoint(30, 0),
    toPoint(16.95, 0.86),
    toPoint(4.12, 3.41),
    toPoint(-8.27, 7.61),
    toPoint(-20, 13.4),
    toPoint(-30, 20),
  ]
}

export const createCurvedSlope3x1Geometry = (width: number, height: number, depth: number) =>
  makeExtrudedLengthProfileGeometry(depth, curvedSlope3x1Profile(width, height))

export const createCurvedSlope3x1OutlineGeometry = (width: number, height: number, depth: number) => {
  const z0 = depth / -2 - 0.002
  const z1 = depth / 2 + 0.002
  const profile = curvedSlope3x1Profile(width, height)
  const points: number[] = []
  const line = (a: [number, number, number], b: [number, number, number]) => {
    points.push(...a, ...b)
  }

  for (const z of [z0, z1]) {
    profile.forEach((point, index) => {
      const next = profile[(index + 1) % profile.length]
      line([point.x, point.y, z], [next.x, next.y, z])
    })
  }

  for (const point of profile) {
    line([point.x, point.y, z0], [point.x, point.y, z1])
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(points), 3))
  return geometry
}

export const createCurvedSlope1x2Geometry = (width: number, height: number, depth: number) => {
  const y0 = height / -2
  const y1 = height / 2
  const x0 = width / -2
  const x1 = width / 2
  const platformStartX = Math.max(x0, x1 - 1)
  const plateHeight = Math.min(0.4, height / 4)
  const platformTopY = y1 - plateHeight
  const platformBottomY = platformTopY - plateHeight
  const radius = platformStartX - x0
  const centerY = y1 - radius
  const segments = 24
  const triangles: number[][] = []
  const push = (...points: number[][]) => {
    triangles.push(...points)
  }
  const curve = Array.from({ length: segments + 1 }).map((_, index) => {
    const angle = (index / segments) * (Math.PI / 2)
    return {
      x: platformStartX - radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    }
  })
  const z0 = depth / -2
  const z1 = depth / 2

  push(
    [platformStartX, platformBottomY, z0], [x1, platformBottomY, z1], [x1, platformBottomY, z0],
    [platformStartX, platformBottomY, z0], [platformStartX, platformBottomY, z1], [x1, platformBottomY, z1],
    [platformStartX, platformTopY, z0], [x1, platformTopY, z0], [x1, platformTopY, z1],
    [platformStartX, platformTopY, z0], [x1, platformTopY, z1], [platformStartX, platformTopY, z1],
    [x1, platformBottomY, z0], [x1, platformTopY, z1], [x1, platformTopY, z0],
    [x1, platformBottomY, z0], [x1, platformBottomY, z1], [x1, platformTopY, z1],
    [platformStartX, platformBottomY, z0], [x1, platformTopY, z0], [platformStartX, platformTopY, z0],
    [platformStartX, platformBottomY, z0], [x1, platformBottomY, z0], [x1, platformTopY, z0],
    [platformStartX, platformBottomY, z1], [platformStartX, platformTopY, z1], [x1, platformTopY, z1],
    [platformStartX, platformBottomY, z1], [x1, platformTopY, z1], [x1, platformBottomY, z1],
  )

  for (let index = 0; index < curve.length - 1; index += 1) {
    const current = curve[index]
    const next = curve[index + 1]
    push(
      [current.x, current.y, z0], [current.x, current.y, z1], [next.x, next.y, z1],
      [current.x, current.y, z0], [next.x, next.y, z1], [next.x, next.y, z0],
    )
  }

  for (const z of [z0, z1]) {
    push([x0, y0, z], [platformStartX, y0, z], [curve[0].x, curve[0].y, z])
    for (let index = 0; index < curve.length - 1; index += 1) {
      push([platformStartX, y0, z], [curve[index + 1].x, curve[index + 1].y, z], [curve[index].x, curve[index].y, z])
    }
    push([platformStartX, platformBottomY, z], [x1, platformTopY, z], [platformStartX, platformTopY, z])
    push([platformStartX, platformBottomY, z], [x1, platformBottomY, z], [x1, platformTopY, z])
  }

  const geometry = makeIndexedGeometry(triangles)
  geometry.computeVertexNormals()
  return geometry
}

export const createCurvedSlope1x2OutlineGeometry = (width: number, height: number, depth: number) => {
  const y0 = height / -2
  const y1 = height / 2
  const x0 = width / -2
  const x1 = width / 2
  const z0 = depth / -2 - 0.002
  const z1 = depth / 2 + 0.002
  const platformStartX = Math.max(x0, x1 - 1)
  const plateHeight = Math.min(0.4, height / 4)
  const platformTopY = y1 - plateHeight
  const platformBottomY = platformTopY - plateHeight
  const curveRise = Math.min(1, height)
  const lowTop = y1 - curveRise
  const points: number[] = []
  const line = (a: [number, number, number], b: [number, number, number]) => {
    points.push(...a, ...b)
  }
  const curve = Array.from({ length: 25 }).map((_, index) => {
    const angle = (index / 24) * (Math.PI / 2)
    return {
      x: x0 + curveRise * (1 - Math.cos(angle)),
      y: lowTop + curveRise * Math.sin(angle),
    }
  })

  for (const z of [z0, z1]) {
    line([x0, y0, z], [x1, y0, z])
    line([x1, platformBottomY, z], [x1, platformTopY, z])
    line([x1, platformTopY, z], [platformStartX, platformTopY, z])
    line([x1, platformBottomY, z], [platformStartX, platformBottomY, z])
    line([platformStartX, y1, z], [platformStartX, platformTopY, z])
    line([x0, y0, z], [x0, lowTop, z])
    curve.forEach((point, index) => {
      if (index === 0) return
      const previous = curve[index - 1]
      line([previous.x, previous.y, z], [point.x, point.y, z])
    })
  }

  line([x0, y0, z0], [x0, y0, z1])
  line([x1, platformBottomY, z0], [x1, platformBottomY, z1])
  line([x1, platformTopY, z0], [x1, platformTopY, z1])
  line([platformStartX, y1, z0], [platformStartX, y1, z1])
  line([platformStartX, platformTopY, z0], [platformStartX, platformTopY, z1])
  line([platformStartX, platformBottomY, z0], [platformStartX, platformBottomY, z1])
  line([x0, lowTop, z0], [x0, lowTop, z1])

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(points), 3))
  return geometry
}
