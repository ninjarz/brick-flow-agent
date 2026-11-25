import { expect, test } from '@playwright/test'

test('step-by-step generation publishes the locally built roof and includes it in the saved plan', async ({ page }) => {
  const fixture = {
    title: 'Roof recipe house',
    subject: 'building',
    foundation: 'deck',
    size: [6, 6, 6],
    components: [
      { name: 'Base', goal: 'Build the deck' },
      { name: 'Walls', goal: 'Enclose the house', completion: { kind: 'walls', x: 1, y: 0.8, z: 1, width: 4, depth: 4, courses: 1 } },
      { name: 'Roof', goal: 'Build the gable', completion: { kind: 'roof', x: 1, y: 2, z: 1, width: 4, depth: 4, recipe: { style: 'gable', ridge: 'x', color: 'dark-gray' } } },
    ],
  }
  await page.addInitScript(fixture => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    const endpoint = 'https://mock.invalid/chat'
    localStorage.setItem('brick-flow-agent:llm-config', JSON.stringify({ modelName: 'mock', endpoint, apiKey: 'mock', requestMode: 'direct', buildMode: 'agentic' }))
    const place = (item: object) => ({ action: 'place', items: [item], done: true })
    const responses = [
      fixture,
      place({ kind: 'deck', x: 0, z: 0, size: [6, 6], color: 'green' }),
      place({ kind: 'walls', x: 1, y: 0.8, z: 1, size: [4, 4], courses: 1, color: 'white' }),
      place({ brickId: 'brick-1x1', x: 0, y: 0.8, z: 0, color: 'red' }),
      { action: 'done' },
    ]
    const original = window.fetch
    let calls = 0
    window.fetch = async (input, init) => {
      if (String(input) !== endpoint) return original(input, init)
      const answer = responses[calls++]
      localStorage.setItem('roof-recipe-request-count', String(calls))
      return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] })
    }
  }, fixture)
  await page.goto('./')
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await expect(page.getByLabel('Plan name')).toHaveValue(fixture.title, { timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1') ?? '{}')
    const roof = draft.plan?.structures?.find((structure: { name: string }) => structure.name === 'Roof')
    return {
      calls: localStorage.getItem('roof-recipe-request-count'),
      slope: draft.plan?.bricks.some((part: { id: string; brickId: string }) =>
        roof?.brickIds.includes(part.id) && part.brickId.startsWith('slope-')),
    }
  })).toEqual({ calls: '5', slope: true })
})

test('large generation validation matches synchronous validation and can be cancelled in flight', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.goto('./')
  const base = new URL('src/lib/', testInfo.project.use.baseURL).pathname
  const report = await page.evaluate(async base => {
    const { getEditorGenerationValidation } = await import(base + 'editorAnalysisClient.ts') as typeof import('../../src/lib/editorAnalysisClient')
    const { finalizeGeneratedPlan } = await import(base + 'generatedPlanValidation.ts') as typeof import('../../src/lib/generatedPlanValidation')
    const { createSingleBrickSteps, makeBrick } = await import(base + 'planUtils.ts') as typeof import('../../src/lib/planUtils')
    const { preparePlanGeometry } = await import(base + 'planGeometry.ts') as typeof import('../../src/lib/planGeometry')
    const bricks = Array.from({ length: 1024 }, (_, index) =>
      makeBrick('brick-1x1', 'gray', index % 16, Math.floor(index / 256) * 1.2, Math.floor(index / 16) % 16))
    const plan = { id: 'generation-fixture', title: 'Generation fixture', prompt: '', source: 'llm' as const, bricks, steps: createSingleBrickSteps(bricks) }
    await preparePlanGeometry(plan)
    const controller = new AbortController()
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) {
      Reflect.apply(original, this, args)
      if (args[0]?.finalizeGeneration) queueMicrotask(() => controller.abort())
    }
    let cancelled = false
    try {
      await getEditorGenerationValidation(plan, controller.signal)
    } catch (error) {
      cancelled = error instanceof DOMException && error.name === 'AbortError'
    } finally {
      Worker.prototype.postMessage = original
    }

    const workerStartedAt = performance.now()
    const job = getEditorGenerationValidation(plan, new AbortController().signal)
    let settled = false
    void job.then(() => { settled = true }, () => { settled = true })
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const frameBeforeWorkerFinished = !settled
    const background = await job
    const workerMs = performance.now() - workerStartedAt
    const syncStartedAt = performance.now()
    const synchronous = finalizeGeneratedPlan(plan)
    return {
      cancelled, frameBeforeWorkerFinished, workerMs, syncMs: performance.now() - syncStartedAt,
      valid: background.plan === plan && synchronous.plan === plan,
      sameIssues: JSON.stringify(background.issues) === JSON.stringify(synchronous.issues),
    }
  }, base)
  expect(report).toMatchObject({ cancelled: true, frameBeforeWorkerFinished: true, valid: true, sameIssues: true })
  await testInfo.attach('validation-timings', { body: JSON.stringify(report), contentType: 'application/json' })
  console.log(JSON.stringify(report))
})
