import * as esbuild from 'esbuild'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputPath = resolve(root, 'src/data/generatedObjAssets.ts')

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
    edgeStyle: 'curved',
  },
  {
    id: 'armadillo',
    title: 'Armadillo',
    path: resolve(root, '.ignored/objs/armadillo.obj'),
    orientationByProfile: { s: 'lay-side' },
    defaultProfileIds: ['s'],
  },
]

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

const loadObjImportCore = async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'brick-flow-agent-obj-core-'))
  const outfile = join(tempDirectory, 'obj-import.mjs')
  await esbuild.build({
    entryPoints: [resolve(root, 'src/lib/objImport.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
  })
  return import(outfile)
}

const formatMetrics = (source, profile, orientation, result) => {
  const { stats } = result
  return {
    source: basename(source.path),
    profile: profile.label,
    orientation,
    dimensions: `${stats.dimensions.width}×${stats.dimensions.height}×${stats.dimensions.depth}`,
    resolution: stats.resolution,
    voxels: stats.sourceVoxels,
    finalVoxels: stats.finalVoxels,
    removedComponents: stats.removedComponentVoxels,
    supports: stats.addedSupportVoxels,
    connectivityVoxels: stats.addedConnectivityVoxels,
    prunedUnsupportedVoxels: stats.prunedUnsupportedVoxels,
    componentCount: stats.componentCount,
    structuralChangeRatio: stats.structuralChangeRatio,
    bricks: stats.brickCount,
    slopes: stats.slopeCount,
    curvedSlopes: stats.curvedSlopeCount,
    voxelIoU: stats.voxelIoU,
    frontSilhouetteIoU: stats.frontSilhouetteIoU,
    sideSilhouetteIoU: stats.sideSilhouetteIoU,
    topSilhouetteIoU: stats.topSilhouetteIoU,
    oddRayRatio: stats.oddRayRatio,
  }
}

const createAsset = (source, profile, orientation, result) => {
  const { plan, stats } = result
  const dimensions = `${stats.dimensions.width}×${stats.dimensions.height}×${stats.dimensions.depth}`
  return {
    id: `finished-obj-${source.id}-${profile.id}`,
    title: `${source.title} ${profile.label}`,
    category: 'OBJ',
    description: [
      `从 ${source.title} OBJ 通过四点超采样实体体素化和轮廓优先分砖生成的灰色积木雕像${source.edgeStyle === 'curved' ? '，边缘使用弧形坡砖柔化' : ''}。`,
      `档位 ${profile.label}，${orientation === 'lay-side' ? '侧卧' : orientation === 'lay-back' ? '后躺' : '直立'}构建，网格 ${dimensions}，保形体素 ${stats.sourceVoxels} 个，结构调整 ${(stats.structuralChangeRatio * 100).toFixed(1)}%，生成 ${stats.brickCount} 个零件。`,
    ].join(' '),
    plan: {
      ...plan,
      id: `plan-obj-${source.id}-${profile.id}`,
      title: `${source.title} ${profile.label}`,
      prompt: `${source.title} OBJ shape-preserving brick statue ${profile.label}`,
    },
  }
}

const compactAsset = (asset) => ({
  id: asset.id,
  title: asset.title,
  category: asset.category,
  description: asset.description,
  planId: asset.plan.id,
  planTitle: asset.plan.title,
  prompt: asset.plan.prompt,
  pieceIdPrefix: asset.plan.bricks[0]?.id.replace(/-\d+$/, '') ?? `${asset.plan.id}-piece`,
  stepIdPrefix: asset.plan.steps[0]?.id.replace(/-\d+$/, '') ?? `${asset.plan.id}-step`,
  bricks: asset.plan.bricks.map((brick) => [
    brick.brickId,
    brick.color,
    brick.pose.xStud,
    brick.pose.yStud,
    brick.pose.zStud,
    brick.pose.rotationQuarterTurns,
    brick.pose.verticalQuarterTurns ?? 0,
  ]),
})

const createGeneratedSource = (assets) => `import { brickById } from './basicBricks'
import type { BrickColor, FinishedAsset, PlacedBrick } from '../types/bricks'

type CompactBrick = [string, BrickColor, number, number, number, number, number]
type CompactAsset = {
  id: string
  title: string
  category: string
  description: string
  planId: string
  planTitle: string
  prompt: string
  pieceIdPrefix: string
  stepIdPrefix: string
  bricks: CompactBrick[]
}

const compactAssets: CompactAsset[] = ${JSON.stringify(assets.map(compactAsset))}

const expandAsset = (asset: CompactAsset): FinishedAsset => {
  const bricks: PlacedBrick[] = asset.bricks.map(([brickId, color, xStud, yStud, zStud, rotationQuarterTurns, verticalQuarterTurns], index) => ({
    id: \`\${asset.pieceIdPrefix}-\${index + 1}\`,
    brickId,
    color,
    pose: {
      xStud,
      yStud,
      zStud,
      rotationQuarterTurns: rotationQuarterTurns as PlacedBrick['pose']['rotationQuarterTurns'],
      verticalQuarterTurns: verticalQuarterTurns as PlacedBrick['pose']['verticalQuarterTurns'],
    },
  }))

  return {
    id: asset.id,
    title: asset.title,
    category: asset.category,
    description: asset.description,
    plan: {
      id: asset.planId,
      title: asset.planTitle,
      prompt: asset.prompt,
      source: 'template-local',
      bricks,
      steps: bricks.map((brick, index) => {
        const name = brickById.get(brick.brickId)?.name ?? brick.brickId
        return {
          id: \`\${asset.stepIdPrefix}-\${index + 1}\`,
          title: \`放置 \${name}\`,
          description: \`放置第 \${index + 1} 个零件：\${name}。\`,
          brickIds: [brick.id],
        }
      }),
    },
  }
}

export const generatedObjAssets: FinishedAsset[] = compactAssets.map(expandAsset)
`

const main = async () => {
  const options = parseArgs()
  const { importObjToBrickPlan } = await loadObjImportCore()
  const assets = []

  for (const source of options.sources) {
    const text = await readFile(source.path, 'utf8')
    for (const profile of options.profiles) {
      if (!options.profileExplicit && source.defaultProfileIds && !source.defaultProfileIds.includes(profile.id)) continue
      const orientation = source.orientationByProfile?.[profile.id] ?? 'upright'
      const result = importObjToBrickPlan(text, {
        title: `${source.title} ${profile.label}`,
        profileId: profile.id,
        orientation,
        color: 'gray',
        locale: 'zh',
        idPrefix: `${source.id}-${profile.id}`,
        edgeStyle: source.edgeStyle ?? 'angular',
      })
      assets.push(createAsset(source, profile, orientation, result))
      console.log(JSON.stringify(formatMetrics(source, profile, orientation, result)))
    }
  }

  if (!options.write) return
  await writeFile(outputPath, createGeneratedSource(assets))
  console.log(`Wrote ${assets.length} assets to ${outputPath}`)
}

await main()
