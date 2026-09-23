import { describe, expect, it } from 'vitest'
import type { BuildPlan } from '../types/bricks'
import { formatBuildManualHtml, serializeBuildManual } from './manualSerializer'
import { makeBrick } from './planUtils'

const base = makeBrick('brick-1x1', 'gray', 0, 0, 0)
const sidePiece = makeBrick('tile-1x1', 'gray', 1, 0, 0, 0, 1)
const plan: BuildPlan = {
  id: 'manual-v5-test',
  title: 'Manual 2.0',
  prompt: 'test assembly guides',
  source: 'template-local',
  bricks: [base, sidePiece],
  steps: [],
}

describe('build manual 2.0', () => {
  it('serializes delta-only steps with camera and assembly guidance', () => {
    const manual = serializeBuildManual(plan, 'en-US')
    expect(manual.schemaVersion).toBe(6)
    expect(manual.steps[0].cameraAzimuthDegrees).toBeTypeOf('number')
    expect(manual.steps.flatMap((step) => step.addPieces).every((piece) => (
      piece.assembly.label.length > 0 && Number.isFinite(piece.assembly.explodedOffset.yStud)
    ))).toBe(true)
    expect(JSON.stringify(manual)).not.toContain('cumulativePieces')
  })

  it('renders exploded installation arrows in standalone HTML', () => {
    const html = formatBuildManualHtml(serializeBuildManual(plan, 'en-US'), 'en-US')
    expect(html).toContain('assembly-arrow')
    expect(html).toContain('Install')
  })
})
