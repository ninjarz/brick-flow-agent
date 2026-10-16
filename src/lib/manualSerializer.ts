import { brickById, colorHex } from '../data/basicBricks'
import type { BrickColor, BrickPose, BuildPlan, PlacedBrick } from '../types/bricks'
import { footprintToWorld } from './brickUnits'
import {
  createSingleBrickSteps,
  getBlockingBuildPlanIssues,
  summarizeBuildPlanIssues,
  validateBuildPlan,
} from './planUtils'

type ManualLocale = 'zh-CN' | 'en-US'

const manualText: Record<ManualLocale, {
  lang: string
  titleSuffix: string
  source: string
  prompt: string
  none: string
  structureCheck: string
  totalPieces: string
  totalPages: string
  inventory: string
  addedParts: string
  horizontal: string
  vertical: string
  newPieceCaption: string
  placementDirection: Record<ManualPlacementDirection, string>
  sourceTemplateLocal: string
  sourceLlm: string
  pageTitle: (page: number, title: string) => string
  stepCount: (added: number, total: number) => string
  placeTitle: (name: string) => string
  placeDescription: (index: number, name: string) => string
  placeGroupTitle: (count: number, layer: number) => string
  placeGroupDescription: (count: number, layer: number) => string
  diagramAria: (page: number) => string
}> = {
  'zh-CN': {
    lang: 'zh-CN',
    titleSuffix: '搭建手册',
    source: '来源',
    prompt: '提示词',
    none: '无',
    structureCheck: '结构校验',
    totalPieces: '总零件',
    totalPages: '总页数',
    inventory: '总零件清单',
    addedParts: '新增零件',
    horizontal: '水平',
    vertical: '垂直',
    newPieceCaption: '橙色描边为本步新增零件；箭头表示安装方向',
    placementDirection: {
      down: '从上向下安装',
      up: '从下向上安装',
      left: '从右向左安装',
      right: '从左向右安装',
      front: '从后向前安装',
      back: '从前向后安装',
    },
    sourceTemplateLocal: '本地模板',
    sourceLlm: 'LLM 生成',
    pageTitle: (page, title) => `第 ${page} 页 · ${title}`,
    stepCount: (added, total) => `本步新增 ${added} 个，完成后累计 ${total} 个。`,
    placeTitle: (name) => `放置 ${name}`,
    placeDescription: (index, name) => `放置第 ${index + 1} 个零件：${name}。`,
    placeGroupTitle: (count, layer) => `第 ${layer + 1} 层 · ${count} 个零件`,
    placeGroupDescription: (count, layer) => `在第 ${layer + 1} 层连续放置 ${count} 个相互关联的零件。`,
    diagramAria: (page) => `第 ${page} 页等距示意图`,
  },
  'en-US': {
    lang: 'en-US',
    titleSuffix: 'Build Manual',
    source: 'Source',
    prompt: 'Prompt',
    none: 'none',
    structureCheck: 'Structure check',
    totalPieces: 'Total parts',
    totalPages: 'Total pages',
    inventory: 'Inventory',
    addedParts: 'Added parts',
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    newPieceCaption: 'Orange outlines mark new parts; arrows show installation direction',
    placementDirection: {
      down: 'Install downward from above',
      up: 'Install upward from below',
      left: 'Install from right to left',
      right: 'Install from left to right',
      front: 'Install from back to front',
      back: 'Install from front to back',
    },
    sourceTemplateLocal: 'Local template',
    sourceLlm: 'LLM generated',
    pageTitle: (page, title) => `Page ${page} · ${title}`,
    stepCount: (added, total) => `${added} added, ${total} total after this step.`,
    placeTitle: (name) => `Place ${name}`,
    placeDescription: (index, name) => `Place part ${index + 1}: ${name}.`,
    placeGroupTitle: (count, layer) => `Layer ${layer + 1} · ${count} parts`,
    placeGroupDescription: (count, layer) => `Place ${count} connected parts on layer ${layer + 1}.`,
    diagramAria: (page) => `Isometric diagram for page ${page}`,
  },
}

const formatManualSource = (source: BuildPlan['source'], locale: ManualLocale) =>
  source === 'llm' ? manualText[locale].sourceLlm : manualText[locale].sourceTemplateLocal

export type ManualPartCount = {
  key: string
  brickId: string
  name: string
  color: BrickColor
  quantity: number
}

export type ManualPiece = {
  instanceId: string
  brickId: string
  name: string
  color: BrickColor
  pose: BrickPose
  voxelState?: BuildPlan['bricks'][number]['voxelState']
  footprint: {
    widthStuds: number
    depthStuds: number
    heightStuds: number
  }
  rotationDegrees: number
  verticalRotationDegrees: number
  assembly: ManualAssemblyGuide
}

export type ManualPlacementDirection = 'down' | 'up' | 'left' | 'right' | 'front' | 'back'

export type ManualAssemblyGuide = {
  direction: ManualPlacementDirection
  label: string
  explodedOffset: { xStud: number; yStud: number; zStud: number }
}

export type ManualStepPage = {
  stepNumber: number
  title: string
  description: string
  addPieces: ManualPiece[]
  stepInventory: ManualPartCount[]
  completedPieceCount: number
  cameraAzimuthDegrees: number
  validation: {
    ok: boolean
    issueCount: number
    blockingIssueCount: number
    warningIssueCount: number
    summary: string
  }
}

export type BuildManual = {
  schemaVersion: 6
  planId: string
  title: string
  prompt: string
  source: BuildPlan['source']
  validation: {
    ok: boolean
    issueCount: number
    blockingIssueCount: number
    warningIssueCount: number
    summary: string
  }
  totalPieces: number
  totalSteps: number
  inventory: ManualPartCount[]
  steps: ManualStepPage[]
}

const countPieces = (pieces: ManualPiece[]): ManualPartCount[] => {
  const counts = new Map<string, ManualPartCount>()

  for (const piece of pieces) {
    const key = `${piece.brickId}:${piece.color}`
    const current = counts.get(key)
    if (current) {
      current.quantity += 1
    } else {
      counts.set(key, {
        key,
        brickId: piece.brickId,
        name: piece.name,
        color: piece.color,
        quantity: 1,
      })
    }
  }

  return [...counts.values()].sort((source, target) =>
    source.name.localeCompare(target.name) || source.color.localeCompare(target.color),
  )
}

const getAssemblyGuide = (
  brick: BuildPlan['bricks'][number],
  locale: ManualLocale,
): ManualAssemblyGuide => {
  const vertical = brick.pose.verticalQuarterTurns ?? 0
  let direction: ManualPlacementDirection = 'down'

  if (vertical === 2) {
    direction = 'up'
  } else if (vertical === 1 || vertical === 3) {
    const horizontalDirections: ManualPlacementDirection[] = vertical === 1
      ? ['back', 'right', 'front', 'left']
      : ['front', 'left', 'back', 'right']
    direction = horizontalDirections[brick.pose.rotationQuarterTurns]
  }

  const offsetByDirection: Record<ManualPlacementDirection, ManualAssemblyGuide['explodedOffset']> = {
    down: { xStud: 0, yStud: 1.6, zStud: 0 },
    up: { xStud: 0, yStud: -1.6, zStud: 0 },
    left: { xStud: 1.6, yStud: 0, zStud: 0 },
    right: { xStud: -1.6, yStud: 0, zStud: 0 },
    front: { xStud: 0, yStud: 0, zStud: 1.6 },
    back: { xStud: 0, yStud: 0, zStud: -1.6 },
  }

  return {
    direction,
    label: manualText[locale].placementDirection[direction],
    explodedOffset: offsetByDirection[direction],
  }
}

const toManualPiece = (brick: BuildPlan['bricks'][number], locale: ManualLocale): ManualPiece => {
  const definition = brickById.get(brick.brickId)
  const footprint = definition
    ? footprintToWorld(definition, brick.pose.rotationQuarterTurns, brick.pose.verticalQuarterTurns ?? 0)
    : undefined

  return {
    instanceId: brick.id,
    brickId: brick.brickId,
    name: definition?.name ?? brick.brickId,
    color: brick.color,
    pose: { ...brick.pose },
    ...(brick.voxelState ? { voxelState: structuredClone(brick.voxelState) } : {}),
    footprint: {
      widthStuds: footprint?.widthStuds ?? 1,
      depthStuds: footprint?.depthStuds ?? 1,
      heightStuds: footprint?.height ?? 0.4,
    },
    rotationDegrees: brick.pose.rotationQuarterTurns * 90,
    verticalRotationDegrees: (brick.pose.verticalQuarterTurns ?? 0) * 90,
    assembly: getAssemblyGuide(brick, locale),
  }
}

const validateCumulativePlan = (plan: BuildPlan, bricks: PlacedBrick[], locale: ManualLocale) => {
  const issues = validateBuildPlan({
    ...plan,
    bricks,
    steps: createSingleBrickSteps(bricks),
  })
  const blockingIssues = getBlockingBuildPlanIssues(issues)

  return {
    ok: blockingIssues.length === 0,
    issueCount: issues.length,
    blockingIssueCount: blockingIssues.length,
    warningIssueCount: issues.length - blockingIssues.length,
    summary: issues.length > 0 ? summarizeBuildPlanIssues(issues, locale) : summarizeBuildPlanIssues([], locale),
  }
}

const sortBuildCandidates = (source: PlacedBrick, target: PlacedBrick) =>
  source.pose.yStud - target.pose.yStud ||
  source.pose.zStud - target.pose.zStud ||
  source.pose.xStud - target.pose.xStud ||
  source.id.localeCompare(target.id)

const emptyManualValidation = (locale: ManualLocale): ManualStepPage['validation'] => ({
  ok: true,
  issueCount: 0,
  blockingIssueCount: 0,
  warningIssueCount: 0,
  summary: summarizeBuildPlanIssues([], locale),
})

const shouldTrustManualPlanOrder = (plan: BuildPlan) =>
  plan.source === 'template-local'

const maxPiecesPerManualStep = 6

const sequenceBricksForManual = (plan: BuildPlan, locale: ManualLocale) => {
  if (shouldTrustManualPlanOrder(plan)) {
    const validation = emptyManualValidation(locale)
    return plan.bricks.map((brick) => ({ brick, validation }))
  }

  const orderedByPlan: Array<{
    brick: PlacedBrick
    validation: ManualStepPage['validation']
  }> = []
  const planOrderCumulative: PlacedBrick[] = []

  for (const brick of plan.bricks) {
    planOrderCumulative.push(brick)
    const validation = validateCumulativePlan(plan, planOrderCumulative, locale)
    if (!validation.ok) {
      orderedByPlan.length = 0
      break
    }

    orderedByPlan.push({ brick, validation })
  }

  if (orderedByPlan.length === plan.bricks.length) return orderedByPlan

  const remaining = [...plan.bricks].sort(sortBuildCandidates)
  const ordered: Array<{
    brick: PlacedBrick
    validation: ManualStepPage['validation']
  }> = []
  const cumulative: PlacedBrick[] = []

  while (remaining.length > 0) {
    let selectedIndex = -1
    let selectedValidation: ManualStepPage['validation'] | undefined

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]
      const validation = validateCumulativePlan(plan, [...cumulative, candidate], locale)
      if (!validation.ok) continue

      selectedIndex = index
      selectedValidation = validation
      break
    }

    if (selectedIndex === -1) {
      selectedIndex = 0
      selectedValidation = validateCumulativePlan(plan, [...cumulative, remaining[0]], locale)
    }

    const [brick] = remaining.splice(selectedIndex, 1)
    cumulative.push(brick)
    ordered.push({
      brick,
      validation: selectedValidation ?? validateCumulativePlan(plan, cumulative, locale),
    })
  }

  return ordered
}

const groupManualSequence = (sequence: ReturnType<typeof sequenceBricksForManual>, instructionSteps: Map<string, BuildPlan['steps'][number]>) => {
  const groups: Array<typeof sequence> = []
  for (const item of sequence) {
    const current = groups.at(-1)
    const currentLayer = current?.[0]?.brick.pose.yStud
    const authored = instructionSteps.get(item.brick.id)
    const previousAuthored = current && instructionSteps.get(current[0].brick.id)
    if (current && (authored ? authored === previousAuthored : !previousAuthored && current.length < maxPiecesPerManualStep && Math.abs((currentLayer ?? 0) - item.brick.pose.yStud) < 0.000001)) {
      current.push(item)
    } else {
      groups.push([item])
    }
  }
  return groups
}

export const serializeBuildManual = (plan: BuildPlan, locale: ManualLocale = 'zh-CN'): BuildManual => {
  const labels = manualText[locale]
  let completedPieceCount = 0
  const planCenterX = plan.bricks.reduce((total, brick) => total + brick.pose.xStud, 0) / Math.max(1, plan.bricks.length)
  const planCenterZ = plan.bricks.reduce((total, brick) => total + brick.pose.zStud, 0) / Math.max(1, plan.bricks.length)

  const instructionSteps = new Map(plan.steps.filter((step) => Number.isInteger(step.instructionStep) && step.instructionStep! > 0).flatMap((step) => step.brickIds.map((id) => [id, step] as const)))
  const steps: ManualStepPage[] = groupManualSequence(sequenceBricksForManual(plan, locale), instructionSteps).map((group, index) => {
    const authored = instructionSteps.get(group[0].brick.id)
    const addPieces = group.map(({ brick }) => toManualPiece(brick, locale))
    const layer = Math.max(0, Math.round(Math.min(...group.map(({ brick }) => brick.pose.yStud)) / 0.4))
    const singlePiece = addPieces.length === 1 ? addPieces[0] : undefined
    completedPieceCount += addPieces.length
    const groupCenterX = group.reduce((total, item) => total + item.brick.pose.xStud, 0) / group.length
    const groupCenterZ = group.reduce((total, item) => total + item.brick.pose.zStud, 0) / group.length
    const cameraAzimuthDegrees = Math.round((Math.atan2(
      groupCenterX - planCenterX,
      groupCenterZ - planCenterZ,
    ) * 180) / Math.PI + 180)

    return {
      stepNumber: index + 1,
      title: authored?.title ?? (singlePiece ? labels.placeTitle(singlePiece.name) : labels.placeGroupTitle(addPieces.length, layer)),
      description: authored?.description ?? (singlePiece ? labels.placeDescription(completedPieceCount - 1, singlePiece.name) : labels.placeGroupDescription(addPieces.length, layer)),
      addPieces,
      stepInventory: countPieces(addPieces),
      completedPieceCount,
      cameraAzimuthDegrees,
      validation: group.at(-1)?.validation ?? emptyManualValidation(locale),
    }
  })

  const allPieces = plan.bricks.map((brick) => toManualPiece(brick, locale))
  const issues = validateBuildPlan(plan)
  const blockingIssues = getBlockingBuildPlanIssues(issues)

  return {
    schemaVersion: 6,
    planId: plan.id,
    title: plan.title,
    prompt: plan.prompt,
    source: plan.source,
    validation: {
      ok: blockingIssues.length === 0,
      issueCount: issues.length,
      blockingIssueCount: blockingIssues.length,
      warningIssueCount: issues.length - blockingIssues.length,
      summary: issues.length > 0 ? summarizeBuildPlanIssues(issues, locale) : summarizeBuildPlanIssues([], locale),
    },
    totalPieces: plan.bricks.length,
    totalSteps: steps.length,
    inventory: countPieces(allPieces),
    steps,
  }
}

export const formatBuildManualMarkdown = (manual: BuildManual, locale: ManualLocale = 'zh-CN') => {
  const labels = manualText[locale]
  const lines = [
    `# ${manual.title} ${labels.titleSuffix}`,
    '',
    `- ${labels.source}: ${formatManualSource(manual.source, locale)}`,
    `- ${labels.prompt}: ${manual.prompt || labels.none}`,
    `- ${labels.structureCheck}: ${manual.validation.summary}`,
    `- ${labels.totalPieces}: ${manual.totalPieces}`,
    `- ${labels.totalPages}: ${manual.totalSteps}`,
    '',
    `## ${labels.inventory}`,
    ...manual.inventory.map((item) => `- ${item.name} (${item.brickId}) · ${item.color} × ${item.quantity}`),
    '',
  ]

  for (const step of manual.steps) {
    lines.push(`## ${labels.pageTitle(step.stepNumber, step.title)}`)
    lines.push(step.description)
    lines.push('')
    lines.push(`${labels.structureCheck}: ${step.validation.summary}`)
    lines.push('')
    lines.push(labels.stepCount(step.addPieces.length, step.completedPieceCount))
    lines.push('')
    lines.push(`### ${labels.addedParts}`)
    for (const piece of step.addPieces) {
      lines.push(
        `- ${piece.name} (${piece.brickId}) · ${piece.color} · x${piece.pose.xStud} y${piece.pose.yStud} z${piece.pose.zStud} · ${labels.horizontal} ${piece.rotationDegrees}° · ${labels.vertical} ${piece.verticalRotationDegrees}° · ${piece.assembly.label}`,
      )
    }
    lines.push('')
  }

  return lines.join('\n')
}

const escapeHtml = (value: string | number) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const manualColorHex: Record<BrickColor, string> = {
  ...colorHex,
  red: '#ef4444',
  blue: '#2563eb',
  yellow: '#facc15',
  green: '#16a34a',
  white: '#f8fafc',
  black: '#111827',
  gray: '#94a3b8',
  brown: '#92400e',
  orange: '#f97316',
  tan: '#c4a46d',
  cyan: '#06b6d4',
  lime: '#84cc16',
  pink: '#ec4899',
  'trans-pink': '#f5a3c7',
}

const getPlanFootprint = (piece: ManualPiece) => {
  return {
    widthStuds: piece.footprint.widthStuds,
    depthStuds: piece.footprint.depthStuds,
  }
}

type DiagramPoint = {
  x: number
  y: number
}

type DiagramCuboid = {
  piece: ManualPiece
  isNew: boolean
  top: DiagramPoint[]
  right: DiagramPoint[]
  front: DiagramPoint[]
  arrowStart?: DiagramPoint
  arrowEnd?: DiagramPoint
}

const pointList = (points: DiagramPoint[]) => points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')

const renderStepDiagram = (step: ManualStepPage, cumulativePieces: ManualPiece[], locale: ManualLocale) => {
  const labels = manualText[locale]
  if (cumulativePieces.length === 0) return ''

  const studX = 34
  const studZ = 17
  const heightScale = 7
  const padding = 32
  const newPieceIds = new Set(step.addPieces.map((piece) => piece.instanceId))

  const project = (xStud: number, zStud: number, yStud: number): DiagramPoint => ({
    x: (xStud - zStud) * studX,
    y: (xStud + zStud) * studZ - yStud * heightScale,
  })

  const cuboids: DiagramCuboid[] = [...cumulativePieces]
    .sort((source, target) =>
      (source.pose.xStud + source.pose.zStud + source.pose.yStud) -
      (target.pose.xStud + target.pose.zStud + target.pose.yStud),
    )
    .map((piece) => {
      const footprint = getPlanFootprint(piece)
      const finalX = piece.pose.xStud
      const finalY = piece.pose.yStud
      const finalZ = piece.pose.zStud
      const width = footprint.widthStuds
      const depth = footprint.depthStuds
      const height = piece.footprint.heightStuds
      const isNew = newPieceIds.has(piece.instanceId)
      const offset = isNew ? piece.assembly.explodedOffset : { xStud: 0, yStud: 0, zStud: 0 }
      const x = finalX + offset.xStud
      const y = finalY + offset.yStud
      const z = finalZ + offset.zStud

      return {
        piece,
        isNew,
        top: [
          project(x, z, y + height),
          project(x + width, z, y + height),
          project(x + width, z + depth, y + height),
          project(x, z + depth, y + height),
        ],
        right: [
          project(x + width, z, y + height),
          project(x + width, z, y),
          project(x + width, z + depth, y),
          project(x + width, z + depth, y + height),
        ],
        front: [
          project(x, z + depth, y + height),
          project(x + width, z + depth, y + height),
          project(x + width, z + depth, y),
          project(x, z + depth, y),
        ],
        arrowStart: isNew ? project(x + width / 2, z + depth / 2, y + height / 2) : undefined,
        arrowEnd: isNew ? project(finalX + width / 2, finalZ + depth / 2, finalY + height / 2) : undefined,
      }
    })
  const projectedPoints = cuboids.flatMap((cuboid) => [
    ...cuboid.top,
    ...cuboid.right,
    ...cuboid.front,
    ...(cuboid.arrowStart ? [cuboid.arrowStart] : []),
    ...(cuboid.arrowEnd ? [cuboid.arrowEnd] : []),
  ])
  const minX = Math.min(...projectedPoints.map((point) => point.x))
  const minY = Math.min(...projectedPoints.map((point) => point.y))
  const maxX = Math.max(...projectedPoints.map((point) => point.x))
  const maxY = Math.max(...projectedPoints.map((point) => point.y))
  const translateX = padding - minX
  const translateY = padding - minY
  const width = maxX - minX + padding * 2
  const height = maxY - minY + padding * 2
  const pieces = cuboids
    .map((cuboid) => {
      const stroke = cuboid.isNew ? '#f97316' : '#334155'
      const strokeWidth = cuboid.isNew ? 4 : 1.2
      const color = manualColorHex[cuboid.piece.color]
      const arrow = cuboid.arrowStart && cuboid.arrowEnd
        ? `<line x1="${cuboid.arrowStart.x.toFixed(1)}" y1="${cuboid.arrowStart.y.toFixed(1)}" x2="${cuboid.arrowEnd.x.toFixed(1)}" y2="${cuboid.arrowEnd.y.toFixed(1)}" stroke="#ea580c" stroke-width="4" marker-end="url(#assembly-arrow)" />`
        : ''

      return `<g transform="translate(${translateX.toFixed(1)} ${translateY.toFixed(1)})">
          <title>${escapeHtml(cuboid.piece.name)} · ${escapeHtml(cuboid.piece.color)} · x${cuboid.piece.pose.xStud} y${cuboid.piece.pose.yStud} z${cuboid.piece.pose.zStud}</title>
          ${arrow}
          <polygon points="${pointList(cuboid.right)}" fill="${color}" fill-opacity="0.72" stroke="${stroke}" stroke-width="${strokeWidth}" />
          <polygon points="${pointList(cuboid.front)}" fill="${color}" fill-opacity="0.86" stroke="${stroke}" stroke-width="${strokeWidth}" />
          <polygon points="${pointList(cuboid.top)}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" />
        </g>`
    })
    .join('\n        ')

  return `<figure class="diagram">
      <svg viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}" role="img" aria-label="${escapeHtml(labels.diagramAria(step.stepNumber))}">
        <defs><marker id="assembly-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ea580c" /></marker></defs>
        <rect width="${width}" height="${height}" rx="10" fill="#f8fafc" />
        ${pieces}
      </svg>
      <figcaption>${escapeHtml(labels.newPieceCaption)}</figcaption>
    </figure>`
}

export const formatBuildManualHtml = (manual: BuildManual, locale: ManualLocale = 'zh-CN') => {
  const labels = manualText[locale]
  const cumulativePieces: ManualPiece[] = []
  const manualStepsHtml = manual.steps.map((step) => {
    cumulativePieces.push(...step.addPieces)
    return `<section class="step">
      <h2>${escapeHtml(labels.pageTitle(step.stepNumber, step.title))}</h2>
      <p>${escapeHtml(step.description)}</p>
      <p class="step-status${step.validation.ok ? (step.validation.issueCount > 0 ? ' notice' : '') : ' warn'}">${escapeHtml(step.validation.summary)}</p>
      <p class="count">${escapeHtml(labels.stepCount(step.addPieces.length, step.completedPieceCount))}</p>
      ${renderStepDiagram(step, cumulativePieces, locale)}
      <ul>
        ${step.addPieces.map((piece) => `<li><strong>${escapeHtml(piece.name)}</strong><br /><small>${escapeHtml(piece.brickId)} · ${escapeHtml(piece.color)} · x${piece.pose.xStud} y${piece.pose.yStud} z${piece.pose.zStud} · ${escapeHtml(labels.horizontal)} ${piece.rotationDegrees}° · ${escapeHtml(labels.vertical)} ${piece.verticalRotationDegrees}° · ${escapeHtml(piece.assembly.label)}</small></li>`).join('\n        ')}
      </ul>
    </section>`
  }).join('\n    ')

  return `<!doctype html>
<html lang="${labels.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(manual.title)} ${escapeHtml(labels.titleSuffix)}</title>
  <style>
    body { margin: 0; color: #172033; background: #f1f5f9; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 920px; margin: 0 auto; padding: 28px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 30px; line-height: 1.15; }
    .meta, .step p, li small { color: #64748b; }
    .panel, .step { margin-top: 16px; padding: 16px; border: 1px solid #d8e0ea; border-radius: 8px; background: #fff; }
    .status { display: inline-block; margin-top: 10px; padding: 7px 10px; border-radius: 8px; background: ${manual.validation.ok ? (manual.validation.issueCount > 0 ? '#fef3c7' : '#dcfce7') : '#fee2e2'}; color: ${manual.validation.ok ? (manual.validation.issueCount > 0 ? '#92400e' : '#166534') : '#991b1b'}; font-weight: 750; }
    .step-status { display: inline-block; margin-top: 8px; padding: 5px 8px; border-radius: 7px; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 750; }
    .step-status.notice { background: #fef3c7; color: #92400e; }
    .step-status.warn { background: #fee2e2; color: #991b1b; }
    ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; padding: 0; list-style: none; }
    li { padding: 10px; border: 1px solid #d8e0ea; border-radius: 7px; background: #f8fafc; }
    .step h2 { margin-bottom: 6px; font-size: 18px; }
    .count { margin-top: 10px; color: #475569; font-weight: 750; }
    .diagram { margin: 14px 0 0; }
    .diagram svg { display: block; width: 100%; max-height: 420px; border: 1px solid #d8e0ea; border-radius: 8px; background: #f8fafc; }
    .diagram figcaption { margin-top: 6px; color: #64748b; font-size: 12px; }
    .grid line { stroke: #d8e0ea; stroke-width: 1; }
    @media print { body { background: #fff; } main { padding: 0; } .step { break-inside: avoid; } }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(manual.title)} ${escapeHtml(labels.titleSuffix)}</h1>
    <p class="meta">${escapeHtml(labels.source)}: ${escapeHtml(formatManualSource(manual.source, locale))} · ${escapeHtml(labels.prompt)}: ${escapeHtml(manual.prompt || labels.none)} · ${escapeHtml(labels.totalPieces)}: ${manual.totalPieces} · ${escapeHtml(labels.totalPages)}: ${manual.totalSteps}</p>
    <p class="status">${escapeHtml(manual.validation.summary)}</p>
    <section class="panel">
      <h2>${escapeHtml(labels.inventory)}</h2>
      <ul>
        ${manual.inventory.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><br /><small>${escapeHtml(item.brickId)} · ${escapeHtml(item.color)} × ${item.quantity}</small></li>`).join('\n        ')}
      </ul>
    </section>
    ${manualStepsHtml}
  </main>
</body>
</html>`
}
