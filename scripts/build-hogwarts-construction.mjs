import * as esbuild from 'esbuild'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const root = process.cwd()
const research = resolve(process.argv[2] ?? '.cache/71043-private-work/workspace/public/research')
const output = resolve(process.argv[3] ?? '.cache/precision-construction')
const temporary = await mkdtemp(join(tmpdir(), 'brick-construction-'))
const components = ['founders', 'boats', 'annex', 'east', 'hut', 'willow', 'figures']
const names = { founders: '创始人与展示台', boats: '渡船', annex: '礼堂与主塔', east: '东侧城堡', hut: '海格小屋', willow: '打人柳与汽车', figures: '微缩人物' }
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

// These detached ranges are the construction scopes recorded by the reviewed research viewer.
const detachedRanges = {
  annex: [[7,12],[23,28],[33,40],[49,56],[63,68],[87,109],[120,125],[171,171],[195,201],[292,297],[304,313],[315,323],[325,331],[333,338],[341,354],[356,361],[363,370],[372,385],[390,433],[419,419],[428,431],[436,443]],
  east: [[14,25],[45,58],[102,112],[130,141],[177,184],[186,186],[219,233],[238,248]],
}
const scopeStart = (component, record) => {
  if (record.constructionStartStep !== undefined) return record.constructionStartStep - 1
  // Inner ranges take precedence over an enclosing wall range.
  const matching = (detachedRanges[component] ?? []).filter(([start, end]) => record.number >= start && record.number <= end)
  return matching.length ? Math.max(...matching.map(([start]) => start - 1)) : 0
}

try {
  const entry = join(temporary, 'api.ts'), bundled = join(temporary, 'api.mjs')
  await writeFile(entry, `
    export { Matrix4 } from ${JSON.stringify(root + '/node_modules/three/build/three.module.js')};
    export { brickById } from ${JSON.stringify(root + '/src/data/basicBricks.ts')};
    export { prepareStructuralGeometry } from ${JSON.stringify(root + '/src/lib/prepareStructuralGeometry.ts')};
    export { normalizeImportedPlan } from ${JSON.stringify(root + '/src/lib/planImport.ts')};
    export { getBrickBounds, createBuildGraph, validateBuildPlan } from ${JSON.stringify(root + '/src/lib/planUtils.ts')};
    export { getRigidBrickMatrix, getOrientationResidual } from ${JSON.stringify(root + '/src/lib/rigidBrickTransform.ts')};
    export { isValidConstructionData } from ${JSON.stringify(root + '/src/lib/constructionPlan.ts')};
  `)
  await esbuild.build({ entryPoints: [entry], outfile: bundled, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  const api = await import(bundled)
  const original = await readJson(join(root, 'src/data/legoHogwartsPlan.json'))
  const source = api.normalizeImportedPlan(await readJson(join(research, '71043.json')))
  const plan = api.normalizeImportedPlan(original)
  delete plan.constructionAssemblies
  const definitions = [...new Set(plan.bricks.map(brick => brick.brickId))].map(id => api.brickById.get(id))
  await api.prepareStructuralGeometry(definitions)
  const calibrated = []
  const originalById = new Map(original.bricks.map(brick => [brick.id, brick]))
  for (const brick of plan.bricks) {
    const before = originalById.get(brick.id)
    if (JSON.stringify(before.pose) !== JSON.stringify(brick.pose)) calibrated.push(brick.id)
  }
  const floorShifts = []
  for (const component of api.createBuildGraph(plan.bricks).components) {
    const measured = Math.min(...component.map(brick => api.getBrickBounds(brick).minY))
    const roundoff = Number.EPSILON * 64 * Math.max(1, ...component.map(brick => Math.abs(brick.pose.yStud)))
    const minimum = Math.abs(measured) <= roundoff ? 0 : measured
    floorShifts.push({ first: component[0].id, pieces: component.length, shift: -minimum })
    for (const brick of component) brick.pose = { ...brick.pose, yStud: brick.pose.yStud - minimum }
  }
  const liveIds = new Set(plan.bricks.map(brick => brick.id))
  const sourceById = new Map(source.bricks.map(brick => [brick.id, brick]))
  const assemblies = {}, rawStages = []
  const assembly = (id, ids) => {
    for (const brickId of ids) assert.ok(liveIds.has(brickId), `Unknown construction piece ${brickId}`)
    const previous = assemblies[id]?.brickIds ?? []
    assemblies[id] = { brickIds: [...new Set([...previous, ...ids])] }
    return id
  }
  const relativeAdjustment = (brickId, pose, anchorBrickId) => {
    const originalBrick = sourceById.get(brickId), anchor = sourceById.get(anchorBrickId)
    assert.ok(originalBrick && anchor, `Missing source articulation ${brickId}`)
    const normalized = api.normalizeImportedPlan({ ...source, bricks: [{ ...originalBrick, pose }], steps: [], structures: [] }).bricks[0]
    const matrixFor = brick => api.getRigidBrickMatrix(api.brickById.get(brick.brickId), brick.pose)
    const base = matrixFor(anchor)
    const delta = base.clone().invert().multiply(matrixFor(normalized)).multiply(matrixFor(originalBrick).invert()).multiply(base)
    const elements = delta.toArray()
    elements[3] = elements[7] = elements[11] = 0; elements[15] = 1
    return { brickId, anchorBrickId, matrix: elements }
  }
  let order = 0
  for (const component of components) {
    const study = await readJson(join(research, `71043-${component}.json`))
    for (let index = 0; index < study.steps.length; index++) {
      const record = study.steps[index]
      const start = scopeStart(component, record)
      const prefix = study.steps.slice(start, index + 1).flatMap(item => item.ids)
      const scopeId = assembly(`71043-${component}-${start}${component === 'founders' ? `-${index}` : ''}`, prefix)
      let reset = 0
      const addStage = (phase, ids, number, page, scope, internal) => {
        const baseBrickId = phase.constructionBase
        const construction = { assemblyId: scope,
          ...(baseBrickId ? { baseBrickId } : {}),
          ...(phase.constructionFlip ? { flip: true } : {}),
          official: { set: '71043', book: record.manual.book, page, numberedStep: record.number, ...(internal ? { inset: number } : {}) },
          focusBrickIds: [...new Set(internal ? ids : record.focusIds ?? (record.ids.length ? record.ids
            : study.steps.slice(scopeStart(component, study.steps[Math.max(0, index - 1)]), index).flatMap(item => item.ids)))],
        }
        const hidden = phase.pendingStickers ?? record.pendingStickers
        if (hidden?.length) construction.hiddenPrintBrickIds = hidden
        if (phase.constructionPoses) {
          assert.ok(baseBrickId, `Articulation needs a reference base at ${component} ${record.number}`)
          construction.adjustments = Object.entries(phase.constructionPoses).map(([id, pose]) => relativeAdjustment(id, pose, baseBrickId))
        }
        if (!internal && record.constructionCopies?.length) {
          construction.groups = record.constructionCopies.map((members, copy) => ({
            assemblyId: assembly(`71043-${component}-${record.number}-copy-${copy}`, members),
            baseBrickId: record.constructionBases?.[copy] ?? baseBrickId,
            ...(phase.constructionFlip ? { flip: true } : {}),
          }))
        }
        if (!internal && record.looseConstructionParts?.length) {
          const loose = new Set(record.looseConstructionParts)
          construction.groups = [{ assemblyId: assembly(`71043-${component}-${record.number}-seated`, prefix.filter(id => !loose.has(id))), ...(baseBrickId ? { baseBrickId } : {}), ...(phase.constructionFlip ? { flip: true } : {}) },
            ...record.looseConstructionParts.map(id => ({ assemblyId: assembly(`71043-${component}-${record.number}-loose-${id}`, [id]) }))]
        }
        rawStages.push({ id: `hogwarts-${component}-${record.number}${internal ? `-inset-${number}` : ''}`,
          title: `${names[component]} · ${record.number}${internal ? ` · ${phase.label ?? '子步骤 ' + number}` : ''}`,
          description: `官方说明书第 ${record.manual.book} 册，第 ${page} 页。`,
          sourceIds: [...new Set(ids)], brickIds: [], construction, order: order++ })
      }
      const internals = record.internalSubsteps ?? []
      for (let inset = 0; inset < internals.length; inset++) {
        const phase = internals[inset]
        if (phase.resetAssembly) reset = inset
        const ids = internals.slice(reset, inset + 1).flatMap(item => item.ids)
        const innerScope = assembly(`71043-${component}-${record.number}-inset-${reset}`, ids)
        addStage(phase, phase.ids, inset + 1, phase.page, innerScope, true)
      }
      addStage(record, record.ids, record.number, Math.max(record.manual.page, ...internals.map(item => item.page)), scopeId, false)
    }
  }
  const castleIds = plan.structures.filter(structure => ['hogwarts-annex', 'hogwarts-east'].includes(structure.id)).flatMap(structure => structure.brickIds)
  assert.equal(castleIds.length, 5773)
  rawStages.push({ id: 'hogwarts-castle-installation', title: '连接两侧城堡', description: '官方说明书第 4 册，第 176 页。对准底部连接销，拼合两侧城堡。', sourceIds: [], brickIds: [], order: order++,
    construction: { assemblyId: assembly('71043-castle-complete', castleIds), focusBrickIds: plan.structures.find(structure => structure.id === 'hogwarts-east').brickIds, official: { set: '71043', book: 4, page: 176 } } })
  const separator = 'hogwarts-reference-manualBrickSeparator'
  rawStages.push({ id: 'hogwarts-separator', title: '拆件器', description: '随套装附带的橙色拆件器。', sourceIds: [separator], brickIds: [], order: order++,
    construction: { assemblyId: assembly('71043-separator', [separator]), official: { set: '71043', book: 4, page: 184 } } })
  rawStages.sort((a,b) => a.construction.official.book - b.construction.official.book || a.construction.official.page - b.construction.official.page || a.order - b.order)
  const introduced = new Set()
  for (const stage of rawStages) {
    stage.brickIds = stage.sourceIds.filter(id => !introduced.has(id))
    for (const id of stage.brickIds) introduced.add(id)
  }
  assert.equal(introduced.size, 6025, 'Every final piece must appear in the construction timeline')
  rawStages.push({ id: 'hogwarts-complete', title: '套装总览', description: '查看全部已完成的城堡、分总成与附带零件。', sourceIds: [], brickIds: [], order: order++,
    construction: { assemblyId: assembly('71043-complete', plan.bricks.map(brick => brick.id)) } })
  plan.steps = rawStages.map((raw, index) => {
    const stage = { ...raw, construction: { ...raw.construction, sourceStepId: raw.id }, instructionStep: index + 1 }
    delete stage.sourceIds
    delete stage.order
    return stage
  })
  const finalById = new Map(plan.bricks.map(brick => [brick.id, brick]))
  plan.bricks = plan.steps.flatMap(step => step.brickIds).map(id => finalById.get(id))
  assemblies['71043-complete'].brickIds = plan.bricks.map(brick => brick.id)
  plan.constructionAssemblies = assemblies
  assert.ok(api.isValidConstructionData(plan), 'Construction references and transforms must be valid')
  const issues = api.validateBuildPlan(plan)
  const blocking = issues.filter(issue => issue.type !== 'disconnected-island')
  const report = { pieces: plan.bricks.length, stages: plan.steps.length, assemblies: Object.keys(assemblies).length,
    normalizedRecords: calibrated.length, rigidPosesCalibrated: original.bricks.filter(brick => brick.pose.orientationMatrix && api.getOrientationResidual(brick.pose.orientationMatrix) > 1e-12).length, maximumOrthonormalityResidual: Math.max(...plan.bricks.map(brick => brick.pose.orientationMatrix ? api.getOrientationResidual(brick.pose.orientationMatrix) : 0)),
    floorShifts, blocking, issueCount: issues.length, inputSha256: createHash('sha256').update(JSON.stringify(original)).digest('hex') }
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  await writeFile(join(output, 'build-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, floorShifts: report.floorShifts.length, blocking: report.blocking.slice(0,20) }, null, 2))
  assert.equal(blocking.length, 0, 'The calibrated complete asset must pass native checks')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
