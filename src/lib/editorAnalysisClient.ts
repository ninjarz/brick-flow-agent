import { loadPrecomputedStructuralCells } from './ldrawStructuralCache'
import { getBrickStructuralCells } from './structuralGrid'
import type { HorizontalDropPoint } from './brickGroupPlacement'
import { brickById } from '../data/basicBricks'
import { loadLDrawGeneratedVisual } from './ldrawGeneratedVisualLoader'
import { getLoadedLDrawLocalBounds } from './ldrawBounds'
import type { EditorAnalysisRequest } from './editorAnalysisProtocol'
import { analyzeBuildStability, type StabilityAnalysis } from './stabilityAnalysis'
import { createBuildGraph, validateBuildPlan, type BuildPlanIssue } from './planUtils'
import { preparePlanGeometry } from './planGeometry'
import { isVoxelPlantSupported } from './voxelBlockState'
import type { BrickDefinition, BuildPlan, PlacedBrick } from '../types/bricks'
import type { EditorAnalysisResponse, EditorAnalysisResult } from './editorAnalysisProtocol'

export const backgroundAnalysisThreshold = 800
const supportCache = new WeakMap<PlacedBrick[], Promise<Map<string, boolean>>>()
const validationCache = new WeakMap<BuildPlan, Promise<BuildPlanIssue[]>>()
const stabilityCache = new WeakMap<PlacedBrick[], Promise<StabilityAnalysis>>()
const geometryInputs = new WeakMap<PlacedBrick[], Promise<EditorAnalysisRequest['geometry']>>()
const revisions = new WeakMap<PlacedBrick[], number>()
let nextRevision = 0
let nextRequest = 0
let worker: Worker | undefined
const pending = new Map<number, { resolve: (result: EditorAnalysisResult) => void; reject: (error: Error) => void }>()

const fail = () => {
  worker?.terminate()
  worker = undefined
  for (const request of pending.values()) request.reject(new Error('EDITOR_ANALYSIS_WORKER_FAILED'))
  pending.clear()
}

const getAnalysisGeometry = (bricks: PlacedBrick[]) => {
  const cached = geometryInputs.get(bricks)
  if (cached) return cached
  const definitions = [...new Set(bricks.map(brick => brick.brickId))]
    .map(id => brickById.get(id)).filter((definition): definition is BrickDefinition => definition?.pack === 'lego')
  const loading = (async () => {
    await loadLDrawGeneratedVisual(definitions.map(definition => definition.partNumber))
    return Promise.all(definitions.map(async definition => {
      const cached = await loadPrecomputedStructuralCells(definition)
      return {
        brickId: definition.id,
        partNumber: definition.partNumber,
        bounds: getLoadedLDrawLocalBounds(definition.partNumber),
        // New or changed moulds retain the original exact sampler. Known
        // moulds use the compact cache independently in each thread.
        cells: cached ? undefined : getBrickStructuralCells(definition),
      }
    }))
  })()
  geometryInputs.set(bricks, loading)
  void loading.catch(() => geometryInputs.delete(bricks))
  return loading
}

const request = async (bricks: PlacedBrick[], plan?: BuildPlan, stability = false, drop?: EditorAnalysisRequest['drop']): Promise<EditorAnalysisResult> => {
  const geometry = await getAnalysisGeometry(bricks)
  if (!worker) {
    worker = new Worker(new URL('../workers/editorAnalysisWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<EditorAnalysisResponse>) => {
      const job = pending.get(data.requestId)
      if (!job) return
      pending.delete(data.requestId)
      if (data.type === 'result') job.resolve(data.result)
      else job.reject(new Error(data.message))
    }
    worker.onerror = fail
    worker.onmessageerror = fail
  }
  let revision = revisions.get(bricks)
  if (revision === undefined) {
    revision = ++nextRevision
    revisions.set(bricks, revision)
  }
  const requestId = ++nextRequest
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
    try {
      // The canonical snapshot already carries the pieces; do not clone them
      // twice when validation also needs the plan metadata.
      worker!.postMessage({ requestId, revision, bricks, plan: plan ? { ...plan, bricks: [] } : undefined, stability, geometry, drop })
    } catch (error) {
      pending.delete(requestId)
      reject(error)
    }
  })
}

export const getEditorSupport = (bricks: PlacedBrick[]) => {
  const cached = supportCache.get(bricks)
  if (cached) return cached
  const result = bricks.length >= backgroundAnalysisThreshold && typeof Worker !== 'undefined'
    ? request(bricks).then(result => result.supported)
    : Promise.resolve().then(() => {
      const graph = createBuildGraph(bricks)
      return new Map(bricks.map(brick => [brick.id, graph.groundedIds.has(brick.id) && isVoxelPlantSupported(brick, bricks)]))
    })
  supportCache.set(bricks, result)
  void result.catch(() => supportCache.delete(bricks))
  return result
}

export const getEditorValidation = (plan: BuildPlan) => {
  const cached = validationCache.get(plan)
  if (cached) return cached
  const result = plan.bricks.length >= backgroundAnalysisThreshold && typeof Worker !== 'undefined'
    ? request(plan.bricks, plan).then(result => result.issues!)
    : preparePlanGeometry(plan).then(() => validateBuildPlan(plan))
  validationCache.set(plan, result)
  void result.catch(() => validationCache.delete(plan))
  return result
}

export const getEditorStability = (bricks: PlacedBrick[]) => {
  const cached = stabilityCache.get(bricks)
  if (cached) return cached
  const result = bricks.length >= backgroundAnalysisThreshold && typeof Worker !== 'undefined'
    ? request(bricks, undefined, true).then(result => result.stability!)
    : Promise.resolve().then(() => analyzeBuildStability(bricks))
  stabilityCache.set(bricks, result)
  void result.catch(() => stabilityCache.delete(bricks))
  return result
}

if (import.meta.hot) import.meta.hot.dispose(fail)

/** One in-flight drop plus the newest pointer position: never queue a trail of
 * obsolete collision jobs behind a fast pointer. */
type DropJob = {
  key: string
  run: () => Promise<PlacedBrick[] | undefined>
  resolve: (value: PlacedBrick[] | undefined) => void
  reject: (error: unknown) => void
  promise: Promise<PlacedBrick[] | undefined>
}
const dropQueues = new WeakMap<PlacedBrick[], Map<PlacedBrick[], { active?: DropJob; next?: DropJob }>>()
export const canBackgroundDrop = (bricks: PlacedBrick[]) => typeof Worker !== 'undefined' &&
  bricks.length >= backgroundAnalysisThreshold && bricks.every(brick => brickById.get(brick.brickId)?.pack === 'lego')

export const getEditorDrop = (bricks: PlacedBrick[], source: PlacedBrick[], anchorId: string, point: HorizontalDropPoint) => {
  let bySource = dropQueues.get(bricks)
  if (!bySource) { bySource = new Map(); dropQueues.set(bricks, bySource) }
  let queue = bySource.get(source)
  if (!queue) {
    if (bySource.size >= 4) bySource.delete(bySource.keys().next().value!)
    queue = {}; bySource.set(source, queue)
  }
  const key = `${anchorId}:${point.x}:${point.z}`
  if (queue.next?.key === key) return queue.next.promise
  if (!queue.next && queue.active?.key === key) return queue.active.promise
  const job = { key, run: () => request(bricks, undefined, false, { sourceIds: source.map(brick => brick.id), anchorId, point }).then(result => result.dropBricks) } as DropJob
  job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject })
  const state = queue
  const start = (current: DropJob) => {
    state.active = current
    void current.run().then(current.resolve, current.reject).finally(() => {
      state.active = undefined
      const next = state.next
      state.next = undefined
      if (next) start(next)
    })
  }
  if (state.active) { state.next?.resolve(undefined); state.next = job }
  else start(job)
  return job.promise
}
