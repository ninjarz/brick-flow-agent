import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputPath = resolve(root, 'src/data/generatedObjAssets.ts')
const layerHeightStuds = 1.2
const coverageThreshold = 0.26
const raySamples = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
]

const profiles = [
  { id: 's', label: 'S', resolution: 16 },
  { id: 'm', label: 'M', resolution: 24 },
  { id: 'l', label: 'L', resolution: 32 },
]

const sources = [
  {
    id: 'stanford-bunny',
    title: 'Stanford Bunny',
    path: resolve(root, '.ignored/objs/stanford-bunny.obj'),
  },
  {
    id: 'armadillo',
    title: 'Armadillo',
    path: resolve(root, '.ignored/objs/armadillo.obj'),
    orientationByProfile: { s: 'lay-side' },
    defaultProfileIds: ['s'],
  },
]

const brickTypes = [
  { id: 'brick-2x8', name: '2x8 Brick', width: 8, depth: 2 },
  { id: 'brick-1x6', name: '1x6 Brick', width: 6, depth: 1 },
  { id: 'brick-2x4', name: '2x4 Brick', width: 4, depth: 2 },
  { id: 'brick-1x4', name: '1x4 Brick', width: 4, depth: 1 },
  { id: 'brick-2x3', name: '2x3 Brick', width: 3, depth: 2 },
  { id: 'brick-1x3', name: '1x3 Brick', width: 3, depth: 1 },
  { id: 'brick-2x2', name: '2x2 Brick', width: 2, depth: 2 },
  { id: 'brick-1x2', name: '1x2 Brick', width: 2, depth: 1 },
  { id: 'brick-1x1', name: '1x1 Brick', width: 1, depth: 1 },
]

const slopeBrickTypes = [
  { id: 'slope-1x2', name: '1x2 Slope', width: 2, depth: 1, rotationQuarterTurns: 0, highOffset: [1, 0], isSlope: true },
  { id: 'slope-1x2', name: '1x2 Slope', width: 1, depth: 2, rotationQuarterTurns: 1, highOffset: [0, 1], isSlope: true },
  { id: 'slope-1x2', name: '1x2 Slope', width: 2, depth: 1, rotationQuarterTurns: 2, highOffset: [0, 0], isSlope: true },
  { id: 'slope-1x2', name: '1x2 Slope', width: 1, depth: 2, rotationQuarterTurns: 3, highOffset: [0, 0], isSlope: true },
]

const round = (value) => Math.round(value * 1_000_000) / 1_000_000
const cellKey = (x, y, z) => `${x},${y},${z}`
const layerCellKey = (x, z) => `${x},${z}`
const parseCellKey = (key) => key.split(',').map(Number)

const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = { write: true, sources, profiles, profileExplicit: false }

  for (const arg of args) {
    if (arg === '--dry-run') options.write = false
    if (arg.startsWith('--source=')) {
      const sourceId = arg.slice('--source='.length)
      options.sources = sources.filter((source) => source.id === sourceId)
    }
    if (arg.startsWith('--profile=')) {
      const profileId = arg.slice('--profile='.length).toLowerCase()
      options.profiles = profiles.filter((profile) => profile.id === profileId)
      options.profileExplicit = true
    }
  }

  if (options.sources.length === 0) throw new Error('Unknown --source value')
  if (options.profiles.length === 0) throw new Error('Unknown --profile value')
  return options
}

const parseObj = (text) => {
  const vertices = []
  const triangles = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('v ')) {
      const [x, y, z] = line.split(/\s+/).slice(1, 4).map(Number)
      if ([x, y, z].every(Number.isFinite)) vertices.push({ x, y, z })
      continue
    }
    if (!line.startsWith('f ')) continue

    const indices = line.split(/\s+/).slice(1).map((token) => {
      const parsed = Number(token.split('/')[0])
      return parsed < 0 ? vertices.length + parsed : parsed - 1
    })
    for (let index = 1; index + 1 < indices.length; index += 1) {
      const triangle = [vertices[indices[0]], vertices[indices[index]], vertices[indices[index + 1]]]
      if (triangle.every(Boolean)) triangles.push(triangle)
    }
  }

  if (vertices.length === 0 || triangles.length === 0) throw new Error('OBJ contains no usable geometry')
  return { vertices, triangles }
}

const getBounds = (vertices) => {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }
  for (const vertex of vertices) {
    bounds.minX = Math.min(bounds.minX, vertex.x)
    bounds.maxX = Math.max(bounds.maxX, vertex.x)
    bounds.minY = Math.min(bounds.minY, vertex.y)
    bounds.maxY = Math.max(bounds.maxY, vertex.y)
    bounds.minZ = Math.min(bounds.minZ, vertex.z)
    bounds.maxZ = Math.max(bounds.maxZ, vertex.z)
  }
  return bounds
}

const orientMesh = (mesh, orientation) => {
  if (!orientation) return mesh
  const transform = orientation === 'lay-back'
    ? (vertex) => ({ x: vertex.x, y: vertex.z, z: vertex.y })
    : (vertex) => ({ x: vertex.y, y: vertex.x, z: vertex.z })
  return {
    vertices: mesh.vertices.map(transform),
    triangles: mesh.triangles.map((triangle) => triangle.map(transform)),
  }
}

const normalizeMesh = (mesh, resolution) => {
  const bounds = getBounds(mesh.vertices)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const depth = bounds.maxZ - bounds.minZ
  const scale = resolution / Math.max(width, depth, height / layerHeightStuds)
  const transform = (vertex) => ({
    x: (vertex.x - bounds.minX) * scale,
    y: ((vertex.y - bounds.minY) * scale) / layerHeightStuds,
    z: (vertex.z - bounds.minZ) * scale,
  })
  const vertices = mesh.vertices.map(transform)
  const triangles = mesh.triangles.map((triangle) => triangle.map(transform))
  const dimensions = {
    width: Math.max(1, Math.ceil(width * scale)),
    height: Math.max(1, Math.ceil((height * scale) / layerHeightStuds)),
    depth: Math.max(1, Math.ceil(depth * scale)),
  }
  return { vertices, triangles, dimensions }
}

const buildTriangleBins = (triangles, dimensions) => {
  const bins = Array.from({ length: dimensions.width * dimensions.depth }, () => [])
  triangles.forEach((triangle, triangleIndex) => {
    const xs = triangle.map((point) => point.x)
    const zs = triangle.map((point) => point.z)
    const minX = Math.max(0, Math.floor(Math.min(...xs)))
    const maxX = Math.min(dimensions.width - 1, Math.floor(Math.max(...xs)))
    const minZ = Math.max(0, Math.floor(Math.min(...zs)))
    const maxZ = Math.min(dimensions.depth - 1, Math.floor(Math.max(...zs)))
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) bins[z * dimensions.width + x].push(triangleIndex)
    }
  })
  return bins
}

const rayTriangleHeight = (x, z, triangle) => {
  const [a, b, c] = triangle
  const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
  if (Math.abs(denominator) < 1e-10) return undefined
  const weightA = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator
  const weightB = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator
  const weightC = 1 - weightA - weightB
  const tolerance = -1e-8
  if (weightA < tolerance || weightB < tolerance || weightC < tolerance) return undefined
  return weightA * a.y + weightB * b.y + weightC * c.y
}

const makeInsideIntervals = (x, z, triangleIndices, triangles, diagnostics) => {
  const hits = triangleIndices
    .map((index) => rayTriangleHeight(x, z, triangles[index]))
    .filter(Number.isFinite)
    .sort((source, target) => source - target)
  const uniqueHits = []
  for (const hit of hits) {
    if (uniqueHits.length === 0 || Math.abs(hit - uniqueHits.at(-1)) > 1e-6) uniqueHits.push(hit)
  }
  if (uniqueHits.length % 2 !== 0) diagnostics.oddRays += 1
  const intervals = []
  for (let index = 0; index + 1 < uniqueHits.length; index += 2) {
    if (uniqueHits[index + 1] - uniqueHits[index] > 1e-7) intervals.push([uniqueHits[index], uniqueHits[index + 1]])
  }
  return intervals
}

const intervalOverlap = (intervals, minY, maxY) => intervals.reduce(
  (total, [start, end]) => total + Math.max(0, Math.min(maxY, end) - Math.max(minY, start)),
  0,
)

const voxelizeMesh = ({ triangles, dimensions }) => {
  const bins = buildTriangleBins(triangles, dimensions)
  const occupied = new Set()
  const diagnostics = { rays: dimensions.width * dimensions.depth * raySamples.length, oddRays: 0 }

  for (let z = 0; z < dimensions.depth; z += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      const triangleIndices = bins[z * dimensions.width + x]
      if (triangleIndices.length === 0) continue
      const sampleIntervals = raySamples.map(([offsetX, offsetZ]) =>
        makeInsideIntervals(x + offsetX, z + offsetZ, triangleIndices, triangles, diagnostics)
      )
      for (let y = 0; y < dimensions.height; y += 1) {
        const coverage = sampleIntervals.reduce(
          (total, intervals) => total + intervalOverlap(intervals, y, y + 1),
          0,
        ) / raySamples.length
        const centerVotes = sampleIntervals.filter((intervals) =>
          intervals.some(([start, end]) => start <= y + 0.5 && end >= y + 0.5)
        ).length
        if (coverage >= coverageThreshold || centerVotes >= 2) occupied.add(cellKey(x, y, z))
      }
    }
  }

  return { occupied, diagnostics }
}

const getNeighbors = (x, y, z) => [
  cellKey(x - 1, y, z),
  cellKey(x + 1, y, z),
  cellKey(x, y - 1, z),
  cellKey(x, y + 1, z),
  cellKey(x, y, z - 1),
  cellKey(x, y, z + 1),
]

const keepLargestComponent = (occupied) => {
  const unseen = new Set(occupied)
  let largest = new Set()
  while (unseen.size > 0) {
    const first = unseen.values().next().value
    const component = new Set([first])
    const queue = [first]
    unseen.delete(first)
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y, z] = parseCellKey(queue[index])
      for (const neighbor of getNeighbors(x, y, z)) {
        if (!unseen.delete(neighbor)) continue
        component.add(neighbor)
        queue.push(neighbor)
      }
    }
    if (component.size > largest.size) largest = component
  }
  return { occupied: largest, removed: occupied.size - largest.size }
}

const setIoU = (source, target) => {
  let intersection = 0
  for (const key of source) if (target.has(key)) intersection += 1
  return intersection / Math.max(1, source.size + target.size - intersection)
}

const projectVoxels = (occupied, axes) => {
  const projection = new Set()
  for (const key of occupied) {
    const coordinates = parseCellKey(key)
    projection.add(`${coordinates[axes[0]]},${coordinates[axes[1]]}`)
  }
  return projection
}

const getShapeMetrics = (source, target) => ({
  voxelIoU: setIoU(source, target),
  frontSilhouetteIoU: setIoU(projectVoxels(source, [0, 1]), projectVoxels(target, [0, 1])),
  sideSilhouetteIoU: setIoU(projectVoxels(source, [2, 1]), projectVoxels(target, [2, 1])),
  topSilhouetteIoU: setIoU(projectVoxels(source, [0, 2]), projectVoxels(target, [0, 2])),
})

const regularBrickTypes = brickTypes.flatMap((brick) => {
  const orientations = [{ ...brick, rotationQuarterTurns: 0 }]
  if (brick.width !== brick.depth) {
    orientations.push({ ...brick, width: brick.depth, depth: brick.width, rotationQuarterTurns: 1 })
  }
  return orientations
})
const orientedBrickTypes = [...regularBrickTypes, ...slopeBrickTypes]
const oneByOneBrick = regularBrickTypes.find((brick) => brick.id === 'brick-1x1')

const placementCells = (placement) => {
  const cells = []
  for (let dz = 0; dz < placement.depth; dz += 1) {
    for (let dx = 0; dx < placement.width; dx += 1) cells.push(layerCellKey(placement.x + dx, placement.z + dz))
  }
  return cells
}

const placementTopConnectorCells = (placement) => placement.isSlope
  ? [layerCellKey(placement.x + placement.highOffset[0], placement.z + placement.highOffset[1])]
  : placementCells(placement)

const placementsContaining = (targetX, targetZ, layer, aboveLayer, belowConnectors, unassigned, requireSupport, forcedColumns) => {
  const placements = []
  for (const brick of orientedBrickTypes) {
    for (let offsetZ = 0; offsetZ < brick.depth; offsetZ += 1) {
      for (let offsetX = 0; offsetX < brick.width; offsetX += 1) {
        const placement = { ...brick, x: targetX - offsetX, z: targetZ - offsetZ }
        const cells = placementCells(placement)
        if (!cells.every((key) => layer.has(key) && unassigned.has(key))) continue
        if (cells.some((key) => forcedColumns.has(key)) && (brick.id !== 'brick-1x1' || cells.length !== 1)) continue
        if (brick.isSlope) {
          const highKey = layerCellKey(placement.x + brick.highOffset[0], placement.z + brick.highOffset[1])
          const lowKey = cells.find((key) => key !== highKey)
          if (!aboveLayer.has(highKey) || aboveLayer.has(lowKey)) continue
        }
        const bottomConnectorCells = cells
        const connectorCells = placementTopConnectorCells(placement)
        const supportCells = bottomConnectorCells.filter((key) => belowConnectors.has(key))
        if (requireSupport && supportCells.length === 0) continue
        placements.push({ ...placement, cells, connectorCells, supportCells })
      }
    }
  }
  return placements
}

const addMinimalSupports = (occupied, dimensions) => {
  const repaired = new Set(occupied)
  let bridgeAdded = 0
  let columnAdded = 0

  for (let y = 1; y < dimensions.height; y += 1) {
    const layer = new Set()
    const below = new Set()
    for (const key of repaired) {
      const [x, cellY, z] = parseCellKey(key)
      if (cellY === y) layer.add(layerCellKey(x, z))
      if (cellY === y - 1) below.add(layerCellKey(x, z))
    }
    for (const key of layer) {
      if (below.has(key)) continue
      const [x, z] = key.split(',').map(Number)
      const bridgeCandidates = []
      for (const brick of regularBrickTypes) {
        for (let offsetZ = 0; offsetZ < brick.depth; offsetZ += 1) {
          for (let offsetX = 0; offsetX < brick.width; offsetX += 1) {
            const placement = { ...brick, x: x - offsetX, z: z - offsetZ }
            const cells = placementCells(placement)
            if (!cells.some((cell) => below.has(cell))) continue
            const missing = cells.filter((cell) => !layer.has(cell))
            if (missing.length <= 2) bridgeCandidates.push({ cells, missing })
          }
        }
      }
      bridgeCandidates.sort((source, target) =>
        source.missing.length - target.missing.length || source.cells.length - target.cells.length
      )
      const bridge = bridgeCandidates[0]
      if (bridge) {
        for (const missingKey of bridge.missing) {
          const [supportX, supportZ] = missingKey.split(',').map(Number)
          layer.add(missingKey)
          repaired.add(cellKey(supportX, y, supportZ))
          bridgeAdded += 1
        }
        continue
      }

      for (let supportY = y - 1; supportY >= 0; supportY -= 1) {
        const supportKey = cellKey(x, supportY, z)
        if (repaired.has(supportKey)) break
        repaired.add(supportKey)
        columnAdded += 1
      }
    }
  }

  return { occupied: repaired, added: bridgeAdded + columnAdded, bridgeAdded, columnAdded }
}

const isBoundaryCell = (key, layer) => {
  const [x, z] = key.split(',').map(Number)
  return [
    layerCellKey(x - 1, z),
    layerCellKey(x + 1, z),
    layerCellKey(x, z - 1),
    layerCellKey(x, z + 1),
  ].some((neighbor) => !layer.has(neighbor))
}

const tileLayer = (layer, aboveLayer, belowBrickByConnector, y, forcedColumns, findComponent) => {
  const unassigned = new Set(layer)
  const placements = []
  const brickByConnector = new Map()
  const belowConnectors = new Set(belowBrickByConnector.keys())

  while (unassigned.size > 0) {
    let selectedTarget
    let selectedCandidates
    let selectedPriority = Infinity
    for (const key of unassigned) {
      const [x, z] = key.split(',').map(Number)
      const candidates = placementsContaining(x, z, layer, aboveLayer, belowConnectors, unassigned, y > 0, forcedColumns)
      const forcedPenalty = forcedColumns.has(key) ? -2000 : 0
      const unsupportedPenalty = y > 0 && !belowConnectors.has(key) ? -1000 : 0
      const priority = forcedPenalty + unsupportedPenalty + candidates.length
      if (priority >= selectedPriority) continue
      selectedPriority = priority
      selectedTarget = { x, z, key }
      selectedCandidates = candidates
    }

    if (!selectedTarget) break
    const candidates = selectedCandidates.length > 0
      ? selectedCandidates
      : placementsContaining(selectedTarget.x, selectedTarget.z, layer, aboveLayer, belowConnectors, unassigned, false, forcedColumns)
    const scored = candidates.map((candidate) => {
      const area = candidate.cells.length
      const boundaryCount = candidate.cells.filter((key) => isBoundaryCell(key, layer)).length
      const belowBricks = new Set(candidate.supportCells.map((key) => belowBrickByConnector.get(key)).filter((value) => value !== undefined))
      const belowComponents = new Set([...belowBricks].map(findComponent))
      const longAlongX = candidate.width > candidate.depth
      const preferredOrientation = y % 2 === 0 ? longAlongX : !longAlongX
      const slopeBonus = candidate.isSlope ? 1500 : 0
      const score = area * 20 - boundaryCount * Math.max(0, area - 2) * 6 + belowBricks.size * 12 + belowComponents.size * 1000 + slopeBonus + (preferredOrientation ? 5 : 0)
      return { candidate, score }
    }).sort((source, target) =>
      target.score - source.score ||
      target.candidate.cells.length - source.candidate.cells.length ||
      source.candidate.id.localeCompare(target.candidate.id) ||
      source.candidate.rotationQuarterTurns - target.candidate.rotationQuarterTurns
    )
    const placement = scored[0]?.candidate ?? {
      ...oneByOneBrick,
      x: selectedTarget.x,
      z: selectedTarget.z,
      cells: [selectedTarget.key],
      connectorCells: [selectedTarget.key],
      supportCells: belowConnectors.has(selectedTarget.key) ? [selectedTarget.key] : [],
    }
    const placementIndex = placements.length
    placements.push(placement)
    for (const key of placement.cells) {
      unassigned.delete(key)
    }
    for (const key of placement.connectorCells) brickByConnector.set(key, placementIndex)
  }

  return { placements, brickByConnector }
}

const tileVoxels = (occupied, dimensions, forcedColumns = new Set()) => {
  const bricks = []
  const unsupported = []
  let previousBrickByConnector = new Map()
  const layers = Array.from({ length: dimensions.height }, () => new Set())
  for (const key of occupied) {
    const [x, y, z] = parseCellKey(key)
    if (layers[y]) layers[y].add(layerCellKey(x, z))
  }
  const parents = []
  const findComponent = (index) => {
    let root = index
    while (parents[root] !== root) root = parents[root]
    while (parents[index] !== index) {
      const next = parents[index]
      parents[index] = root
      index = next
    }
    return root
  }
  const unionComponents = (source, target) => {
    const sourceRoot = findComponent(source)
    const targetRoot = findComponent(target)
    if (sourceRoot !== targetRoot) parents[targetRoot] = sourceRoot
  }

  for (let y = 0; y < dimensions.height; y += 1) {
    const layer = layers[y]
    const aboveLayer = layers[y + 1] ?? new Set()
    if (layer.size === 0) {
      previousBrickByConnector = new Map()
      continue
    }
    const tiled = tileLayer(layer, aboveLayer, previousBrickByConnector, y, forcedColumns, findComponent)
    const globalBrickByConnector = new Map()
    tiled.placements.forEach((placement) => {
      const brickIndex = bricks.length
      bricks.push({ ...placement, y })
      parents.push(brickIndex)
      const supportingBricks = new Set(placement.supportCells.map((key) => previousBrickByConnector.get(key)).filter((value) => value !== undefined))
      for (const supportingBrick of supportingBricks) unionComponents(brickIndex, supportingBrick)
      if (y > 0 && placement.supportCells.length === 0) {
        const [x, z] = placement.connectorCells[0].split(',').map(Number)
        unsupported.push({ x, y, z, cells: placement.cells })
      }
      placement.connectorCells.forEach((key) => globalBrickByConnector.set(key, brickIndex))
    })
    previousBrickByConnector = globalBrickByConnector
  }
  const componentCount = new Set(bricks.map((_, index) => findComponent(index))).size
  return { bricks, unsupported, componentCount }
}

const createAsset = (source, profile, parsedMesh) => {
  const orientation = source.orientationByProfile?.[profile.id]
  const normalized = normalizeMesh(orientMesh(parsedMesh, orientation), profile.resolution)
  const voxelized = voxelizeMesh(normalized)
  const connected = keepLargestComponent(voxelized.occupied)
  const repaired = addMinimalSupports(connected.occupied, normalized.dimensions)
  const finalOccupied = new Set(repaired.occupied)
  let prunedUnsupportedVoxels = 0
  let tiled
  for (let attempt = 0; attempt < 8; attempt += 1) {
    tiled = tileVoxels(finalOccupied, normalized.dimensions)
    if (tiled.unsupported.length === 0) break
    let removedThisAttempt = 0
    for (const unsupported of tiled.unsupported) {
      for (const layerKey of unsupported.cells) {
        const [x, z] = layerKey.split(',').map(Number)
        if (finalOccupied.delete(cellKey(x, unsupported.y, z))) {
          prunedUnsupportedVoxels += 1
          removedThisAttempt += 1
        }
      }
    }
    if (removedThisAttempt === 0) break
  }
  const placements = tiled.bricks
  const shapeMetrics = getShapeMetrics(connected.occupied, finalOccupied)
  const prefix = `${source.id}-${profile.id}`
  const bricks = placements.map((placement, index) => ({
    id: `piece-${prefix}-${index + 1}`,
    brickId: placement.id,
    color: 'gray',
    pose: {
      xStud: placement.x,
      yStud: round(placement.y * layerHeightStuds),
      zStud: placement.z,
      rotationQuarterTurns: placement.rotationQuarterTurns,
      verticalQuarterTurns: 0,
    },
  }))
  const nameById = new Map([...brickTypes, ...slopeBrickTypes].map((brick) => [brick.id, brick.name]))
  const steps = bricks.map((brick, index) => ({
    id: `step-${prefix}-${index + 1}`,
    title: `放置 ${nameById.get(brick.brickId)}`,
    description: `放置第 ${index + 1} 个零件：${nameById.get(brick.brickId)}。`,
    brickIds: [brick.id],
  }))
  const dimensions = `${normalized.dimensions.width}×${normalized.dimensions.height}×${normalized.dimensions.depth}`
  const totalSupports = repaired.added
  const supportRatio = totalSupports / Math.max(1, connected.occupied.size)
  const structuralChangeRatio = (totalSupports + prunedUnsupportedVoxels) / Math.max(1, connected.occupied.size)
  const description = [
    `从 ${source.title} OBJ 通过四点超采样实体体素化和轮廓优先分砖生成的灰色积木雕像。`,
    `档位 ${profile.label}，${orientation === 'lay-side' ? '侧卧' : '直立'}构建，网格 ${dimensions}，保形体素 ${connected.occupied.size} 个，横向补形 ${repaired.bridgeAdded} 个，竖向支撑 ${repaired.columnAdded} 个，裁剪不可搭建边界 ${prunedUnsupportedVoxels} 个（结构改动合计 ${(structuralChangeRatio * 100).toFixed(1)}%），生成 ${bricks.length} 个零件。`,
  ].join(' ')

  return {
    asset: {
      id: `finished-obj-${prefix}`,
      title: `${source.title} ${profile.label}`,
      category: 'OBJ',
      description,
      plan: {
        id: `plan-obj-${prefix}`,
        title: `${source.title} ${profile.label}`,
        prompt: `${source.title} OBJ shape-preserving brick statue ${profile.label}`,
        source: 'template-local',
        bricks,
        steps,
      },
    },
    metrics: {
      source: basename(source.path),
      profile: profile.label,
      orientation: orientation ?? 'upright',
      dimensions,
      voxels: connected.occupied.size,
      removedComponents: connected.removed,
      supports: totalSupports,
      bridgeSupports: repaired.bridgeAdded,
      columnSupports: repaired.columnAdded,
      prunedUnsupportedVoxels,
      unresolvedSupports: tiled.unsupported.length,
      componentCount: tiled.componentCount,
      supportRatio,
      structuralChangeRatio,
      bricks: bricks.length,
      slopes: bricks.filter((brick) => brick.brickId === 'slope-1x2').length,
      ...shapeMetrics,
      oddRayRatio: voxelized.diagnostics.oddRays / voxelized.diagnostics.rays,
    },
  }
}

const main = async () => {
  const options = parseArgs()
  const assets = []
  for (const source of options.sources) {
    const parsed = parseObj(await readFile(source.path, 'utf8'))
    for (const profile of options.profiles) {
      if (!options.profileExplicit && source.defaultProfileIds && !source.defaultProfileIds.includes(profile.id)) continue
      const result = createAsset(source, profile, parsed)
      assets.push(result.asset)
      console.log(JSON.stringify(result.metrics))
    }
  }

  if (!options.write) return
  const source = `import type { FinishedAsset } from '../types/bricks'\n\nexport const generatedObjAssets: FinishedAsset[] = ${JSON.stringify(assets, null, 2)}\n`
  await writeFile(outputPath, source)
  console.log(`Wrote ${assets.length} assets to ${outputPath}`)
}

await main()
