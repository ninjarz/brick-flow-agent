import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmConfig } from '../../types/bricks'
import { getBlockingBuildPlanIssues, validateBuildPlan, validateBuildPlanStructural } from '../planUtils'
import { requestLlmJsonContent } from '../llmGenerator'
import { applyAgentAction, createBuildState } from './executor'
import { generateAgenticBuildPlan, parseAgentManual } from './loop'
import { tryRoofRecipe } from './roofRecipe'

vi.mock('../llmGenerator', () => ({
  requestLlmJsonContent: vi.fn(),
  modelReasonsWhenDisabled: () => false,
}))

const request = vi.mocked(requestLlmJsonContent)
const config: LlmConfig = {
  endpoint: 'https://example.test/chat', apiKey: 'test-key', modelName: 'fixture',
  requestMode: 'direct', enableThinking: false, autoRepair: true,
}
const manual = {
  title: 'House', subject: 'other', foundation: 'deck', size: [6, 6, 4],
  components: [{ name: 'Base', goal: 'Build a deck' }, { name: 'House', goal: 'Build the walls' }],
}
const placeDeck = (size: number[]) => ({
  action: 'place', done: true, items: [{ kind: 'deck', x: 0, z: 0, size, color: 'green' }],
})
const reply = (value: unknown) => request.mockResolvedValueOnce(JSON.stringify(value))
beforeEach(() => request.mockReset())

describe('agentic foundation gate', () => {
  it('retries premature completion and an undersized deck before starting the house', async () => {
    reply(manual)
    reply({ action: 'done' })
    reply(placeDeck([4, 4]))
    reply(placeDeck([6, 6]))
    reply({ action: 'place', done: true, items: [{ brickId: 'brick-1x1', x: 0, z: 0, color: 'red' }] })
    const onFoundationAccepted = vi.fn()
    const onLog = vi.fn()
    const plan = await generateAgenticBuildPlan({ prompt: 'House', config, locale: 'en-US', detailTurns: 0, onFoundationAccepted, onLog })
    expect(request.mock.calls.slice(1, 4).every(([call]) => call.userPrompt.includes('Current component 1/2'))).toBe(true)
    expect(request.mock.calls[4][0].userPrompt).toContain('Current component 2/2')
    expect(request.mock.calls[2][0].userPrompt).toContain('full-size ground deck has not been built')
    expect(onFoundationAccepted).toHaveBeenCalledExactlyOnceWith(plan.structures![0].brickIds)
    expect(onLog.mock.calls[2][0]).toMatchObject({ requestMs: expect.any(Number), executionMs: expect.any(Number) })
    expect(getBlockingBuildPlanIssues(validateBuildPlan(plan))).toEqual([])
  })

  it('reports the failed component and never starts the house when the budget runs out', async () => {
    reply(manual)
    reply(placeDeck([4, 4]))
    reply({ action: 'done' })
    await expect(generateAgenticBuildPlan({ prompt: 'House', config, locale: 'en-US', maxTurnsPerComponent: 2, detailTurns: 0 }))
      .rejects.toThrow(/Component "Base".*6 × 6/)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not publish a bare base when the house reports completion without building', async () => {
    reply(manual)
    reply(placeDeck([6, 6]))
    reply({ action: 'done' })
    await expect(generateAgenticBuildPlan({ prompt: 'House', config, locale: 'en-US', maxTurnsPerComponent: 1, detailTurns: 0 }))
      .rejects.toThrow(/Component "House".*accepted parts/)
  })

  it('protects both the deck and built structure during the detail pass', async () => {
    reply(manual)
    reply(placeDeck([6, 6]))
    reply({ action: 'place', done: true, items: [{ brickId: 'brick-1x1', x: 0, z: 0, color: 'red' }] })
    let beforeDetails: string[] = []
    let latestIds: string[] = []
    const onLog = vi.fn()
    request.mockImplementationOnce(async () => JSON.stringify({ action: 'remove', ids: [beforeDetails[0], beforeDetails.at(-1)] }))
    reply({ action: 'done' })
    const plan = await generateAgenticBuildPlan({
      prompt: 'House', config, detailTurns: 2, onLog,
      onStatus: status => {
        if (status.phase === 'details' && status.turn === 0) beforeDetails = latestIds
      },
      onProgress: draft => { latestIds = draft.bricks.map(brick => brick.id) },
    })
    expect(onLog.mock.calls.find(([entry]) => entry.action === 'remove')?.[0]).toMatchObject({ rejected: 1, removed: 0 })
    expect(plan.bricks.map(brick => brick.id)).toEqual(beforeDetails)
  })

  it('supports an explicit freestanding subject and rejects unusable deck dimensions', async () => {
    expect(() => parseAgentManual({ ...manual, size: [33, 6, 4] })).toThrow(/1 to 32/)
    reply({ title: 'Robot', subject: 'other', foundation: 'freestanding', components: [{ name: 'Feet', goal: 'Start the robot' }] })
    reply({ action: 'place', done: true, items: [{ brickId: 'brick-1x1', x: 0, z: 0, color: 'red' }] })
    const plan = await generateAgenticBuildPlan({ prompt: 'Robot', config, detailTurns: 0 })
    expect(plan.bricks).toHaveLength(1)
  })
})

describe('building completion targets', () => {
  const building = {
    ...manual, subject: 'building',
    components: [
      manual.components[0],
      { name: 'Walls', goal: 'Enclose the house', completion: { kind: 'walls', x: 1, y: 0.8, z: 1, width: 4, depth: 4, courses: 1 } },
      { name: 'Roof', goal: 'Cover the house', completion: { kind: 'roof', x: 1, y: 2, z: 1, width: 4, depth: 4 } },
    ] as const,
  }
  const place = (items: unknown[]) => ({ action: 'place', done: true, items })
  const walls = { kind: 'walls', x: 1, y: 0.8, z: 1, size: [4, 4], courses: 1, color: 'white' }
  const roof = { kind: 'deck', x: 1, y: 2, z: 1, size: [4, 4], color: 'gray' }

  it('requires the building plan to declare a walls and roof target in order', () => {
    expect(() => parseAgentManual({ ...building, components: building.components.slice(0, 2) })).toThrow(/roof completion/)
    expect(() => parseAgentManual({ ...building, components: [building.components[0], building.components[2], building.components[1]] })).toThrow(/roof completion/)
    const partialRoof = { ...building.components[2], completion: { ...building.components[2].completion, depth: 2 } }
    expect(() => parseAgentManual({ ...building, components: [building.components[0], building.components[1], partialRoof] })).toThrow(/cover the main walls/)
    expect(parseAgentManual(building).components[1].completion).toMatchObject({ kind: 'walls', courses: 1 })
  })

  it('preserves the planned footprint when an optional gable recipe has an odd span', () => {
    const [base, shell, top] = building.components
    const target = { ...top.completion, depth: 5 }
    const parsed = parseAgentManual({ ...building, components: [base, shell, { ...top, completion: {
      ...target, recipe: { style: 'gable', ridge: 'x', color: 'gray' },
    } }] })
    expect(parsed.components[2].completion).toEqual(target)
  })

  it('retries incomplete walls and a half roof until the full targets are built', async () => {
    reply(building)
    reply(placeDeck([6, 6]))
    reply(place([{ kind: 'wall', x: 1, y: 0.8, z: 1, length: 4, axis: 'x', courses: 1, color: 'white' }]))
    reply(place([
      { kind: 'wall', x: 1, y: 0.8, z: 4, length: 4, axis: 'x', courses: 1, color: 'white' },
      { kind: 'wall', x: 1, y: 0.8, z: 2, length: 2, axis: 'z', courses: 1, color: 'white' },
      { kind: 'wall', x: 4, y: 0.8, z: 2, length: 2, axis: 'z', courses: 1, color: 'white' },
    ]))
    reply(place([{ ...roof, size: [4, 2] }]))
    reply(place([{ ...roof, z: 3, size: [4, 2] }]))
    const plan = await generateAgenticBuildPlan({ prompt: 'House', config, detailTurns: 0 })
    expect(request.mock.calls[3][0].userPrompt).toContain('Walls are missing')
    expect(request.mock.calls[5][0].userPrompt).toContain('Roof coverage is missing 8 stud cells')
    expect(request.mock.calls[5][0].userPrompt).toContain('z=3: x=1–4; z=4: x=1–4')
    expect(plan.structures?.map(structure => structure.name)).toEqual(['Base', 'Walls', 'Roof'])
    expect(getBlockingBuildPlanIssues(validateBuildPlan(plan))).toEqual([])
  })

  it('rejects a failed roof and respects a planned opening in a completed wall', async () => {
    const opening = { side: 'front', offset: 1, width: 1, bottom: 0, courses: 1 }
    const wallTarget = building.components[1]
    reply({ ...building, components: [building.components[0], { ...wallTarget, completion: { ...wallTarget.completion, openings: [opening] } }, building.components[2]] })
    reply(placeDeck([6, 6]))
    reply(place([
      { kind: 'wall', x: 1, y: 0.8, z: 4, length: 4, axis: 'x', courses: 1, color: 'white' },
      { kind: 'wall', x: 1, y: 0.8, z: 1, length: 3, axis: 'z', courses: 1, color: 'white' },
      { kind: 'wall', x: 4, y: 0.8, z: 1, length: 3, axis: 'z', courses: 1, color: 'white' },
      { brickId: 'brick-1x1', x: 3, y: 0.8, z: 1, color: 'white' },
    ]))
    reply(place([{ ...roof, z: 3, size: [4, 2] }]))
    await expect(generateAgenticBuildPlan({ prompt: 'House', config, locale: 'en-US', maxTurnsPerComponent: 1, detailTurns: 0 }))
      .rejects.toThrow(/Component "Roof" is incomplete: Roof coverage is missing 8/)
  })

  it('accepts a closed-wall primitive and a full roof in a single turn per module', async () => {
    reply(building)
    reply(placeDeck([6, 6]))
    reply(place([walls]))
    reply(place([roof]))
    const plan = await generateAgenticBuildPlan({ prompt: 'House', config, maxTurnsPerComponent: 1, detailTurns: 0 })
    expect(plan.structures).toHaveLength(3)
  })

  it('builds a flat roof after the walls with no roof-specific model request', async () => {
    const [base, shell, top] = building.components
    reply({ ...building, components: [base, shell, { ...top, completion: {
      ...top.completion, recipe: { style: 'flat', color: 'gray' },
    } }] })
    reply(placeDeck([6, 6]))
    reply(place([walls]))
    const onLog = vi.fn()
    const onComponentVerified = vi.fn()
    const plan = await generateAgenticBuildPlan({ prompt: 'House', config, maxTurns: 2, detailTurns: 0, onLog, onComponentVerified })
    expect(request).toHaveBeenCalledTimes(3)
    const builtRoof = plan.structures?.at(-1)
    expect(builtRoof?.name).toBe('Roof')
    expect(plan.steps.at(-1)?.brickIds).toEqual(builtRoof?.brickIds)
    expect(onComponentVerified).toHaveBeenLastCalledWith(builtRoof?.brickIds)
    const log = onLog.mock.lastCall?.[0]
    expect(log).toMatchObject({ action: 'roof-recipe', placed: builtRoof?.brickIds.length, rejected: 0, executionMs: expect.any(Number) })
    expect(log?.requestMs).toBeUndefined()
    expect(getBlockingBuildPlanIssues(validateBuildPlan(plan))).toEqual([])
  })

  it('feeds a failed local recipe back to the model and records only the recovered roof', async () => {
    const [base, shell, top] = building.components
    reply({ ...building, components: [base, shell, { ...top, completion: {
      ...top.completion, y: 3.2, recipe: { style: 'flat', color: 'gray' },
    } }] })
    reply(placeDeck([6, 6]))
    reply(place([walls]))
    reply(place([{ ...walls, y: 2 }, { ...roof, y: 3.2 }]))
    const onLog = vi.fn()
    const plan = await generateAgenticBuildPlan({ prompt: 'House', config, detailTurns: 0, onLog })
    expect(request).toHaveBeenCalledTimes(4)
    expect(request.mock.lastCall?.[0].userPrompt).toContain('The local roof recipe could not be supported')
    expect(onLog.mock.calls.at(-2)?.[0]).toMatchObject({ action: 'roof-recipe', placed: 0, rejected: 1 })
    expect(plan.steps).toHaveLength(3)
    expect(getBlockingBuildPlanIssues(validateBuildPlan(plan))).toEqual([])
  })
})

describe('local gable roof trials', () => {
  const makeShell = (sparse = false) => {
    const state = createBuildState()
    const result = applyAgentAction(state, {
      action: 'place',
      items: [
        { kind: 'deck', x: 0, z: 0, size: [10, 8], color: 'green' },
        sparse
          ? { brickId: 'brick-1x1', x: 1, y: 0.8, z: 1, color: 'white' }
          : { kind: 'walls', x: 1, y: 0.8, z: 1, size: [8, 6], courses: 1, color: 'white' },
      ],
    })
    expect(result.ok).toBe(true)
    return state
  }
  const footprint = { kind: 'roof', x: 1, y: 2, z: 1, width: 8, depth: 6 } as const

  it.each(['x', 'z'] as const)('adds a supporting deck for a gable along %s over an interrupted support', ridge => {
    const state = makeShell(true)
    const recipe = { style: 'gable', ridge, color: 'dark-gray', gableColor: 'white' } as const
    expect(tryRoofRecipe(state, { ...footprint, recipe })).toBeUndefined()
    const result = tryRoofRecipe(state, { ...footprint, recipe: { ...recipe, supportDeck: true } })
    expect(result?.ok).toBe(true)
    const roof = state.bricks.filter(brick => result?.placedIds.includes(brick.id))
    expect(roof.some(brick => brick.brickId.startsWith('plate-'))).toBe(true)
    expect(roof.some(brick => brick.brickId.startsWith('slope-'))).toBe(true)
    expect(validateBuildPlanStructural({ id: 'gable', title: 'Gable', prompt: '', source: 'llm', bricks: state.bricks, steps: [] })).toEqual([])
  })

  it('builds directly on sufficient supports and preserves the planned ridge height', () => {
    const state = makeShell()
    const start = state.bricks.length
    const result = tryRoofRecipe(state, {
      ...footprint, recipe: { style: 'gable', ridge: 'x', color: 'dark-gray', supportDeck: true },
    })
    expect(result?.ok).toBe(true)
    const roof = state.bricks.slice(start)
    expect(roof.some(brick => brick.brickId.startsWith('plate-'))).toBe(false)
    expect(Math.min(...roof.map(brick => brick.pose.yStud))).toBe(footprint.y)
  })

  it('leaves the existing parts and IDs untouched if all trials fail', () => {
    const state = makeShell()
    const { bricks, nextId } = state
    const result = tryRoofRecipe(state, {
      ...footprint, y: 5, recipe: { style: 'gable', ridge: 'x', color: 'dark-gray', supportDeck: true },
    })
    expect(result).toBeUndefined()
    expect(state.bricks).toBe(bricks)
    expect(state.nextId).toBe(nextId)
  })
})
