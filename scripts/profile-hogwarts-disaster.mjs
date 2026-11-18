import * as esbuild from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const temp = await mkdtemp(join(tmpdir(), 'brick-flow-hogwarts-disaster-'))
const outfile = join(temp, 'profile.mjs')

try {
  await esbuild.build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'ts',
      contents: `
        import { createHash } from 'node:crypto'
        import { cpus } from 'node:os'
        import plan from './src/data/legoHogwartsPlan.json'
        import { brickById } from './src/data/basicBricks'
        import { prepareAnalysisGeometry } from './src/lib/prepareAnalysisGeometry'
        import { runDisasterSimulation, type DisasterScenario } from './src/lib/disasterSimulation'
        import type { PlacedBrick } from './src/types/bricks'

        const bricks = plan.bricks as PlacedBrick[]
        const definitions = [...new Set(bricks.map(brick => brick.brickId))].flatMap(id => brickById.get(id) ?? [])
        const init = performance.now()
        await prepareAnalysisGeometry(definitions, [])
        console.log(JSON.stringify({
          cpu: cpus()[0]?.model, node: process.version, bricks: bricks.length,
          moulds: definitions.length, geometryMs: Math.round(performance.now() - init),
        }))

        for (const scenario of ['wind', 'rain', 'earthquake'] as DisasterScenario[]) {
          const cases = [
            { intensity: 0, physicsProfile: 'realistic', steps: 48 },
            { intensity: 70, physicsProfile: 'realistic', steps: 48 },
            { intensity: 70, physicsProfile: 'challenge', steps: 48 },
            { intensity: 70, physicsProfile: 'realistic', groundCondition: 'anchored', steps: 48 },
            ...(process.argv.includes('--refine') ? [
              { intensity: 70, physicsProfile: 'realistic', steps: 96 },
              { intensity: 70, physicsProfile: 'realistic', steps: 192 },
              { intensity: 70, physicsProfile: 'challenge', steps: 96 },
            ] : []),
          ] as const
          for (const test of cases) {
            const start = performance.now()
            const result = runDisasterSimulation(bricks, {
              scenario, intensity: test.intensity, directionDegrees: 25, physicsProfile: test.physicsProfile,
              groundCondition: 'groundCondition' in test ? test.groundCondition : 'surface',
            }, test.steps)
            const ids = [...result.failureTimeByBrickId.keys()].sort()
            console.log(JSON.stringify({
              scenario, ...test,
              ms: Math.round(performance.now() - start),
              initial: result.initialStaticFailureCount,
              failed: result.failedBrickCount,
              unresolved: result.unresolvedConnectionBrickIds.length,
              sliding: result.slidingRiskBrickCount,
              massKg: result.modelMassKilograms,
              brokenBonds: result.brokenConnectionCount,
              failureHash: createHash('sha256').update(ids.join('\\n')).digest('hex').slice(0, 12),
            }))
          }
        }
      `,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(temp, { recursive: true, force: true })
}
