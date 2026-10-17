import * as esbuild from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const workspace = process.cwd()
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-ldraw-structural-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')
const publicLDrawDir = join(workspace, 'public/ldraw')
const visualOutputPath = join(workspace, 'src/lib/ldrawGeneratedVisual.ts')
const visualChunkOutputDir = join(workspace, 'src/lib/ldrawGeneratedVisualChunks')
const connectorOutputPath = join(workspace, 'src/lib/ldrawGeneratedConnectors.ts')

await writeFile(entry, `
  import { brickDefinitions } from ${JSON.stringify(`${workspace}/src/data/basicBricks.ts`)};
  import { normalizeLDrawPartNumber } from ${JSON.stringify(`${workspace}/src/lib/ldrawPartNumbers.ts`)};

  export const partProfiles = Array.from(new Map(
    brickDefinitions.filter((definition) => definition.pack === 'lego').map((definition) => [
      normalizeLDrawPartNumber(definition.partNumber),
      {
        partNumber: normalizeLDrawPartNumber(definition.partNumber),
        widthStuds: definition.footprint.widthStuds,
        heightStuds: definition.footprint.heightStuds,
        depthStuds: definition.footprint.depthStuds,
      },
    ])
  ).values()).sort((source, target) => source.partNumber.localeCompare(target.partNumber));
`)

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})

const { partProfiles } = await import(`file://${outfile}`)

const identityMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const identityTransform = { origin: [0, 0, 0], matrix: identityMatrix }
const numberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 6,
  useGrouping: false,
})

const round = (value) => Number(value.toFixed(6))
const formatNumber = (value) => numberFormat.format(round(value))

const transformPoint = (point, transform) => {
  const [a, b, c, d, e, f, g, h, i] = transform.matrix
  const [x, y, z] = point

  return [
    transform.origin[0] + a * x + b * y + c * z,
    transform.origin[1] + d * x + e * y + f * z,
    transform.origin[2] + g * x + h * y + i * z,
  ]
}

const composeTransform = (parent, child) => {
  const [pa, pb, pc, pd, pe, pf, pg, ph, pi] = parent.matrix
  const [ca, cb, cc, cd, ce, cf, cg, ch, ci] = child.matrix

  return {
    origin: transformPoint(child.origin, parent),
    matrix: [
      pa * ca + pb * cd + pc * cg,
      pa * cb + pb * ce + pc * ch,
      pa * cc + pb * cf + pc * ci,
      pd * ca + pe * cd + pf * cg,
      pd * cb + pe * ce + pf * ch,
      pd * cc + pe * cf + pf * ci,
      pg * ca + ph * cd + pi * cg,
      pg * cb + ph * ce + pi * ch,
      pg * cc + ph * cf + pi * ci,
    ],
  }
}

const determinant = (matrix) => {
  const [a, b, c, d, e, f, g, h, i] = matrix

  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
}

const normalizeReference = (reference) => reference.replace(/\\/g, '/').toLowerCase()
const referenceBasename = (reference) => normalizeReference(reference).split('/').at(-1) ?? ''

const connectorPrimitiveSpecs = [
  { pattern: /^stud(?:|10|15)\.dat$/, connectors: [{ kind: 'stud', gender: 'male', point: 'origin' }] },
  { pattern: /^stud(?:2|2a|2s)\.dat$/, connectors: [{ kind: 'stud', gender: 'male', point: 'origin' }] },
  {
    pattern: /^stud(?:3|3a|4|4a|4o|4od|4f2w)\.dat$/,
    connectors: [{ kind: 'tube', gender: 'female', point: 'tip', socketExpansion: 'adjacent-grid' }],
  },
]

const getConnectorPrimitiveSpecs = (reference) => {
  const basename = referenceBasename(reference)
  return connectorPrimitiveSpecs.find((spec) => spec.pattern.test(basename))?.connectors ?? []
}

const resolveReference = (parentRelativePath, reference) => {
  const normalizedReference = normalizeReference(reference)
  const parentDir = dirname(parentRelativePath).replace(/\\/g, '/')
  const candidates = []

  if (normalizedReference.startsWith('parts/') || normalizedReference.startsWith('p/')) {
    candidates.push(normalizedReference)
  } else if (normalizedReference.startsWith('s/')) {
    candidates.push(`parts/${normalizedReference}`)
    if (parentDir) candidates.push(`${parentDir}/${normalizedReference}`)
  } else {
    if (parentDir) candidates.push(`${parentDir}/${normalizedReference}`)
    candidates.push(`parts/${normalizedReference}`)
    candidates.push(`p/${normalizedReference}`)
  }

  return candidates.find((candidate) => existsSync(join(publicLDrawDir, candidate)))
}

const fileSourceCache = new Map()
const readLDrawFile = async (relativePath) => {
  const normalizedPath = normalizeReference(relativePath)
  const cached = fileSourceCache.get(normalizedPath)
  if (cached !== undefined) return cached

  const source = await readFile(join(publicLDrawDir, normalizedPath), 'utf8')
  fileSourceCache.set(normalizedPath, source)
  return source
}

for (const profile of partProfiles) {
  await readLDrawFile(`parts/${profile.partNumber}.dat`)
}

const parseFile = async (relativePath, transform = identityTransform, stack = [], inverted = false, inheritedColor = 16) => {
  const normalizedPath = normalizeReference(relativePath)
  if (stack.includes(normalizedPath)) return { triangles: [], triangleColors: [], connectorReferences: [] }

  const source = await readLDrawFile(normalizedPath)
  const triangles = []
  const triangleColors = []
  const connectorReferences = []
  const certifiedCw = source.split(/\r?\n/).some((line) => /^0\s+BFC\s+CERTIFY\s+CW\b/i.test(line.trim()))
  let invertNext = false
  const fileInverted = inverted !== certifiedCw

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^0\s+BFC\s+INVERTNEXT\b/i.test(trimmed)) {
      invertNext = true
      continue
    }
    if (trimmed.startsWith('0')) continue

    const tokens = trimmed.split(/\s+/)
    const type = tokens[0]
    const color = tokens[1] === '16' ? inheritedColor : Number(tokens[1])

    if (type === '1' && tokens.length >= 15) {
      const values = tokens.slice(2, 14).map(Number)
      if (values.some((value) => !Number.isFinite(value))) continue

      const reference = tokens.slice(14).join(' ')
      const resolvedReference = resolveReference(normalizedPath, reference)
      if (!resolvedReference) continue

      const childTransform = {
        origin: values.slice(0, 3),
        matrix: values.slice(3, 12),
      }
      const childGlobalTransform = composeTransform(transform, childTransform)
      const connectorPrimitiveSpecs = getConnectorPrimitiveSpecs(resolvedReference)
      for (const connectorPrimitiveSpec of connectorPrimitiveSpecs) {
        connectorReferences.push({
          ...connectorPrimitiveSpec,
          source: referenceBasename(resolvedReference),
          transform: childGlobalTransform,
        })
      }
      const childInverted = fileInverted !== (determinant(childTransform.matrix) < 0) !== invertNext
      const child = await parseFile(resolvedReference, childGlobalTransform, [
        ...stack,
        normalizedPath,
      ], childInverted, color)
      triangles.push(...child.triangles)
      triangleColors.push(...child.triangleColors)
      connectorReferences.push(...child.connectorReferences)
      invertNext = false
    }

    if (type === '3' && tokens.length >= 11) {
      const values = tokens.slice(2, 11).map(Number)
      if (values.some((value) => !Number.isFinite(value))) continue
      const triangle = [
        transformPoint(values.slice(0, 3), transform),
        transformPoint(values.slice(3, 6), transform),
        transformPoint(values.slice(6, 9), transform),
      ]
      triangles.push(fileInverted ? [triangle[0], triangle[2], triangle[1]] : triangle)
      triangleColors.push(color)
    }

    if (type === '4' && tokens.length >= 14) {
      const values = tokens.slice(2, 14).map(Number)
      if (values.some((value) => !Number.isFinite(value))) continue
      const points = [
        transformPoint(values.slice(0, 3), transform),
        transformPoint(values.slice(3, 6), transform),
        transformPoint(values.slice(6, 9), transform),
        transformPoint(values.slice(9, 12), transform),
      ]
      triangleColors.push(color, color)
      triangles.push(
        fileInverted ? [points[0], points[2], points[1]] : [points[0], points[1], points[2]],
        fileInverted ? [points[0], points[3], points[2]] : [points[0], points[2], points[3]],
      )
    }
  }

  return { triangles, triangleColors, connectorReferences }
}

const getBounds = (triangles) => {
  const points = triangles.flat()
  return {
    minX: Math.min(...points.map((point) => point[0])),
    maxX: Math.max(...points.map((point) => point[0])),
    minY: Math.min(...points.map((point) => point[1])),
    maxY: Math.max(...points.map((point) => point[1])),
    minZ: Math.min(...points.map((point) => point[2])),
    maxZ: Math.max(...points.map((point) => point[2])),
  }
}

const getHorizontalAxisMapping = (frame, profile) => {
  const ldrawXStuds = (frame.maxX - frame.minX) / 20
  const ldrawZStuds = (frame.maxZ - frame.minZ) / 20
  const directError =
    Math.abs(ldrawXStuds - profile.widthStuds) +
    Math.abs(ldrawZStuds - profile.depthStuds)
  const swappedError =
    Math.abs(ldrawZStuds - profile.widthStuds) +
    Math.abs(ldrawXStuds - profile.depthStuds)

  return directError <= swappedError ? 'direct' : 'swapped'
}

const sourceAxisForLocalAxis = (localAxis, horizontalAxisMapping) => {
  if (localAxis === 'x') return horizontalAxisMapping === 'direct' ? 'x' : 'z'
  if (localAxis === 'z') return horizontalAxisMapping === 'direct' ? 'z' : 'x'
  return 'y'
}

const sourceCoordinate = (point, sourceAxis) => {
  if (sourceAxis === 'x') return point[0]
  if (sourceAxis === 'y') return point[1]
  return point[2]
}

const sourceBoundsForAxis = (frame, sourceAxis) => {
  if (sourceAxis === 'x') return { min: frame.minX, max: frame.maxX }
  if (sourceAxis === 'y') return { min: frame.minY, max: frame.maxY }
  return { min: frame.minZ, max: frame.maxZ }
}

const gridSnapDistance = (localValue) =>
  Math.abs(localValue * 2 - Math.round(localValue * 2)) / 2

const addCandidate = (candidates, value) => {
  if (!Number.isFinite(value)) return
  candidates.add(formatNumber(value))
}

const getAlignedAxisOrigin = (frame, profile, horizontalAxisMapping, connectorReferences, localAxis) => {
  const sourceAxis = sourceAxisForLocalAxis(localAxis, horizontalAxisMapping)
  const { min, max } = sourceBoundsForAxis(frame, sourceAxis)
  const sizeStuds = profile[localAxis === 'x' ? 'widthStuds' : 'depthStuds']
  const sizeLdu = sizeStuds * 20
  const verticalConnectorValues = connectorReferences
    .filter((connectorReference) => {
      const directionVector = ldrawVectorToLocal(getConnectorOutwardVector(connectorReference), horizontalAxisMapping)
      return dominantAxisDirection(directionVector).axis === 'y'
    })
    .map((connectorReference) => sourceCoordinate(getConnectorPoint(connectorReference), sourceAxis))
  const candidates = new Set()

  addCandidate(candidates, min)
  addCandidate(candidates, max - sizeLdu)
  addCandidate(candidates, (min + max - sizeLdu) / 2)

  for (const value of verticalConnectorValues) {
    for (let gridValue = 0; gridValue <= sizeStuds; gridValue += 0.5) {
      addCandidate(candidates, value - gridValue * 20)
    }
  }

  const scoreCandidate = (origin) => {
    let score = Math.abs(origin - min) * 0.0001

    if (origin < min - 0.000001) score += (min - origin) * 0.05
    if (origin + sizeLdu > max + 0.000001) score += (origin + sizeLdu - max) * 0.05

    for (const value of verticalConnectorValues) {
      const localValue = (value - origin) / 20
      score += gridSnapDistance(localValue) * 100
      if (localValue < -0.000001 || localValue > sizeStuds + 0.000001) {
        score += 100 + Math.min(Math.abs(localValue), Math.abs(localValue - sizeStuds))
      }
    }

    return score
  }

  return Number(Array.from(candidates)
    .map((candidate) => Number(candidate))
    .sort((source, target) => scoreCandidate(source) - scoreCandidate(target))[0])
}

const getAlignedFrame = (frame, profile, horizontalAxisMapping, connectorReferences) => {
  const alignedFrame = { ...frame }
  const xSourceAxis = sourceAxisForLocalAxis('x', horizontalAxisMapping)
  const zSourceAxis = sourceAxisForLocalAxis('z', horizontalAxisMapping)
  const xOrigin = getAlignedAxisOrigin(frame, profile, horizontalAxisMapping, connectorReferences, 'x')
  const zOrigin = getAlignedAxisOrigin(frame, profile, horizontalAxisMapping, connectorReferences, 'z')

  if (xSourceAxis === 'x') alignedFrame.minX = xOrigin
  if (xSourceAxis === 'z') alignedFrame.minZ = xOrigin
  if (zSourceAxis === 'x') alignedFrame.minX = zOrigin
  if (zSourceAxis === 'z') alignedFrame.minZ = zOrigin

  return alignedFrame
}

const ldrawPointToLocal = (point, frame, horizontalAxisMapping) => {
  const direct = horizontalAxisMapping === 'direct'

  return {
    x: round(((direct ? point[0] : point[2]) - (direct ? frame.minX : frame.minZ)) / 20),
    y: round((frame.maxY - point[1]) / 20),
    z: round(((direct ? point[2] : point[0]) - (direct ? frame.minZ : frame.minX)) / 20),
  }
}

const ldrawVectorToLocal = (vector, horizontalAxisMapping) => {
  const direct = horizontalAxisMapping === 'direct'

  return {
    x: round((direct ? vector[0] : vector[2]) / 20),
    y: round(-vector[1] / 20),
    z: round((direct ? vector[2] : vector[0]) / 20),
  }
}

const transformVector = (vector, transform) => {
  const [a, b, c, d, e, f, g, h, i] = transform.matrix
  const [x, y, z] = vector

  return [
    a * x + b * y + c * z,
    d * x + e * y + f * z,
    g * x + h * y + i * z,
  ]
}

const dominantAxisDirection = (vector) => {
  const candidates = [
    { axis: 'x', value: vector.x },
    { axis: 'y', value: vector.y },
    { axis: 'z', value: vector.z },
  ].sort((source, target) => Math.abs(target.value) - Math.abs(source.value))
  const dominant = candidates[0]
  const sign = dominant.value < 0 ? -1 : 1

  return {
    axis: dominant.axis,
    direction: {
      x: dominant.axis === 'x' ? sign : 0,
      y: dominant.axis === 'y' ? sign : 0,
      z: dominant.axis === 'z' ? sign : 0,
    },
  }
}

const connectorPoseFromCenter = (center, axis, direction, profile) => {
  if (axis === 'x') {
    return {
      xStud: direction.x < 0 ? center.x : round(center.x - profile.widthStuds),
      yStud: center.y,
      zStud: round(center.z - 0.5),
    }
  }

  if (axis === 'z') {
    return {
      xStud: round(center.x - 0.5),
      yStud: center.y,
      zStud: direction.z < 0 ? center.z : round(center.z - profile.depthStuds),
    }
  }

  return {
    xStud: round(center.x - 0.5),
    yStud: center.y,
    zStud: round(center.z - 0.5),
  }
}

const getConnectorPoint = (connectorReference) =>
  connectorReference.point === 'tip'
    ? transformPoint([0, -4, 0], connectorReference.transform)
    : connectorReference.transform.origin

const getConnectorOutwardVector = (connectorReference) => {
  // LDraw stud-family primitives extend away from their mounting/opening plane along local -Y.
  return transformVector([0, -1, 0], connectorReference.transform)
}

const profileSizeForAxis = (profile, axis) => {
  if (axis === 'x') return profile.widthStuds
  if (axis === 'z') return profile.depthStuds
  return profile.heightStuds
}

const isGridBoundary = (value) =>
  Math.abs(value - Math.round(value)) < 0.01

const uniqueValues = (values) =>
  Array.from(new Set(values.map((value) => formatNumber(value)))).map(Number)

const adjacentGridValues = (value, axis, profile) => {
  if (axis !== 'x' && axis !== 'z') return [value]
  if (!isGridBoundary(value)) return [value]

  const gridLine = Math.round(value)
  const size = profileSizeForAxis(profile, axis)
  return uniqueValues([gridLine - 0.5, gridLine + 0.5])
    .filter((candidate) => candidate >= -0.000001 && candidate <= size + 0.000001)
}

const expandSocketCenters = (connectorReference, center, axis, profile) => {
  if (connectorReference.socketExpansion !== 'adjacent-grid') return [center]

  const xValues = axis === 'x' ? [center.x] : adjacentGridValues(center.x, 'x', profile)
  const yValues = axis === 'y' ? [center.y] : adjacentGridValues(center.y, 'y', profile)
  const zValues = axis === 'z' ? [center.z] : adjacentGridValues(center.z, 'z', profile)
  const centers = []

  for (const x of xValues) {
    for (const y of yValues) {
      for (const z of zValues) {
        centers.push({ x, y, z })
      }
    }
  }

  return centers
}

const connectorKey = (connector) =>
  [
    connector.kind,
    connector.gender,
    connector.axis,
    formatNumber(connector.direction.x),
    formatNumber(connector.direction.y),
    formatNumber(connector.direction.z),
    formatNumber(connector.pose.xStud),
    formatNumber(connector.pose.yStud),
    formatNumber(connector.pose.zStud),
  ].join(':')

const makeGeneratedConnectors = (profile, frame, horizontalAxisMapping, connectorReferences) => {
  const connectors = []
  const seen = new Set()

  for (const connectorReference of connectorReferences) {
    const center = ldrawPointToLocal(getConnectorPoint(connectorReference), frame, horizontalAxisMapping)
    const directionVector = ldrawVectorToLocal(getConnectorOutwardVector(connectorReference), horizontalAxisMapping)
    const { axis, direction } = dominantAxisDirection(directionVector)

    // The central open tube also accepts a stud (the four clock plates in 21013).
    const centers = expandSocketCenters(connectorReference, center, axis, profile)
    if (profile.partNumber === '3022' && /^stud4\.dat$/.test(connectorReference.source)) centers.push(center)
    // A 1x2 plate's underside pin fits the hollow stud of a Travis brick.
    // Keep the mechanical pin and bore separate from the surrounding stud sockets.
    const pin = ['3004', '3023', '3710', '2431', '6636', '4162', '63864'].includes(profile.partNumber) && /^stud3\.dat$/.test(connectorReference.source)
    const bore = ['4733', '47905', '87087', '6541'].includes(profile.partNumber) && /^stud2a?\.dat$/.test(connectorReference.source)
    if (pin || bore) {
      connectors.push({ idSuffix: `bar-${connectors.length}`, kind: 'bar', gender: pin ? 'male' : 'female', axis, direction,
        pose: { xStud: center.x, yStud: center.y, zStud: center.z } })
    }
    for (const socketCenter of centers) {
      const connector = {
        source: connectorReference.source,
        point: connectorReference.point,
        socketExpansion: connectorReference.socketExpansion,
        kind: connectorReference.kind,
        gender: connectorReference.gender,
        axis,
        direction,
        pose: connectorPoseFromCenter(socketCenter, axis, direction, profile),
      }
      const key = connectorKey(connector)
      if (seen.has(key)) continue
      seen.add(key)
      connectors.push(connector)
    }
  }

  // The open 1x2 tile cavity also accepts a centered stud (21007, step 15).
  if (profile.partNumber === '3069') {
    for (const x of [0.5, 1, 1.5]) connectors.push({ kind: 'tube', gender: 'female', axis: 'y', direction: { x: 0, y: -1, z: 0 }, pose: { xStud: x - 0.5, yStud: 0, zStud: 0 } })
  }
  // Audited mechanical insertion points from the actual 2458/6541 pin and
  // 59900/30374 cone/rod geometry, rather than overlapping bounding boxes.
  const addMechanical = (kind, gender, point, axis, direction) => {
    const center = ldrawPointToLocal(point, frame, horizontalAxisMapping)
    connectors.push({ kind, gender, axis, direction, pose: { xStud: center.x, yStud: center.y, zStud: center.z } })
  }
  if (profile.partNumber === '2458') addMechanical('pin', 'male', [0, 10, -20], 'z', { x: 0, y: 0, z: -1 })
  if (profile.partNumber === '6541') {
    addMechanical('pin', 'female', [0, 10, 0], 'z', { x: 0, y: 0, z: 1 })
    addMechanical('pin', 'female', [0, 10, 0], 'z', { x: 0, y: 0, z: -1 })
  }
  if (profile.partNumber === '59900') addMechanical('bar', 'female', [0, 24, 0], 'y', { x: 0, y: 1, z: 0 })
  if (profile.partNumber === '30374') addMechanical('bar', 'male', [0, 80, 0], 'y', { x: 0, y: -1, z: 0 })

  return connectors.map((connector, index) => ({
    idSuffix: `${connector.kind}-${index}`,
    ...connector,
  }))
}

const preservesLocalWinding = (horizontalAxisMapping) => horizontalAxisMapping === 'swapped'

const mapTriangleToLocal = (triangle, frame, horizontalAxisMapping) => {
  const localTriangle = triangle.map((point) => ldrawPointToLocal(point, frame, horizontalAxisMapping))
  return preservesLocalWinding(horizontalAxisMapping)
    ? localTriangle
    : [localTriangle[0], localTriangle[2], localTriangle[1]]
}

const generatedVisualProfiles = []
const generatedConnectorProfiles = []
const auditRows = []
const printedParts = {}
const printColorHex = new Map((await readFile(join(publicLDrawDir, 'LDConfig.ldr'), 'utf8')).split(/\r?\n/).flatMap((line) => {
  const match = line.match(/!COLOUR.*?\sCODE\s+(\d+)\s+VALUE\s+(#[0-9A-Fa-f]{6})/)
  return match ? [[Number(match[1]), match[2]]] : []
}))

for (const profile of partProfiles) {
  const { triangles, triangleColors, connectorReferences } = await parseFile(`parts/${profile.partNumber}.dat`)
  if (triangles.length === 0) continue

  const frame = getBounds(triangles)
  const horizontalAxisMapping = getHorizontalAxisMapping(frame, profile)
  const alignedFrame = getAlignedFrame(frame, profile, horizontalAxisMapping, connectorReferences)
  const visualTriangles = triangles.map((triangle) => mapTriangleToLocal(triangle, alignedFrame, horizontalAxisMapping))
  if (/p[0-9a-z]+$/.test(profile.partNumber)) {
    const layers = new Map()
    visualTriangles.forEach((triangle, index) => {
      const color = triangleColors[index]
      if (color === 16) return
      if (!layers.has(color)) layers.set(color, [])
      layers.get(color).push(...triangle.flatMap((point) => [point.x, point.y, point.z]))
    })
    printedParts[profile.partNumber] = [...layers].map(([color, positions]) => {
      const hex = printColorHex.get(color)
      if (!hex) throw new Error(`Missing printed colour ${color} in ${profile.partNumber}`)
      return { color, hex, positions }
    })
  }
  const connectors = makeGeneratedConnectors(profile, alignedFrame, horizontalAxisMapping, connectorReferences)

  generatedVisualProfiles.push({
    partNumber: profile.partNumber,
    triangles: visualTriangles,
  })
  if (connectors.length > 0) {
    generatedConnectorProfiles.push({
      partNumber: profile.partNumber,
      connectors,
    })
  }
  auditRows.push({
    partNumber: profile.partNumber,
    triangles: visualTriangles.length,
    connectors: connectors.length,
    frame,
    alignedFrame,
    horizontalAxisMapping,
  })
}

const serializeTriangleValueProfiles = (profiles) => profiles.map((profile) => {
  const triangles = profile.triangles.flatMap((triangle) =>
    triangle.flatMap((point) => [point.x, point.y, point.z]),
  ).map(formatNumber).join(',')

  return `  ${JSON.stringify(profile.partNumber)}: [${triangles}],`
}).join('\n')

const makeGeneratedTriangleModule = (
  exportName,
  valuesName,
  cacheName,
  profiles,
  structuralVoxelizerImport = './structuralVoxelizer',
) => `import type { MeshTriangle } from '${structuralVoxelizerImport}'

const ${valuesName}: Record<string, number[]> = {
${serializeTriangleValueProfiles(profiles)}
}

const ${cacheName} = new Map<string, MeshTriangle[]>()

export const ${exportName} = (partNumber: string) => {
  const cached = ${cacheName}.get(partNumber)
  if (cached) return cached

  const values = ${valuesName}[partNumber]
  if (!values) return undefined

  const triangles: MeshTriangle[] = []
  for (let index = 0; index < values.length; index += 9) {
    triangles.push([
      { x: values[index], y: values[index + 1], z: values[index + 2] },
      { x: values[index + 3], y: values[index + 4], z: values[index + 5] },
      { x: values[index + 6], y: values[index + 7], z: values[index + 8] },
    ])
  }

  ${cacheName}.set(partNumber, triangles)
  return triangles
}
`

// Keep existing geometry chunks stable when adding catalogue parts.
const previousManifest = existsSync(visualOutputPath) ? await readFile(visualOutputPath, 'utf8') : ''
const previousChunkByPart = new Map([...previousManifest.matchAll(/"(\d+)": loadVisualChunk(\d+),/g)].map((match) => [match[1], Number(match[2])]))
const previousChunkCount = previousChunkByPart.size ? Math.max(...previousChunkByPart.values()) + 1 : 0
const generatedVisualChunks = Array.from({ length: previousChunkCount }, () => [])
const newProfiles = []
for (const profile of generatedVisualProfiles) {
  const index = previousChunkByPart.get(profile.partNumber)
  if (index === undefined) newProfiles.push(profile)
  else generatedVisualChunks[index].push(profile)
}
let currentVisualChunk = []
let currentVisualChunkSourceLength = 0
for (const profile of newProfiles) {
  const profileSourceLength = serializeTriangleValueProfiles([profile]).length
  if (currentVisualChunk.length && currentVisualChunkSourceLength + profileSourceLength > 300_000) {
    generatedVisualChunks.push(currentVisualChunk)
    currentVisualChunk = []
    currentVisualChunkSourceLength = 0
  }
  currentVisualChunk.push(profile)
  currentVisualChunkSourceLength += profileSourceLength
}
if (currentVisualChunk.length) generatedVisualChunks.push(currentVisualChunk)

const visualChunkNames = generatedVisualChunks.map((_, index) => `chunk-${String(index).padStart(2, '0')}`)
const makeGeneratedVisualManifest = () => {
  const loaderDeclarations = visualChunkNames.map((chunkName, index) =>
    `const loadVisualChunk${index} = () => import('./ldrawGeneratedVisualChunks/${chunkName}')`,
  ).join('\n')
  const loaderEntries = generatedVisualChunks.flatMap((profiles, index) => profiles.map((profile) =>
    `  ${JSON.stringify(profile.partNumber)}: loadVisualChunk${index},`,
  )).join('\n')

  return `import type { MeshTriangle } from './structuralVoxelizer'

export type LDrawGeneratedVisualChunk = {
  getLDrawGeneratedVisualTriangles: (partNumber: string) => MeshTriangle[] | undefined
}

${loaderDeclarations}

export const ldrawGeneratedVisualChunkLoaders: Record<
  string,
  () => Promise<LDrawGeneratedVisualChunk>
> = {
${loaderEntries}
}

export const ldrawGeneratedVisualPartNumbers = Object.keys(ldrawGeneratedVisualChunkLoaders)
`
}

const serializeConnectorProfiles = (profiles) => profiles.map((profile) => {
  const connectors = profile.connectors.map((connector) => {
    const serializedConnector = { ...connector }
    delete serializedConnector.source
    delete serializedConnector.point
    delete serializedConnector.socketExpansion
    return JSON.stringify(serializedConnector)
  }).join(',')
  return `  ${JSON.stringify(profile.partNumber)}: [${connectors}],`
}).join('\n')

const makeGeneratedConnectorModule = (profiles) => `import type { BrickConnector } from '../types/bricks'

type LDrawGeneratedConnector = Omit<BrickConnector, 'id'> & {
  idSuffix: string
}

const ldrawGeneratedConnectors: Record<string, LDrawGeneratedConnector[]> = {
${serializeConnectorProfiles(profiles)}
}

export const getLDrawGeneratedConnectors = (partNumber: string, brickId: string): BrickConnector[] | undefined => {
  const connectors = ldrawGeneratedConnectors[partNumber]
  if (!connectors) return undefined

  return connectors.map(({ idSuffix, ...connector }) => ({
    id: \`\${brickId}-ldraw-\${idSuffix}\`,
    ...connector,
  }))
}
`

await rm(visualChunkOutputDir, { recursive: true, force: true })
await mkdir(visualChunkOutputDir, { recursive: true })
await Promise.all(generatedVisualChunks.map((profiles, index) => writeFile(
  join(visualChunkOutputDir, `${visualChunkNames[index]}.ts`),
  makeGeneratedTriangleModule(
    'getLDrawGeneratedVisualTriangles',
    'ldrawGeneratedVisualTriangleValues',
    'visualTriangleCache',
    profiles,
    '../structuralVoxelizer',
  ),
)))
await writeFile(visualOutputPath, makeGeneratedVisualManifest())
await writeFile(connectorOutputPath, makeGeneratedConnectorModule(generatedConnectorProfiles))

console.log(JSON.stringify({
  generated: generatedVisualProfiles.length,
  generatedVisualChunks: generatedVisualChunks.length,
  generatedConnectorProfiles: generatedConnectorProfiles.length,
  visualOutputPath,
  connectorOutputPath,
  audits: auditRows.map((row) => ({
    partNumber: row.partNumber,
    triangles: row.triangles,
    connectors: row.connectors,
    horizontalAxisMapping: row.horizontalAxisMapping,
    alignedFrame: row.alignedFrame,
    frame: Object.fromEntries(Object.entries(row.frame).map(([key, value]) => [key, round(value)])),
  })),
}, null, 2))

await writeFile(join(workspace, 'src/data/ldrawPrintedParts.json'), JSON.stringify(printedParts) + '\n')
