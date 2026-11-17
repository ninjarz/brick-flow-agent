import * as esbuild from 'esbuild'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const root = process.cwd(), args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const planPath = resolve(option('--plan', 'src/data/legoHogwartsPlan.json'))
const cachePath = resolve(option('--cache', 'src/data/hogwartsConstructionValidation.json'))
const reportPath = resolve(option('--report', 'docs/precision-2026-11-16/construction-validation.json'))
const checkCache = args.includes('--check-cache')
const writeCache = args.includes('--write-cache')
const temporary = await mkdtemp(join(tmpdir(), 'brick-stage-verification-'))
try {
  const entry = join(temporary, 'api.ts'), output = join(temporary, 'api.mjs')
  await writeFile(entry, `
    export {getConstructionPhysicsRevision} from ${JSON.stringify(root + '/server/constructionPhysicsRevision.ts')};
    ${checkCache ? '' : `
    export {brickById} from ${JSON.stringify(root + '/src/data/basicBricks.ts')};
    export {prepareStructuralGeometry} from ${JSON.stringify(root + '/src/lib/prepareStructuralGeometry.ts')};
    export {createConstructionSceneBuilder,replayConstructionScene} from ${JSON.stringify(root + '/src/lib/constructionScene.ts')};
    export {createBuildGraph,validateBuildPlan,createSingleBrickSteps} from ${JSON.stringify(root + '/src/lib/planUtils.ts')};
    export {getRigidBrickMatrix} from ${JSON.stringify(root + '/src/lib/rigidBrickTransform.ts')};
    export {normalizeImportedPlan} from ${JSON.stringify(root + '/src/lib/planImport.ts')};
    export {isValidConstructionData} from ${JSON.stringify(root + '/src/lib/constructionPlan.ts')};
    `}
  `)
  await esbuild.build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' })
  const api = await import(output)
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  const physicsRevision = api.getConstructionPhysicsRevision(root)
  const sourcePlanSha256 = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  if (checkCache) {
    const cache = JSON.parse(await readFile(cachePath, 'utf8'))
    assert.equal(cache.physicsRevision, physicsRevision, 'Construction physics cache is stale; rerun the native stage audit')
    assert.equal(cache.sourcePlanSha256, sourcePlanSha256, 'Construction asset changed without a native stage audit')
    const expected = plan.steps.filter(step => step.construction).map(step => step.construction.sourceStepId ?? step.id).sort()
    assert.deepEqual(Object.keys(cache.steps).sort(), expected)
    console.log(JSON.stringify({ stages: expected.length, physicsRevision, sourcePlanSha256, cacheValid: true }))
  } else {
    assert.ok(api.isValidConstructionData(plan), 'Invalid construction references')
    const definitions = [...new Set(plan.bricks.map(brick => brick.brickId))].map(id => api.brickById.get(id))
    assert.ok(definitions.every(Boolean), 'Every construction mould must exist')
    await api.prepareStructuralGeometry(definitions)
    const buildScene = api.createConstructionSceneBuilder(plan), completed = new Set(), rows = [], steps = {}
    const started = performance.now()
    let failed = 0
    for (const [index, step] of plan.steps.entries()) {
      for (const id of step.brickIds) completed.add(id)
      const start = performance.now(), view = buildScene(step, completed)
      assert.ok(view, `No construction scene for ${step.id}`)
      const graph = api.createBuildGraph(view.bricks)
      const issues = api.validateBuildPlan({ ...plan, bricks: view.bricks, steps: api.createSingleBrickSteps(view.bricks) }, graph)
      const blocking = issues.filter(issue => issue.type !== 'disconnected-island')
      const playback = api.replayConstructionScene(plan.bricks, plan.constructionAssemblies, view.scene, completed)
      assert.deepEqual(playback.map(brick => brick.id), view.bricks.map(brick => brick.id), `Playback membership ${step.id}`)
      for (let piece = 0; piece < playback.length; piece++) {
        const definition = api.brickById.get(playback[piece].brickId)
        const a = api.getRigidBrickMatrix(definition, playback[piece].pose).elements
        const b = api.getRigidBrickMatrix(definition, view.bricks[piece].pose).elements
        assert.ok(a.every((value, element) => Math.abs(value - b[element]) < 1e-10), `Playback transform ${step.id} ${playback[piece].id}`)
      }
      const indices = new Map(view.bricks.map((brick, piece) => [brick.id, piece]))
      const key = step.construction.sourceStepId ?? step.id
      assert.ok(!Object.hasOwn(steps, key), `Repeated certificate key ${key}`)
      steps[key] = { islands: graph.components.slice(1).map(component => component.map(brick => indices.get(brick.id))) }
      failed += Number(blocking.length > 0)
      const row = { index: index + 1, id: step.id, source: step.construction.official,
        visible: view.bricks.length, added: step.brickIds.length, components: graph.components.length,
        blocking, elapsedMs: Math.round(performance.now() - start) }
      rows.push(row)
      if (index % 20 === 0 || blocking.length || index === plan.steps.length - 1) {
        await mkdir(dirname(reportPath), { recursive: true })
        await writeFile(reportPath, JSON.stringify({ pieces: plan.bricks.length, stages: rows.length, failed, physicsRevision, sourcePlanSha256, elapsedMs: performance.now() - started, rows }, null, 2) + '\n')
        console.log(JSON.stringify({ ...row, blocking: blocking.slice(0, 4) }))
      }
    }
    assert.equal(completed.size, plan.bricks.length)
    assert.equal(failed, 0, 'Native construction stages must pass before a cache can be published')
    if (writeCache) {
      const shipped = JSON.parse(await readFile(join(root, 'src/data/legoHogwartsPlan.json'), 'utf8'))
      let legacy
      if (shipped.steps.length === 819 && !shipped.constructionAssemblies) {
        legacy = { bricks: shipped.bricks, steps: shipped.steps.map(step => ({ brickIds: step.brickIds, instructionStep: step.instructionStep })), components: [] }
      } else {
        try { legacy = JSON.parse(await readFile(cachePath, 'utf8')).legacy } catch { /* A new source can omit an unavailable legacy certificate. */ }
      }
      if (legacy) {
        const old = api.normalizeImportedPlan({ ...plan, bricks: legacy.bricks, steps: [], structures: [], constructionAssemblies: undefined })
        legacy.components = api.createBuildGraph(old.bricks).components.map(component => component.map(brick => brick.id))
      }
      await writeFile(cachePath, JSON.stringify({ physicsRevision, sourcePlanSha256, steps, ...(legacy ? { legacy } : {}) }) + '\n')
    }
    console.log(JSON.stringify({ pieces: plan.bricks.length, stages: rows.length, failed, elapsedMs: performance.now() - started, cacheWritten: writeCache }))
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}
