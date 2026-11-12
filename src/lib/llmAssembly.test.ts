import { LlmServiceError } from './llmServiceError'
import { createSingleBrickSteps, validateBuildPlan } from './planUtils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expandAssemblyProgram, generateAssembly, parseAssemblyLayout } from './llmAssembly'
import { generateLlmBuildPlan } from './llmGenerator'

const command = { brickId: 'brick-1x1', color: 'red', at: [0, 0, 0] }
const layout = parseAssemblyLayout({ title: 'Tower', modules: [
  { name: 'Base', description: 'A red support brick', origin: [0, 0, 0] },
  { name: 'Top', description: 'Another brick on top', origin: [0, 1.2, 0] },
] })

afterEach(() => vi.unstubAllGlobals())

describe('procedural LEGO assembly', () => {
  it('compiles coloured voxel courses into bonded editable bricks with exact offsets', () => {
    const bricks = expandAssemblyProgram({ commands: [{ kind: 'voxel-layers', at: [1, 0, 2],
      palette: { B: 'blue', W: 'white' }, layers: [
        { rows: ['BBBB', 'BBBB', 'BBBB', 'BBBB'], repeat: 2 },
        { rows: ['BWWB', 'BBBB', 'BBBB', 'BBBB'] },
      ] }] }, [10, 0, 20])
    expect(bricks.some(brick => brick.color === 'white' && brick.pose.zStud === 22)).toBe(true)
    expect(Math.min(...bricks.map(brick => brick.pose.xStud))).toBe(11)
    expect(Math.max(...bricks.map(brick => brick.pose.yStud))).toBe(2.4)
    expect(validateBuildPlan({ id: 'sculpture', title: '', prompt: '', source: 'llm', bricks, steps: createSingleBrickSteps(bricks) })).toEqual([])
  })

  it('rejects malformed voxel grids and respects part budgets and inventory', () => {
    const recipe = { kind: 'voxel-layers', at: [0, 0, 0], palette: { B: 'blue' }, layers: [{ rows: ['BBBB', 'BBBB'], repeat: 2 }] }
    for (const layers of [[{ rows: ['B', 'BB'] }], [{ rows: ['X'] }], [{ rows: ['B'], repeat: 100 }]]) {
      expect(() => expandAssemblyProgram({ commands: [{ ...recipe, layers }] }, [0, 0, 0])).toThrow()
    }
    expect(() => expandAssemblyProgram({ commands: [recipe] }, [0, 0, 0], { 'brick-1x4': 0 })).toThrow('Inventory exceeded')
    const rows = Array.from({ length: 32 }, () => 'B'.repeat(32))
    expect(() => expandAssemblyProgram({ commands: [{ ...recipe, layers: [{ rows, repeat: 16 }] }] }, [0, 0, 0])).toThrow('budget')
  })

  it('staggers long runs so brick seams do not split the sculpture into separate columns', () => {
    const rows = Array.from({ length: 5 }, () => 'B'.repeat(8))
    const bricks = expandAssemblyProgram({ commands: [{ kind: 'voxel-layers', at: [0, 0, 0], palette: { B: 'blue' }, layers: [{ rows, repeat: 4 }] }] }, [0, 0, 0])
    expect(validateBuildPlan({ id: 'bonded', title: '', prompt: '', source: 'llm', bricks, steps: createSingleBrickSteps(bricks) })).toEqual([])
    expect(() => expandAssemblyProgram({ commands: [{ kind: 'voxel-layers', at: [0, 0, 0], palette: {}, layers: [{ rows: ['...'] }] }] }, [0, 0, 0])).toThrow('occupied')
  })

  it('expands more than 64 parts without truncation and preserves offsets', () => {
    const bricks = expandAssemblyProgram({ commands: [{ ...command, repeat: { count: [10, 1, 10], step: [1, 0, 1] } }] }, [20, 0, 30])
    expect(bricks).toHaveLength(100)
    expect(new Set(bricks.map(b => b.id)).size).toBe(100)
    expect(bricks[99].pose).toMatchObject({ xStud: 29, yStud: 0, zStud: 39 })
  })

  it('rejects invalid repetitions, unsupported colours and excessive expansion', () => {
    for (const repeat of [
      { count: [2, 1, 1], step: [0, 0, 0] },
      { count: [1.5, 1, 1], step: [1, 0, 0] },
      { count: [20, 20, 20], step: [1, 1, 1] },
    ]) expect(() => expandAssemblyProgram({ commands: [{ ...command, repeat }] }, [0, 0, 0])).toThrow()
    expect(() => expandAssemblyProgram({ commands: [{ ...command, color: 'invented' }] }, [0, 0, 0])).toThrow()
  })

  it('rejects off-grid coordinates instead of silently moving the design', () => {
    expect(() => expandAssemblyProgram({ commands: [{ ...command, at: [0.03, 0, 0] }] }, [0, 0, 0])).toThrow('0.1-stud grid')
  })

  it('rejects disconnected modules even when they rest on the ground', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ commands: [command] })
      .mockResolvedValueOnce({ commands: [{ ...command, at: [10, -1.2, 0] }] })
    await expect(generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 0, 'en-US')).rejects.toThrow('Top:')
  })

  it('accounts for inventory already used in accepted modules', () => {
    const accepted = expandAssemblyProgram({ commands: [command] }, [0, 0, 0])
    expect(() => expandAssemblyProgram({ commands: [command] }, [0, 1.2, 0], { 'brick-1x1': 1 }, accepted)).toThrow('Inventory exceeded')
  })

  it('repairs only the failed module while preserving accepted geometry', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ commands: [command] })
      .mockResolvedValueOnce({ commands: [{ ...command, at: [0, 4, 0] }] })
      .mockResolvedValueOnce({ commands: [command] })
    const plan = await generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 1, 'en-US')
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls[2][0]).toContain('Fix these issues')
    expect(plan.bricks.map(b => b.pose.yStud)).toEqual([0, 1.2])
    expect(plan.structures?.map(s => s.name)).toEqual(['Base', 'Top'])
    expect(plan.steps.flatMap(s => s.brickIds)).toEqual(plan.bricks.map(b => b.id))
  })

  it('keeps required feature colours when repairing a module', async () => {
    const featureLayout = parseAssemblyLayout({ title: 'Eye', modules: [{ name: 'Eye', tool: 'parts', description: 'Black pupil', requiredColors: ['black'], origin: [0, 0, 0] }] })
    const request = vi.fn().mockResolvedValueOnce({ commands: [command] })
      .mockResolvedValueOnce({ commands: [{ ...command, color: 'black' }] })
    const plan = await generateAssembly(featureLayout, { prompt: 'Eye' }, request, undefined, undefined, 1, 'en-US')
    expect(request.mock.calls[1][0]).toContain('Missing required visible colours: black')
    expect(plan.bricks[0].color).toBe('black')
  })

  it('stops before requesting another module after cancellation', async () => {
    const controller = new AbortController()
    const request = vi.fn(async () => { controller.abort(); return { commands: [command] } })
    await expect(generateAssembly(layout, { prompt: 'tower' }, request, controller.signal, undefined, 2, 'en-US')).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('uses the normal generation entry point for layout and module requests', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(layout))
      .mockResolvedValueOnce(response({ commands: [command] }))
      .mockResolvedValueOnce(response({ commands: [command] }))
    vi.stubGlobal('fetch', fetchMock)
    const plan = await generateLlmBuildPlan({ prompt: 'tower', inventoryOverrides: { 'brick-2x4': 0 }, config: {
      modelName: 'test-model', endpoint: 'https://example.test/chat', apiKey: 'test-key',
      requestMode: 'direct', enableThinking: false, autoRepair: true,
    } })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const modulePrompt = JSON.parse(String(fetchMock.mock.calls[1][1].body)).messages[1].content
    expect(modulePrompt).toMatch(/brick-2x4:[^\n]*inventory 0/)
    expect(plan.bricks).toHaveLength(2)
    expect(plan.structures).toHaveLength(2)
  })

  it('requests sculpture grids with only their plate catalogue and the thinking output budget', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }))
    const sculpture = { title: 'Sculpture', modules: [{ name: 'Sculpture', tool: 'sculpture', requiredColors: ['blue'], description: 'Blue block', origin: [0, 0, 0] }] }
    const fetchMock = vi.fn().mockResolvedValueOnce(response(sculpture)).mockResolvedValueOnce(response({ commands: [{ kind: 'voxel-layers', at: [0, 0, 0], palette: { B: 'blue' }, layers: [{ rows: ['BBBB', 'BBBB', 'BBBB', 'BBBB'], repeat: 2 }] }] }))
    vi.stubGlobal('fetch', fetchMock)
    const plan = await generateLlmBuildPlan({ prompt: 'sculpture', config: {
      modelName: 'test-model', endpoint: 'https://example.test/chat', apiKey: 'test-key',
      requestMode: 'direct', enableThinking: true, autoRepair: true,
    } })
    const payload = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    expect(payload.max_tokens).toBe(24_576)
    expect(payload.messages[1].content).toContain('plate-1x4:')
    expect(payload.messages[1].content).not.toContain('brick-1x4:')
    expect(payload.messages[1].content.length).toBeLessThan(8_000)
    expect(plan.bricks).toHaveLength(8)
  })
})

describe('architectural tools and resume', () => {
  it.each([8, 16])('builds a supported connected hall of width %i', width => {
    const bricks = expandAssemblyProgram({ commands: [{ kind: 'building', at: [0, 0, 0], width, wallCourses: 8, wallColor: 'tan', roofColor: 'gray', windowColor: 'black', trimColor: 'white', baseColor: 'gray' }] }, [0, 0, 0])
    expect(bricks.length).toBeGreaterThan(200)
    expect(validateBuildPlan({ id: 'hall', title: 'hall', prompt: '', source: 'llm', bricks, steps: createSingleBrickSteps(bricks) })).toEqual([])
  })

  it('replays accepted modules without another model request', async () => {
    const request = vi.fn().mockResolvedValue({ commands: [command] })
    const save = vi.fn()
    const plan = await generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 0, 'en-US', { programs: [{ commands: [command] }], save })
    expect(plan.bricks).toHaveLength(2)
    expect(request).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenLastCalledWith([{ commands: [command] }, { commands: [command] }])
  })

  it('regenerates an invalid cached program even with automatic repair disabled', async () => {
    const request = vi.fn().mockResolvedValue({ commands: [command] })
    const plan = await generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 0, 'en-US', { programs: [{ commands: [] }], save: () => undefined })
    expect(plan.bricks).toHaveLength(2)
    expect(request).toHaveBeenCalledTimes(2)
  })
})

it('publishes stable accepted snapshots and compiles inline tool programs without another request', async () => {
  const program = { commands: [{ kind: 'building', at: [0, 0, 0], width: 16, wallCourses: 8, wallColor: 'tan', roofColor: 'gray', windowColor: 'black', trimColor: 'white', baseColor: 'gray' }] }
  const inline = parseAssemblyLayout({ title: 'Hall', modules: [{ name: 'Hall', description: 'build', origin: [0, 0, 0], tool: 'building', program }] })
  const request = vi.fn()
  const progress = vi.fn()
  const plan = await generateAssembly(inline, { prompt: 'hall' }, request, undefined, undefined, 0, 'en-US', { programs: [], save: () => undefined, onProgress: progress })
  expect(request).not.toHaveBeenCalled()
  expect(progress).toHaveBeenCalledTimes(1)
  expect(progress.mock.calls[0][0].bricks).toEqual(plan.bricks)
  expect(progress.mock.calls[0][0].bricks).not.toBe(plan.bricks)
})

it('does not spend geometry-repair attempts on provider quota errors', async () => {
  const request = vi.fn().mockRejectedValue(new LlmServiceError('quota', 429))
  await expect(generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 4, 'en-US')).rejects.toMatchObject({ status: 429 })
  expect(request).toHaveBeenCalledTimes(1)
})
