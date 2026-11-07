import type { StructuralCell } from './structuralGrid'
import type { HorizontalDropPoint } from './brickGroupPlacement'
import type { BrickBounds } from './ldrawBounds'
import type { BuildPlanIssue } from './planUtils'
import type { StabilityAnalysis } from './stabilityAnalysis'
import type { BuildPlan, PlacedBrick } from '../types/bricks'
export type EditorAnalysisRequest = {
  requestId: number
  revision: number
  bricks: PlacedBrick[]
  geometry: Array<{ brickId: string; partNumber: string; bounds?: BrickBounds; cells?: StructuralCell[] }>
  plan?: BuildPlan
  stability?: boolean
  transform?: { sourceIds: string[]; next: PlacedBrick[]; reposition: boolean; steps?: Array<{ xStud?: number; yStud?: number; zStud?: number }> }
  drop?: { sourceIds: string[]; anchorId: string; point: HorizontalDropPoint }
}
export type EditorAnalysisResult = { transformedBricks?: PlacedBrick[]; supported: Map<string, boolean>; issues?: BuildPlanIssue[]; stability?: StabilityAnalysis; dropBricks?: PlacedBrick[] }
export type EditorAnalysisResponse = { requestId: number } & (
  { type: 'result'; result: EditorAnalysisResult } | { type: 'error'; message: string }
)
