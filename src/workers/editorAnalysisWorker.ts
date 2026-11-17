import { prepareBuildManual } from '../lib/prepareBuildManual'
import { upgradeLegacyHogwartsConstruction } from '../lib/legacyConstructionMigration'
/// <reference lib="webworker" />
import { analyzeBuildStability, type StabilityAnalysis } from '../lib/stabilityAnalysis'
import { moveBrickGroupAlongSteps, findNearestOpenBrickGroupAround, dropBrickGroupAtPoint } from '../lib/brickGroupPlacement'
import { brickById } from '../data/basicBricks'
import type { BrickDefinition } from '../types/bricks'
import { createBuildGraph, createPlanSpatialState, validateBuildPlan, hasBrickCollision, isBrickAboveGround, type BuildGraph, type BuildPlanIssue } from '../lib/planUtils'
import { prepareAnalysisGeometry } from '../lib/prepareAnalysisGeometry'
import { isVoxelPlantSupported } from '../lib/voxelBlockState'
import type { EditorAnalysisRequest, EditorAnalysisResponse } from '../lib/editorAnalysisProtocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
type Snapshot = {
  bricks: EditorAnalysisRequest['bricks']
  ready: Promise<void>
  validation?: { signature: string; issues: BuildPlanIssue[] }
  graph?: BuildGraph
  supported?: Map<string, boolean>
  stability?: StabilityAnalysis
  edit?: { key: string; stationaryBricks: Snapshot['bricks']; spatialState: ReturnType<typeof createPlanSpatialState> }
  drop?: { key: string; source: EditorAnalysisRequest['bricks']; stationaryBricks: EditorAnalysisRequest['bricks']; spatialState: ReturnType<typeof createPlanSpatialState> }
}
// Support colours, validation and X-ray share the same exact structural graph.
// Bound retention so edits cannot accumulate complete historical models.
const snapshots = new Map<number, Snapshot>()
// Rigid edits preserve the other pieces across immutable plan revisions.
// Include all serialized fields so geometry, pose and state edits invalidate reuse.
let stationaryCache: { signature: string; data: NonNullable<Snapshot['edit']> } | undefined
const getStationaryData = (bricks: Snapshot['bricks'], ids: Set<string>, key: string) => {
  const stationaryBricks = bricks.filter(brick => !ids.has(brick.id))
  const signature = JSON.stringify(stationaryBricks)
  if (stationaryCache?.signature === signature) return { ...stationaryCache.data, key }
  const data = { key, stationaryBricks, spatialState: createPlanSpatialState(stationaryBricks) }
  stationaryCache = { signature, data }
  return data
}


const getSnapshotValidation = (snapshot: Snapshot, plan: NonNullable<EditorAnalysisRequest['plan']>) => {
  const signature = JSON.stringify(plan)
  if (snapshot.validation?.signature === signature) return snapshot.validation.issues
  const graph = snapshot.graph ??= createBuildGraph(snapshot.bricks)
  const issues = validateBuildPlan({ ...plan, bricks: snapshot.bricks }, graph)
  snapshot.validation = { signature, issues }
  return issues
}

scope.onmessage = async ({ data }: MessageEvent<EditorAnalysisRequest>) => {
  try {
    let snapshot = snapshots.get(data.revision)
    if (!snapshot) {
      const definitions = [...new Set(data.bricks.map(brick => brick.brickId))]
        .map(id => brickById.get(id)).filter((value): value is BrickDefinition => Boolean(value))
      snapshot = { bricks: data.bricks, ready: prepareAnalysisGeometry(definitions, data.geometry) }
      if (snapshots.size >= 2) snapshots.delete(snapshots.keys().next().value!)
      snapshots.set(data.revision, snapshot)
    }
    await snapshot.ready
    if (data.manualLocale && data.plan) {
      const original = { ...data.plan, bricks: snapshot.bricks }
      const source = await upgradeLegacyHogwartsConstruction(original)
      const issues = source === original ? getSnapshotValidation(snapshot, data.plan) : validateBuildPlan(source)
      const manual = await prepareBuildManual(source, data.manualLocale, issues)
      scope.postMessage({ requestId: data.requestId, type: 'result', result: { supported: new Map(), manual, ...(source !== original ? { manualPlan: source } : {}) } } satisfies EditorAnalysisResponse)
      return
    }
    if (data.transform) {
      const ids = new Set(data.transform.sourceIds)
      const key = data.transform.sourceIds.join('|')
      if (snapshot.edit?.key !== key) {
        snapshot.edit = getStationaryData(snapshot.bricks, ids, key)
      }
      const { stationaryBricks, spatialState } = snapshot.edit
      if (data.transform.steps) {
        const transformedBricks = moveBrickGroupAlongSteps(data.transform.next, data.transform.steps, stationaryBricks, spatialState.collisionIndex)
      scope.postMessage({ requestId: data.requestId, type: 'result', result: { supported: new Map(), transformedBricks } } satisfies EditorAnalysisResponse)
        return
      }
      const next = data.transform.next
      let transformedBricks = next.every(brick => isBrickAboveGround(brick) && !hasBrickCollision(brick, stationaryBricks, spatialState.collisionIndex)) ? next : undefined
      if (!transformedBricks && data.transform.reposition) transformedBricks = findNearestOpenBrickGroupAround(next, snapshot.bricks, ids, { stationaryBricks, spatialState, excludedKey: [...ids].sort().join('|') }, true)
      scope.postMessage({ requestId: data.requestId, type: 'result', result: { supported: new Map(), transformedBricks } } satisfies EditorAnalysisResponse)
      return
    }
    if (data.drop) {
      const key = data.drop.sourceIds.join('|')
      if (snapshot.drop?.key !== key) {
        const ids = new Set(data.drop.sourceIds)
        const source = snapshot.bricks.filter(brick => ids.has(brick.id))
        const stationaryBricks = snapshot.bricks.filter(brick => !ids.has(brick.id))
        snapshot.drop = { key, source, stationaryBricks, spatialState: createPlanSpatialState(stationaryBricks) }
      }
      const dropBricks = dropBrickGroupAtPoint(snapshot.drop.source, data.drop.anchorId, data.drop.point, snapshot.drop)
      scope.postMessage({ requestId: data.requestId, type: 'result', result: { supported: new Map(), dropBricks } } satisfies EditorAnalysisResponse)
      return
    }
    const graph = snapshot.graph ??= createBuildGraph(snapshot.bricks)
    snapshot.supported ??= new Map(snapshot.bricks.map(brick => [brick.id,
      graph.groundedIds.has(brick.id) && isVoxelPlantSupported(brick, snapshot!.bricks),
    ]))
    if (data.stability) snapshot.stability ??= analyzeBuildStability(snapshot.bricks, snapshot.graph)
    const issues = data.plan ? getSnapshotValidation(snapshot, data.plan) : undefined
    scope.postMessage({ requestId: data.requestId, type: 'result', result: { supported: snapshot.supported, issues, stability: data.stability ? snapshot.stability : undefined } } satisfies EditorAnalysisResponse)
  } catch (error) {
    snapshots.delete(data.revision)
    scope.postMessage({ requestId: data.requestId, type: 'error', message: error instanceof Error ? error.message : 'EDITOR_ANALYSIS_FAILED' } satisfies EditorAnalysisResponse)
  }
}
