/// <reference lib="webworker" />
import { analyzeBuildStability, type StabilityAnalysis } from '../lib/stabilityAnalysis'
import { dropBrickGroupAtPoint } from '../lib/brickGroupPlacement'
import { brickById } from '../data/basicBricks'
import type { BrickDefinition } from '../types/bricks'
import { createBuildGraph, createPlanSpatialState, validateBuildPlan, type BuildGraph } from '../lib/planUtils'
import { prepareAnalysisGeometry } from '../lib/prepareAnalysisGeometry'
import { isVoxelPlantSupported } from '../lib/voxelBlockState'
import type { EditorAnalysisRequest, EditorAnalysisResponse } from '../lib/editorAnalysisProtocol'

const scope = self as unknown as DedicatedWorkerGlobalScope
type Snapshot = {
  bricks: EditorAnalysisRequest['bricks']
  ready: Promise<void>
  graph?: BuildGraph
  supported?: Map<string, boolean>
  stability?: StabilityAnalysis
  drop?: { key: string; source: EditorAnalysisRequest['bricks']; stationaryBricks: EditorAnalysisRequest['bricks']; spatialState: ReturnType<typeof createPlanSpatialState> }
}
// Support colours, validation and X-ray share the same exact structural graph.
// Bound retention so edits cannot accumulate complete historical models.
const snapshots = new Map<number, Snapshot>()

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
      graph.groundedIds.has(brick.id) && isVoxelPlantSupported(brick, data.bricks),
    ]))
    if (data.stability) snapshot.stability ??= analyzeBuildStability(snapshot.bricks, snapshot.graph)
    const issues = data.plan ? validateBuildPlan({ ...data.plan, bricks: snapshot.bricks }, snapshot.graph) : undefined
    scope.postMessage({ requestId: data.requestId, type: 'result', result: { supported: snapshot.supported, issues, stability: data.stability ? snapshot.stability : undefined } } satisfies EditorAnalysisResponse)
  } catch (error) {
    scope.postMessage({ requestId: data.requestId, type: 'error', message: error instanceof Error ? error.message : 'EDITOR_ANALYSIS_FAILED' } satisfies EditorAnalysisResponse)
  }
}
