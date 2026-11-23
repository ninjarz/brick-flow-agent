import * as esbuild from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const usage = `Usage: npm run profile:calibration -- [--measurements recorded-trials.json]

The report includes part numbers, stud coordinates, test settings and simulation
predictions. Assemble the listed parts and weigh the assembled fixture in grams.
For gravity trials, observe the released fixture on a level, rigid surface.
For the earthquake trial, use a shake table in the indicated direction and record
peak acceleration in g. Match the reported peak acceleration before comparing.
Run each trial repeatedly and record every observation independently.

Measurement JSON is an array of records using these fields:
  fixture: fixture id from the report
  trial: a unique trial label for that fixture
  measuredGrams: total mass in grams
  slid: whether the whole base translated relative to the surface
  failed: whether a connection separated or the model overturned
  firstEvent: optional; "sliding", "overturn", "connection-separation" or "none"
  peakAccelerationG: measured peak acceleration for the earthquake trial

Without measurements the report contains simulation results only.`

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(usage)
  process.exit(0)
}
if (args.length && (args.length !== 2 || args[0] !== '--measurements')) throw new Error(usage)
const measurements = args.length ? JSON.parse(await readFile(args[1], 'utf8')) : []
if (!Array.isArray(measurements)) throw new Error('Measurements must be an array of recorded trials.')

const temp = await mkdtemp(join(tmpdir(), 'brick-flow-physical-calibration-'))
const outfile = join(temp, 'fixtures.mjs')
try {
  await esbuild.build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `
        import { brickById } from './src/data/basicBricks'
        import { prepareAnalysisGeometry } from './src/lib/prepareAnalysisGeometry'
        import { runDisasterSimulation, type DisasterSimulationOptions } from './src/lib/disasterSimulation'
        import { createSingleBrickSteps, getBlockingBuildPlanIssues, makeBrick, validateBuildPlan } from './src/lib/planUtils'
        import type { PlacedBrick } from './src/types/bricks'

        const part = (id: string, brickId: string, x: number, y: number) => ({
          ...makeBrick(brickId, 'gray', x, y, 0), id,
          pose: { xStud: x, yStud: y, zStud: 0, rotationQuarterTurns: 0 as const },
        })
        const gravity = { scenario: 'wind', intensity: 0, directionDegrees: 0, physicsProfile: 'realistic' } as const
        const cantilever = [part('pier', 'brick-1x2', 0, 0), part('deck', 'brick-1x4', 0, 1.2)]
        const tower = [
          part('footing', 'brick-2x4', 0, 0), part('body', 'brick-2x2', 1, 1.2),
          part('upper', 'brick-2x2', 1, 2.4), part('cap', 'brick-2x2', 1, 3.6),
        ]
        const shake = { scenario: 'earthquake', directionDegrees: 0, physicsProfile: 'realistic', groundCondition: 'surface' } as const
        const cases: Array<{ id: string; group: 'calibration' | 'holdout'; bricks: PlacedBrick[]; options: DisasterSimulationOptions }> = [
          { id: 'cantilever-unloaded', group: 'calibration', bricks: cantilever, options: gravity },
          { id: 'cantilever-end-load', group: 'calibration', bricks: [
            ...cantilever, ...[2.4, 3.6, 4.8].map((y, index) => part('weight-' + (index + 1), 'brick-1x1', 3, y)),
          ], options: gravity },
          { id: 'tower-low-acceleration', group: 'calibration', bricks: tower, options: { ...shake, intensity: 18 } },
          { id: 'tower-high-acceleration', group: 'calibration', bricks: tower, options: { ...shake, intensity: 28 } },
          { id: 'bridge-off-center-load', group: 'holdout', bricks: [
            ...cantilever, part('second-pier', 'brick-1x1', 3, 0),
            part('weight-1', 'brick-1x1', 2, 2.4), part('weight-2', 'brick-1x1', 2, 3.6),
          ], options: gravity },
        ]
        const definitions = [...new Set(cases.flatMap(test => test.bricks.map(brick => brick.brickId)))]
          .map(id => brickById.get(id)!)
        await prepareAnalysisGeometry(definitions, [])

        export const fixtures = cases.map(({ id, group, bricks, options }) => {
          const plan = { id, title: id, prompt: '', source: 'template-local' as const, bricks, steps: createSingleBrickSteps(bricks) }
          const issues = getBlockingBuildPlanIssues(validateBuildPlan(plan))
          if (issues.length) throw new Error('Invalid test fixture ' + id + ': ' + JSON.stringify(issues))
          const result = runDisasterSimulation(bricks, options, 96)
          const firstFailures = [...result.failureTimeByBrickId.entries()].sort((left, right) => left[1] - right[1])
          const firstTime = firstFailures[0]?.[1]
          return {
            id, group,
            parts: bricks.map(brick => ({ id: brick.id, partNumber: brickById.get(brick.brickId)?.partNumber, pose: brick.pose })),
            options: result.options,
            peakInput: result.loadCalibration,
            prediction: {
              totalGrams: Number((result.modelMassKilograms * 1000).toFixed(4)),
              slidingRisk: result.slidingRiskBrickCount > 0,
              failed: result.failedBrickCount > 0,
              firstFailures: firstFailures.filter(([, time]) => time === firstTime)
                .map(([brickId, time]) => ({ brickId, time, mode: result.failureModeByBrickId.get(brickId) })),
            },
          }
        })
      `,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const { fixtures } = await import(pathToFileURL(outfile).href)
  const trials = new Set()
  const observations = measurements.map(record => {
    const fixture = fixtures.find(item => item.id === record?.fixture)
    if (!fixture || typeof record.trial !== 'string' || !record.trial.trim() ||
      !Number.isFinite(record.measuredGrams) || record.measuredGrams <= 0 ||
      typeof record.slid !== 'boolean' || typeof record.failed !== 'boolean' ||
      (record.firstEvent !== undefined && !['sliding', 'overturn', 'connection-separation', 'none'].includes(record.firstEvent)) ||
      (fixture.peakInput.unit === 'g' && (!Number.isFinite(record.peakAccelerationG) || record.peakAccelerationG <= 0))) {
      throw new Error('Invalid physical measurement: ' + JSON.stringify(record))
    }
    const trialId = JSON.stringify([fixture.id, record.trial])
    if (trials.has(trialId)) throw new Error('Duplicate physical trial: ' + trialId)
    trials.add(trialId)
    return {
      ...record,
      group: fixture.group,
      massErrorGrams: Number((fixture.prediction.totalGrams - record.measuredGrams).toFixed(4)),
      ...(fixture.peakInput.unit === 'g' && {
        accelerationErrorG: Number((fixture.peakInput.baseValue * fixture.peakInput.loadMultiplier - record.peakAccelerationG).toFixed(4)),
      }),
      slidingAgrees: fixture.prediction.slidingRisk === record.slid,
      failureAgrees: fixture.prediction.failed === record.failed,
    }
  })
  console.log(JSON.stringify({ physicalTrialCount: observations.length, fixtures, observations }, null, 2))
} finally {
  await rm(temp, { recursive: true, force: true })
}
