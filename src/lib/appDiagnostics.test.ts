import { describe, expect, it } from 'vitest'
import { createAppDiagnostics, createFeedbackUrl, formatDiagnosticsMarkdown } from './appDiagnostics'
import type { BuildPlan } from '../types/bricks'

const plan: BuildPlan = {
  id: 'test-plan', title: 'Test', prompt: '', source: 'template-local', steps: [],
  bricks: [
    { id: 'a', brickId: 'brick-2x2', color: 'red', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } },
    { id: 'b', brickId: 'minecraft-stone', color: 'gray', pose: { xStud: 2, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } },
  ],
}

describe('app diagnostics', () => {
  it('summarizes the environment without serializing the project', () => {
    const diagnostics = createAppDiagnostics(plan, 'en-US', 'Test Browser', 'Test OS')
    expect(diagnostics.packCounts).toEqual({ lego: 1, minecraft: 1 })
    expect(formatDiagnosticsMarkdown(diagnostics)).toContain('Parts: 2')
  })

  it('creates a prefilled GitHub issue URL', () => {
    const url = new URL(createFeedbackUrl(plan, 'en-US'))
    expect(url.pathname).toBe('/ninjarz/brick-flow-agent/issues/new')
    expect(url.searchParams.get('body')).toContain('### Environment')
  })
})
