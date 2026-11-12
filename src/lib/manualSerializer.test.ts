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

  it.each(['xStud', 'yStud', 'zStud'] as const)('keeps the installation neighbour along %s in a large manual', (axis) => {
    const manual = serializeBuildManual({ ...plan, bricks: [base] }, 'en-US')
    const template = manual.steps[0]
    const steps = Array.from({ length: 501 }, (_, index) => ({
      ...template,
      stepNumber: index + 1,
      completedPieceCount: index + 1,
      addPieces: [{
        ...template.addPieces[0], instanceId: `piece-${index}`, name: `piece-${index}`,
        pose: { ...base.pose, [axis]: index * (axis === 'yStud' ? 1.2 : 1) },
      }],
    }))
    const html = formatBuildManualHtml({ ...manual, totalPieces: 501, totalSteps: steps.length, steps }, 'en-US')
    const finalDiagram = html.slice(html.lastIndexOf('<figure'), html.lastIndexOf('</figure>'))
    expect(finalDiagram).toContain('<title>piece-500 ')
    expect(finalDiagram).toContain('<title>piece-499 ')
    expect(finalDiagram).toContain('existing parts omitted')
  })

  it('retains every touching support even when a wide piece exceeds the diagram budget', () => {
    const manual = serializeBuildManual({ ...plan, bricks: [base] }, 'en-US')
    const template = manual.steps[0]
    const supports = Array.from({ length: 500 }, (_, index) => ({
      ...template.addPieces[0], instanceId: `support-${index}`, name: `support-${index}`,
      pose: { ...base.pose, xStud: index },
    }))
    const wide = {
      ...template.addPieces[0], instanceId: 'wide', name: 'wide',
      pose: { ...base.pose, yStud: 1.2 },
      footprint: { widthStuds: 500, depthStuds: 1, heightStuds: 1.2 },
    }
    const steps = [
      { ...template, addPieces: supports, completedPieceCount: 500 },
      { ...template, stepNumber: 2, addPieces: [wide], completedPieceCount: 501 },
    ]
    const html = formatBuildManualHtml({ ...manual, totalPieces: 501, totalSteps: 2, steps }, 'en-US')
    const finalDiagram = html.slice(html.lastIndexOf('<figure'), html.lastIndexOf('</figure>'))
    for (const support of supports) expect(finalDiagram).toContain(`<title>${support.name} `)
  })

  it('recomputes installation context when the same manual is modified between exports', () => {
    const manual = serializeBuildManual({ ...plan, bricks: [base] }, 'en-US')
    const template = manual.steps[0]
    const history = Array.from({ length: 500 }, (_, index) => ({
      ...template.addPieces[0], instanceId: `history-${index}`, name: `history-${index}`,
      pose: { ...base.pose, xStud: index * 3 },
    }))
    const added = {
      ...template.addPieces[0], instanceId: 'added', name: 'added',
      pose: { ...base.pose, yStud: 1.2 },
    }
    const mutableManual = {
      ...manual, totalPieces: 501, totalSteps: 2,
      steps: [
        { ...template, addPieces: history, completedPieceCount: 500 },
        { ...template, stepNumber: 2, addPieces: [added], completedPieceCount: 501 },
      ],
    }
    formatBuildManualHtml(mutableManual, 'en-US')
    history[0].pose.xStud = 9999
    history[499].pose.xStud = 0
    const updatedHtml = formatBuildManualHtml(mutableManual, 'en-US')
    expect(updatedHtml).toBe(formatBuildManualHtml(structuredClone(mutableManual), 'en-US'))
    const finalDiagram = updatedHtml.slice(updatedHtml.lastIndexOf('<figure'), updatedHtml.lastIndexOf('</figure>'))
    expect(finalDiagram).toContain('<title>history-499 ')
    expect(finalDiagram).not.toContain('<title>history-0 ')
  })

})
