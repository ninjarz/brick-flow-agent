import { LlmServiceError } from './llmServiceError'
import { createSingleBrickSteps, validateBuildPlan } from './planUtils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildingRoleParts, expandAssemblyProgram, generateAssembly, getAssemblyModuleColors, getBuildingRoleColors, parseAssemblyLayout } from './llmAssembly'
import { canonicalColorId, resolveColorId, resolvePartColor } from './colorIds'
import { brickDefinitions } from '../data/basicBricks'
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

describe('assembly resilience', () => {
  it('maps loosely spelled colour ids and drops colours no part can use', () => {
    expect(resolveColorId('dark_gray')).toBe('dark-gray')
    expect(resolveColorId('Dark Grey')).toBe('dark-gray')
    expect(resolveColorId('transparent yellow')).toBe('trans-yellow')
    expect(resolveColorId('invented')).toBeUndefined()
    const parsed = parseAssemblyLayout({ title: 'Cabin', modules: [{
      name: 'Porch', tool: 'parts', description: 'porch', origin: [0, 0, 0],
      requiredColors: ['RED', 'red', 'invented-colour', 'dark_gray'],
    }] })
    const expected = ['red', ...(getAssemblyModuleColors('parts').has('dark-gray') ? ['dark-gray'] : [])]
    expect(parsed.modules[0].requiredColors).toEqual(expected)
  })

  it('accepts loosely spelled colours in module programs', () => {
    const bricks = expandAssemblyProgram({ commands: [{ ...command, color: 'RED' }] }, [0, 0, 0])
    expect(bricks[0].color).toBe('red')
  })

  it('skips a later module that exhausts its repairs and keeps the accepted ones', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ commands: [command] })
      .mockResolvedValueOnce({ commands: [{ ...command, at: [10, 4, 0] }] })
    const onIssue = vi.fn()
    const save = vi.fn()
    const plan = await generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 0, 'en-US', {
      programs: [], save, onIssue, skipFailedModules: true,
    })
    expect(plan.structures?.map(structure => structure.name)).toEqual(['Base'])
    expect(plan.bricks).toHaveLength(1)
    expect(onIssue).toHaveBeenCalledWith(expect.objectContaining({ kind: 'skipped-module', module: 'Top' }))
    expect(save).toHaveBeenLastCalledWith([{ commands: [command] }, null])
  })

  it('still fails when the first module cannot be built', async () => {
    const request = vi.fn().mockResolvedValue({ commands: [{ ...command, at: [0, 4, 0] }] })
    await expect(generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 0, 'en-US', {
      programs: [], save: () => undefined, skipFailedModules: true,
    })).rejects.toThrow('Base:')
  })

  it('keeps a valid module without its required colours once repairs run out', async () => {
    const featureLayout = parseAssemblyLayout({ title: 'Eye', modules: [{ name: 'Eye', tool: 'parts', description: 'Black pupil', requiredColors: ['black'], origin: [0, 0, 0] }] })
    const request = vi.fn().mockResolvedValue({ commands: [command] })
    const onIssue = vi.fn()
    const plan = await generateAssembly(featureLayout, { prompt: 'Eye' }, request, undefined, undefined, 0, 'en-US', { programs: [], save: () => undefined, onIssue })
    expect(plan.bricks).toHaveLength(1)
    expect(onIssue).toHaveBeenCalledWith({ kind: 'missing-colors', module: 'Eye', detail: 'black' })
  })

  it('reports module progress for every attempt', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ commands: [command] })
      .mockResolvedValueOnce({ commands: [{ ...command, at: [0, 4, 0] }] })
      .mockResolvedValueOnce({ commands: [command] })
    const onModule = vi.fn()
    await generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 1, 'en-US', { programs: [], save: () => undefined, onModule })
    expect(onModule.mock.calls.map(([progress]) => [progress.index, progress.attempt])).toEqual([[0, 0], [1, 0], [1, 1]])
    expect(onModule.mock.calls[0][0]).toMatchObject({ total: 2, name: 'Base', retries: 1 })
  })
})

describe('readable colour ids and compact prompts', () => {
  // A generation part that carries reddish brown only as its LDraw code.
  const coded = brickDefinitions.find(definition => definition.pack === 'lego' && !definition.id.startsWith('hogwarts-')
    && !definition.id.startsWith('architecture-') && definition.colors.includes('lego-70') && !definition.colors.includes('reddish-brown'))

  it('resolves readable ids to the code a part carries', () => {
    expect(canonicalColorId('lego-70')).toBe('reddish-brown')
    expect(canonicalColorId('lego-72')).toBe('dark-gray')
    expect(resolveColorId('Dark Bluish Gray')).toBe('lego-72')
    expect(coded).toBeDefined()
    expect(resolvePartColor(coded!.colors, 'reddish_brown')).toBe('lego-70')
    expect(resolvePartColor(['red'], 'dark-gray')).toBeUndefined()
  })

  it('builds with a readable colour on a part that only has its code and satisfies the required colour', async () => {
    const featureLayout = parseAssemblyLayout({ title: 'Cabin', modules: [{ name: 'Wall', tool: 'parts', description: 'Wood wall', requiredColors: ['reddish_brown'], origin: [0, 0, 0] }] })
    expect(featureLayout.modules[0].requiredColors).toEqual(['reddish-brown'])
    const request = vi.fn().mockResolvedValue({ commands: [{ brickId: coded!.id, color: 'reddish-brown', at: [0, 0, 0] }] })
    const onIssue = vi.fn()
    const plan = await generateAssembly(featureLayout, { prompt: 'cabin' }, request, undefined, undefined, 0, 'en-US', { programs: [], save: () => undefined, onIssue })
    expect(plan.bricks[0].color).toBe('lego-70')
    expect(onIssue).not.toHaveBeenCalled()
  })

  it('describes large accepted modules by their extent instead of resending programs', async () => {
    const padded = { commands: [{ ...command, note: 'x'.repeat(5_000) }] }
    const request = vi.fn().mockResolvedValueOnce(padded).mockResolvedValueOnce({ commands: [command] })
    await generateAssembly(layout, { prompt: 'tower' }, request, undefined, undefined, 0, 'en-US')
    const secondPrompt = String(request.mock.calls[1][0])
    expect(secondPrompt).toContain('world-coordinate extents')
    expect(secondPrompt).toContain('"worldMin":[0,0,0],"worldMax":[1,1.2,1]')
    expect(secondPrompt).not.toContain('x'.repeat(100))
  })

  it('sends a compact parts catalogue to module requests', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout })
    const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(layout))
      .mockResolvedValueOnce(response({ commands: [command] }))
      .mockResolvedValueOnce(response({ commands: [command] }))
    vi.stubGlobal('fetch', fetchMock)
    await generateLlmBuildPlan({ prompt: 'compact tower', config: {
      modelName: 'test-model', endpoint: 'https://example.test/chat', apiKey: 'test-key',
      requestMode: 'direct', enableThinking: false, autoRepair: true,
    } })
    const modulePrompt = JSON.parse(String(fetchMock.mock.calls[1][1].body)).messages[1].content as string
    expect(modulePrompt).toContain('Colour palette *')
    expect(modulePrompt).toContain('reddish-brown')
    expect(modulePrompt).not.toContain('inventory unlimited')
    expect(modulePrompt).not.toMatch(/-nameplate:/)
    expect(modulePrompt.length).toBeLessThan(20_000)
  })
})

describe('pipelined module requests', () => {
  const base = { brickId: 'brick-2x4', color: 'red', at: [0, 0, 0] }
  const cap = { brickId: 'brick-1x1', color: 'red', at: [0, 0, 0] }
  const branchLayout = (dependsOn?: string[]) => parseAssemblyLayout({ title: 'Branches', modules: [
    { name: 'Base', description: 'foundation', origin: [0, 0, 0] },
    { name: 'Left', description: 'left cap', origin: [0, 1.2, 0], ...(dependsOn ? { dependsOn } : {}) },
    { name: 'Right', description: 'right cap', origin: [3, 1.2, 1], ...(dependsOn ? { dependsOn } : {}) },
  ] })
  const moduleOf = (prompt: string) => /Current module: \{"name":"(\w+)"/.exec(prompt)?.[1]
  const deferred = () => {
    let resolve!: (value: unknown) => void
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
  }

  it('keeps only earlier, known module names as dependencies', () => {
    const parsed = parseAssemblyLayout({ title: 'x', modules: [
      { name: 'A', description: '', origin: [0, 0, 0], dependsOn: ['B'] },
      { name: 'B', description: '', origin: [0, 0, 0], dependsOn: ['A', 'B', 'missing', 'A'] },
    ] })
    expect(parsed.modules.map(module => module.dependsOn)).toEqual([[], ['A']])
    expect(() => parseAssemblyLayout({ title: 'x', modules: [{ name: 'A', description: '', origin: [0, 0, 0], dependsOn: 'Base' }] })).toThrow('dependsOn')
  })

  it('requests independent modules while an earlier one is still pending', async () => {
    const left = deferred()
    const request = vi.fn<Parameters<typeof generateAssembly>[2]>((prompt) => {
      const name = moduleOf(prompt)
      if (name === 'Base') return Promise.resolve({ commands: [base] })
      if (name === 'Left') return left.promise
      return Promise.resolve({ commands: [cap] })
    })
    const done = generateAssembly(branchLayout(['Base']), { prompt: 'branches' }, request, undefined, undefined, 0, 'en-US', { programs: [], save: () => undefined })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
    expect(request.mock.calls.map(([prompt]) => moduleOf(prompt))).toEqual(['Base', 'Right', 'Left'])
    expect(request.mock.calls[1][3]).toMatchObject({ background: true })
    left.resolve({ commands: [cap] })
    const plan = await done
    expect(plan.structures?.map(structure => structure.name)).toEqual(['Base', 'Left', 'Right'])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('stays sequential when modules do not declare dependencies', async () => {
    const left = deferred()
    const request = vi.fn((prompt: string) => moduleOf(prompt) === 'Left' ? left.promise : Promise.resolve({ commands: [moduleOf(prompt) === 'Base' ? base : cap] }))
    const done = generateAssembly(branchLayout(), { prompt: 'branches' }, request, undefined, undefined, 0, 'en-US')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(request).toHaveBeenCalledTimes(2)
    left.resolve({ commands: [cap] })
    await done
    expect(request.mock.calls.map(([prompt]) => moduleOf(prompt))).toEqual(['Base', 'Left', 'Right'])
  })

  it('repairs an early module that collides with one accepted after its request began', async () => {
    const overlapping = parseAssemblyLayout({ title: 'Overlap', modules: [
      { name: 'Base', description: 'foundation', origin: [0, 0, 0] },
      { name: 'Left', description: 'left cap', origin: [0, 1.2, 0], dependsOn: ['Base'] },
      { name: 'Right', description: 'right cap', origin: [0, 1.2, 0], dependsOn: ['Base'] },
    ] })
    const request = vi.fn<Parameters<typeof generateAssembly>[2]>((prompt) => {
      const name = moduleOf(prompt)
      if (name === 'Base') return Promise.resolve({ commands: [base] })
      if (name === 'Right' && prompt.includes('Fix these issues')) return Promise.resolve({ commands: [{ ...cap, at: [3, 0, 1] }] })
      return Promise.resolve({ commands: [cap] })
    })
    const plan = await generateAssembly(overlapping, { prompt: 'overlap' }, request, undefined, undefined, 1, 'en-US', { programs: [], save: () => undefined })
    const repair = request.mock.calls.find(([prompt]) => moduleOf(prompt) === 'Right' && prompt.includes('Fix these issues'))
    expect(repair?.[3]).toBeUndefined()
    expect(plan.bricks.map(brick => [brick.pose.xStud, brick.pose.zStud])).toEqual([[0, 0], [0, 0], [3, 1]])
  })

  it('cancels requests started ahead when generation fails', async () => {
    let backgroundSignal: AbortSignal | undefined
    const request = vi.fn((prompt: string, _tool?: unknown, _draft?: unknown, options?: { signal?: AbortSignal }) => {
      const name = moduleOf(prompt)
      if (name === 'Base') return Promise.resolve({ commands: [base] })
      if (name === 'Right') { backgroundSignal = options?.signal; return new Promise(() => undefined) }
      return Promise.resolve({ commands: [{ ...cap, at: [0, 6, 0] }] })
    })
    await expect(generateAssembly(branchLayout(['Base']), { prompt: 'branches' }, request, undefined, undefined, 0, 'en-US')).rejects.toThrow('Left:')
    expect(backgroundSignal?.aborted).toBe(true)
  })
})

describe('structural primitives', () => {
  const planOf = (bricks: ReturnType<typeof expandAssemblyProgram>) => ({ id: 'primitives', title: 'primitives', prompt: '', source: 'llm' as const, bricks, steps: createSingleBrickSteps(bricks) })
  const house = (width: number, depth: number, courses: number, openings: unknown[] = []) => {
    const ceiling = 0.8 + courses * 1.2
    return { commands: [
      { kind: 'deck', at: [0, 0, 0], size: [width + 2, depth + 2], color: 'gray' },
      { kind: 'walls', at: [1, 0.8, 1], size: [width, depth], courses, color: 'brown', openings },
      { kind: 'deck', at: [1, ceiling, 1], size: [width, depth], color: 'tan' },
      { kind: 'stepped-roof', at: [1, ceiling + 0.8, 1], size: [width, depth], tiers: Math.min(4, Math.floor(depth / 2)), style: 'gable', color: 'dark-gray' },
    ] }
  }

  it.each([[3, 3, 1], [5, 4, 2], [8, 6, 3], [11, 7, 5], [14, 10, 6], [16, 4, 8]])(
    'composes a supported building %ix%i with %i courses', (width, depth, courses) => {
      const bricks = expandAssemblyProgram(house(width, depth, courses, [
        { side: 'front', offset: Math.floor(width / 2) - 1, width: 2, bottom: 0, height: Math.min(2, courses), color: 'black' },
        { side: 'left', offset: 1, width: 1, bottom: 0, height: 1, color: 'trans-clear' },
      ].filter(opening => opening.offset >= 0 && opening.offset + opening.width <= (opening.side === 'front' ? width : depth))), [0, 0, 0])
      expect(validateBuildPlan(planOf(bricks))).toEqual([])
    })

  it('builds rigid decks of any rectangle', () => {
    for (const size of [[1, 1], [1, 5], [3, 2], [7, 5], [13, 9]]) {
      const bricks = expandAssemblyProgram({ commands: [{ kind: 'deck', at: [0, 0, 0], size, color: 'gray' }] }, [0, 0, 0])
      expect(validateBuildPlan(planOf(bricks)), String(size)).toEqual([])
      expect(Math.max(...bricks.map(brick => brick.pose.yStud))).toBe(0.4)
    }
  })

  it('places straight walls along either axis with staggered seams', () => {
    for (const axis of ['x', 'z']) {
      const bricks = expandAssemblyProgram({ commands: [
        { kind: 'deck', at: [0, 0, 0], size: [9, 9], color: 'gray' },
        { kind: 'wall', at: [0, 0.8, 0], length: 9, courses: 4, axis, color: 'gray', openings: [{ offset: 3, width: 2, bottom: 1, height: 2, color: 'trans-clear' }] },
      ] }, [0, 0, 0])
      expect(validateBuildPlan(planOf(bricks)), axis).toEqual([])
      expect(bricks.filter(brick => brick.color === 'trans-clear')).toHaveLength(2)
    }
  })

  it('colours openings as inlays on the requested side and course', () => {
    const bricks = expandAssemblyProgram({ commands: [{ kind: 'walls', at: [0, 0, 0], size: [6, 4], courses: 3, color: 'brown', openings: [
      { side: 'back', offset: 2, width: 2, bottom: 1, height: 1, color: 'trans-clear' },
    ] }] }, [0, 0, 0])
    const glass = bricks.filter(brick => brick.color === 'trans-clear')
    expect(glass.map(brick => [brick.pose.xStud, brick.pose.yStud, brick.pose.zStud])).toEqual([[2, 1.2, 3]])
  })

  it('rejects invalid sizes and openings with a specific reason', () => {
    const walls = { kind: 'walls', at: [0, 0, 0], size: [6, 4], courses: 3, color: 'brown' }
    expect(() => expandAssemblyProgram({ commands: [{ ...walls, size: [2, 4] }] }, [0, 0, 0])).toThrow('Walls width')
    expect(() => expandAssemblyProgram({ commands: [{ ...walls, openings: [{ side: 'top', offset: 0, width: 1, color: 'black' }] }] }, [0, 0, 0])).toThrow('side must be one of')
    expect(() => expandAssemblyProgram({ commands: [{ ...walls, openings: [{ side: 'left', offset: 3, width: 2, color: 'black' }] }] }, [0, 0, 0])).toThrow('offset')
    expect(() => expandAssemblyProgram({ commands: [{ ...walls, openings: [{ side: 'front', offset: 0, width: 1, height: 4, color: 'black' }] }] }, [0, 0, 0])).toThrow('height')
    expect(() => expandAssemblyProgram({ commands: [{ ...walls, color: 'invented' }] }, [0, 0, 0])).toThrow('does not support colour invented')
    expect(() => expandAssemblyProgram({ commands: [{ kind: 'wall', at: [0, 0, 0], length: 4, courses: 1, axis: 'y', color: 'gray' }] }, [0, 0, 0])).toThrow('axis')
  })

  it('validates hall colours against the parts each role uses', () => {
    const hall = { kind: 'building', at: [0, 0, 0], width: 8, wallCourses: 6, wallColor: 'tan', roofColor: 'gray', windowColor: 'black', trimColor: 'white', baseColor: 'gray' }
    expect(() => expandAssemblyProgram({ commands: [{ ...hall, wallColor: 'invented' }] }, [0, 0, 0])).toThrow(/Building wall colour invented .*Choose one of:/)
    expect(getBuildingRoleColors(buildingRoleParts.roof)).toContain('dark-gray')
  })
})
