import { brickDefinitions } from '../data/basicBricks'
import type { BrickColor, BrickRotationQuarterTurns, BrickVerticalQuarterTurns, BuildPlan, PlacedBrick } from '../types/bricks'
import { footprintToWorld, normalizeHorizontalStud, normalizeYStud } from './brickUnits'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'
import { tryNormalizeImportedPlan } from './planImport'
import { createSingleBrickSteps } from './planUtils'

type Matrix3 = [number, number, number, number, number, number, number, number, number]
type Vector3Tuple = [number, number, number]

type LDrawReference = {
  colorCode: number
  translation: Vector3Tuple
  matrix: Matrix3
  partName: string
}

export type LDrawImportResult = {
  plan: BuildPlan
  usedEmbeddedPlan: boolean
  ignoredParts: number
  unknownPartNumbers: string[]
}

const ldrawUnitsPerStud = 20
const metadataPrefix = '0 !BRICK_FLOW_AGENT_PLAN'
const metadataChunkLength = 180

const colorToLDrawCode: Record<BrickColor, number> = {
  black: 0,
  blue: 1,
  green: 2,
  cyan: 3,
  red: 4,
  brown: 6,
  gray: 7,
  pink: 13,
  yellow: 14,
  white: 15,
  tan: 19,
  lime: 27,
  orange: 25,
  'trans-pink': 41,
}

const ldrawCodeToColor = new Map<number, BrickColor>(
  Object.entries(colorToLDrawCode).map(([color, code]) => [code, color as BrickColor]),
)

const identity: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const horizontalMatrices: Matrix3[] = [
  identity,
  [0, 0, -1, 0, 1, 0, 1, 0, 0],
  [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  [0, 0, 1, 0, 1, 0, -1, 0, 0],
]
const verticalMatrices: Matrix3[] = [
  identity,
  [1, 0, 0, 0, 0, 1, 0, -1, 0],
  [1, 0, 0, 0, -1, 0, 0, 0, -1],
  [1, 0, 0, 0, 0, -1, 0, 1, 0],
]

const multiplyMatrices = (source: Matrix3, target: Matrix3): Matrix3 => {
  const result = Array.from({ length: 9 }, () => 0)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      result[row * 3 + column] = [0, 1, 2].reduce(
        (total, index) => total + source[row * 3 + index] * target[index * 3 + column],
        0,
      )
    }
  }
  return result as Matrix3
}

const appMatrixToLDraw = (matrix: Matrix3): Matrix3 => {
  const flipY: Matrix3 = [1, 0, 0, 0, -1, 0, 0, 0, 1]
  return multiplyMatrices(multiplyMatrices(flipY, matrix), flipY)
}

const getLDrawMatrix = (horizontal: number, vertical: number) => appMatrixToLDraw(
  multiplyMatrices(horizontalMatrices[horizontal % 4], verticalMatrices[vertical % 4]),
)

const poseByMatrix = Array.from({ length: 4 }, (_, horizontal) =>
  Array.from({ length: 4 }, (_, vertical) => ({
    horizontal: horizontal as BrickRotationQuarterTurns,
    vertical: vertical as BrickVerticalQuarterTurns,
    matrix: getLDrawMatrix(horizontal, vertical),
  })),
).flat()

const matrixDistance = (source: Matrix3, target: Matrix3) => source.reduce(
  (total, value, index) => total + Math.abs(value - target[index]),
  0,
)

const formatNumber = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

const encodeBase64 = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  const chunks: string[] = []
  for (let index = 0; index < bytes.length; index += 8192) {
    chunks.push(String.fromCharCode(...bytes.slice(index, index + 8192)))
  }
  return btoa(chunks.join(''))
}

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const metadataLines = (plan: BuildPlan) => {
  const encoded = encodeBase64(JSON.stringify(plan))
  const chunks = Array.from({ length: Math.ceil(encoded.length / metadataChunkLength) }, (_, index) =>
    encoded.slice(index * metadataChunkLength, (index + 1) * metadataChunkLength)
  )
  return chunks.map((chunk, index) => `${metadataPrefix} ${index + 1}/${chunks.length} ${chunk}`)
}

const parseEmbeddedPlan = (text: string) => {
  const chunks = text.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith(`${metadataPrefix} `)) return []
    const match = line.slice(metadataPrefix.length + 1).match(/^(\d+)\/(\d+)\s+(.+)$/)
    return match ? [{ index: Number(match[1]), total: Number(match[2]), value: match[3] }] : []
  })
  if (chunks.length === 0 || chunks.some((chunk) => chunk.total !== chunks.length)) return undefined

  try {
    const decoded = JSON.parse(decodeBase64([...chunks].sort((a, b) => a.index - b.index).map((chunk) => chunk.value).join(''))) as BuildPlan
    return tryNormalizeImportedPlan(decoded)
  } catch {
    return undefined
  }
}

const sanitizeLDrawName = (value: string) => value.replace(/[\r\n]/g, ' ').trim() || 'brick-plan'

export const formatLDrawPlan = (plan: BuildPlan) => {
  const title = sanitizeLDrawName(plan.title)
  const lines = [
    `0 FILE ${title}.ldr`,
    `0 Name: ${title}.ldr`,
    '0 Author: brick-flow-agent',
    '0 !LICENSE Redistributable under CCAL version 2.0 : see CAreadme.txt',
    ...metadataLines(plan),
  ]

  for (const brick of plan.bricks) {
    const definition = brickDefinitions.find((candidate) => candidate.id === brick.brickId)
    if (!definition || definition.pack !== 'lego') continue
    const vertical = brick.pose.verticalQuarterTurns ?? 0
    const footprint = footprintToWorld(definition, brick.pose.rotationQuarterTurns, vertical)
    const centerX = brick.pose.xStud + footprint.widthStuds / 2
    const centerZ = brick.pose.zStud + footprint.depthStuds / 2
    const topY = brick.pose.yStud + footprint.heightStuds
    const matrix = getLDrawMatrix(brick.pose.rotationQuarterTurns, vertical)
    lines.push([
      1,
      colorToLDrawCode[brick.color],
      formatNumber(centerX * ldrawUnitsPerStud),
      formatNumber(-topY * ldrawUnitsPerStud),
      formatNumber(centerZ * ldrawUnitsPerStud),
      ...matrix.map(formatNumber),
      `${normalizeLDrawPartNumber(definition.partNumber)}.dat`,
    ].join(' '))
  }

  lines.push('0 NOFILE')
  return lines.join('\n')
}

const definitionByPartNumber = new Map(
  brickDefinitions
    .filter((definition) => definition.pack === 'lego')
    .map((definition) => [normalizeLDrawPartNumber(definition.partNumber), definition] as const),
)

const transformVector = (matrix: Matrix3, vector: Vector3Tuple): Vector3Tuple => [
  matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
  matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
  matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
]

const normalizeLDrawFileName = (value: string) => value.replaceAll('\\', '/').trim().toLowerCase()

const parseTypeOneReference = (rawLine: string): LDrawReference | undefined => {
  const fields = rawLine.trim().split(/\s+/)
  if (fields[0] !== '1' || fields.length < 15) return undefined
  const values = fields.slice(1, 14).map(Number)
  if (!values.every(Number.isFinite)) return undefined
  const [colorCode, x, y, z, ...matrixValues] = values
  return {
    colorCode,
    translation: [x, y, z],
    matrix: matrixValues as Matrix3,
    partName: fields.slice(14).join(' '),
  }
}

const expandLDrawReferences = (text: string) => {
  const rootSectionName = '__root__'
  const sections = new Map<string, string[]>([[rootSectionName, []]])
  let currentSectionName = rootSectionName
  let firstFileName: string | undefined

  for (const rawLine of text.split(/\r?\n/)) {
    const fileMatch = rawLine.trim().match(/^0\s+FILE\s+(.+)$/i)
    if (fileMatch) {
      currentSectionName = normalizeLDrawFileName(fileMatch[1])
      firstFileName ??= currentSectionName
      if (!sections.has(currentSectionName)) sections.set(currentSectionName, [])
      continue
    }
    sections.get(currentSectionName)?.push(rawLine)
  }

  const references: LDrawReference[] = []
  let ignoredParts = 0
  const unknownPartNumbers = new Set<string>()
  const rootName = firstFileName ?? rootSectionName

  const visit = (
    sectionName: string,
    parentMatrix: Matrix3,
    parentTranslation: Vector3Tuple,
    inheritedColorCode: number,
    ancestors: Set<string>,
  ) => {
    if (ancestors.has(sectionName) || ancestors.size >= 32) {
      ignoredParts += 1
      return
    }
    const lines = sections.get(sectionName)
    if (!lines) return
    const nextAncestors = new Set(ancestors).add(sectionName)

    for (const rawLine of lines) {
      if (rawLine.trim().startsWith('1 ') && !parseTypeOneReference(rawLine)) {
        ignoredParts += 1
        continue
      }
      const reference = parseTypeOneReference(rawLine)
      if (!reference) continue
      const normalizedReferenceName = normalizeLDrawFileName(reference.partName)
      const worldMatrix = multiplyMatrices(parentMatrix, reference.matrix)
      const transformedTranslation = transformVector(parentMatrix, reference.translation)
      const worldTranslation: Vector3Tuple = [
        parentTranslation[0] + transformedTranslation[0],
        parentTranslation[1] + transformedTranslation[1],
        parentTranslation[2] + transformedTranslation[2],
      ]
      const colorCode = reference.colorCode === 16 ? inheritedColorCode : reference.colorCode

      if (sections.has(normalizedReferenceName)) {
        visit(normalizedReferenceName, worldMatrix, worldTranslation, colorCode, nextAncestors)
        continue
      }

      const rawPartName = normalizedReferenceName.split('/').at(-1) ?? ''
      const partNumber = normalizeLDrawPartNumber(rawPartName)
      if (!definitionByPartNumber.has(partNumber)) {
        ignoredParts += 1
        unknownPartNumbers.add(partNumber)
        continue
      }
      references.push({ colorCode, translation: worldTranslation, matrix: worldMatrix, partName: rawPartName })
    }
  }

  visit(rootName, identity, [0, 0, 0], 16, new Set())
  return { references, ignoredParts, unknownPartNumbers: [...unknownPartNumbers].sort(), rootName }
}

export const parseLDrawPlan = (text: string, fallbackTitle = 'Imported LDraw'): LDrawImportResult | undefined => {
  const embeddedPlan = parseEmbeddedPlan(text)
  if (embeddedPlan) {
    return { plan: embeddedPlan, usedEmbeddedPlan: true, ignoredParts: 0, unknownPartNumbers: [] }
  }

  const bricks: PlacedBrick[] = []
  const expanded = expandLDrawReferences(text)

  for (const reference of expanded.references) {
    const { colorCode, matrix } = reference
    const [xLDraw, yLDraw, zLDraw] = reference.translation
    const rawPartName = reference.partName
    const partNumber = normalizeLDrawPartNumber(rawPartName)
    const definition = definitionByPartNumber.get(partNumber)
    if (!definition) continue
    const poseMatch = poseByMatrix.reduce((closest, candidate) => (
      matrixDistance(candidate.matrix, matrix) < matrixDistance(closest.matrix, matrix) ? candidate : closest
    ))
    if (matrixDistance(poseMatch.matrix, matrix) > 0.1) {
      expanded.ignoredParts += 1
      continue
    }
    const footprint = footprintToWorld(definition, poseMatch.horizontal, poseMatch.vertical)
    const color = ldrawCodeToColor.get(colorCode) ?? definition.colors[0]
    const safeColor = definition.colors.includes(color) ? color : definition.colors[0]
    bricks.push({
      id: `piece-ldraw-${bricks.length + 1}`,
      brickId: definition.id,
      color: safeColor,
      pose: {
        xStud: normalizeHorizontalStud(xLDraw / ldrawUnitsPerStud - footprint.widthStuds / 2),
        yStud: normalizeYStud(-yLDraw / ldrawUnitsPerStud - footprint.heightStuds),
        zStud: normalizeHorizontalStud(zLDraw / ldrawUnitsPerStud - footprint.depthStuds / 2),
        rotationQuarterTurns: poseMatch.horizontal,
        verticalQuarterTurns: poseMatch.vertical,
      },
    })
  }

  if (bricks.length === 0) return undefined
  const minimumY = Math.min(...bricks.map((brick) => brick.pose.yStud))
  if (minimumY !== 0) {
    for (const brick of bricks) brick.pose.yStud = normalizeYStud(brick.pose.yStud - minimumY)
  }
  const titleMatch = text.match(/^0\s+(?:Name:|FILE)\s+(.+)$/im)
  const title = titleMatch?.[1]?.trim().replace(/\.(?:ldr|mpd)$/i, '') || fallbackTitle
  return {
    plan: {
      id: `plan-ldraw-${Date.now().toString(36)}`,
      title,
      prompt: `${title} imported from LDraw`,
      source: 'template-local',
      bricks,
      steps: createSingleBrickSteps(bricks),
    },
    usedEmbeddedPlan: false,
    ignoredParts: expanded.ignoredParts,
    unknownPartNumbers: expanded.unknownPartNumbers,
  }
}
