import { BoxGeometry, BufferGeometry, CylinderGeometry } from 'three'
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg'

const round2x2AxleBodyCache = new Map<number, BufferGeometry>()
const round2x2AxleGrilleBodyCache = new Map<number, BufferGeometry>()

const round2x2BodyRadius = 1

const createBrush = (geometry: BufferGeometry) => {
  const brush = new Brush(geometry)
  brush.updateMatrixWorld()
  return brush
}

const subtractBox = (
  base: Brush,
  width: number,
  height: number,
  depth: number,
  position: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  rotationY = 0,
) => {
  const cutter = new Brush(new BoxGeometry(width, height, depth))
  cutter.position.set(position.x, position.y, position.z)
  cutter.rotation.y = rotationY
  cutter.updateMatrixWorld()

  const evaluator = new Evaluator()
  evaluator.useGroups = false
  return evaluator.evaluate(base, cutter, SUBTRACTION) as Brush
}

const createRound2x2AxleBrush = (height: number) => {
  const body = createBrush(new CylinderGeometry(round2x2BodyRadius, round2x2BodyRadius, height, 96))
  const cutterHeight = height + 0.08
  const armLength = 0.7
  const armWidth = 0.18
  const firstCut = subtractBox(body, armLength, cutterHeight, armWidth)
  return subtractBox(firstCut, armWidth, cutterHeight, armLength)
}

export const createRound2x2AxleBodyGeometry = (height: number) => {
  const cacheKey = Number(height.toFixed(4))
  const cached = round2x2AxleBodyCache.get(cacheKey)
  if (cached) return cached

  const geometry = createRound2x2AxleBrush(height).geometry
  geometry.computeVertexNormals()
  round2x2AxleBodyCache.set(cacheKey, geometry)
  return geometry
}

export const createRound2x2AxleGrilleBodyGeometry = (height: number) => {
  const cacheKey = Number(height.toFixed(4))
  const cached = round2x2AxleGrilleBodyCache.get(cacheKey)
  if (cached) return cached

  const grilleCutterHeight = height + 0.04
  const grilleDepth = 0.36
  const grilleWidth = 0.12
  const grilleRadius = round2x2BodyRadius - grilleDepth / 2 + 0.03
  const grilles = Array.from({ length: 8 }).reduce<Brush>((current, _, index) => {
    const angle = (index * Math.PI) / 4
    return subtractBox(
      current,
      grilleWidth,
      grilleCutterHeight,
      grilleDepth,
      {
        x: Math.sin(angle) * grilleRadius,
        y: 0,
        z: Math.cos(angle) * grilleRadius,
      },
      angle,
    )
  }, createRound2x2AxleBrush(height))

  const geometry = grilles.geometry
  geometry.computeVertexNormals()
  round2x2AxleGrilleBodyCache.set(cacheKey, geometry)
  return geometry
}
