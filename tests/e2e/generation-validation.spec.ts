import { expect, test } from '@playwright/test'

test('an incomplete modular build keeps the current project and resumes from the validated base', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    const endpoint = 'https://mock.invalid/chat'
    localStorage.setItem('brick-flow-agent:llm-config', JSON.stringify({ modelName: 'mock', endpoint, apiKey: 'mock', requestMode: 'direct', autoRepair: false }))
    const layout = {
      title: 'Resumed cabin',
      modules: [
        { name: 'Base', tool: 'parts', description: 'Foundation', origin: [0, 0, 0] },
        { name: 'Cabin walls', tool: 'parts', description: 'Cabin structure', origin: [0, 1.2, 0] },
      ],
    }
    const original = window.fetch
    const requests: string[] = []
    window.fetch = async (input, init) => {
      if (String(input) !== endpoint) return original(input, init)
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages.find((message: { role: string }) => message.role === 'user').content as string
      const module = /Current module: \{"name":"([^"]+)"/.exec(prompt)?.[1]
      requests.push(module ?? 'Layout')
      localStorage.setItem('cabin-requests', JSON.stringify(requests))
      const at = module === 'Cabin walls' && !localStorage.getItem('cabin-ready') ? [10, 8, 0] : [0, 0, 0]
      const response = module ? { commands: [{ brickId: 'brick-1x1', color: 'red', at }] } : layout
      return Response.json({ choices: [{ message: { content: JSON.stringify(response) } }] })
    }
  })
  await page.goto('./')
  const name = page.getByLabel('Current work title', { exact: true })
  const originalName = await name.innerText()
  await expect(page.getByRole('button', { name: 'Preview prompt', exact: true })).toHaveCount(0)
  const generate = page.getByRole('button', { name: 'Generate plan', exact: true })
  await generate.click()
  await expect(page.getByText(/Generation incomplete: module “Cabin walls” failed validation/)).toBeVisible()
  await expect(name).toHaveText(originalName)
  await expect(page.getByText(/Plan generated/)).toHaveCount(0)
  await page.evaluate(() => localStorage.setItem('cabin-ready', 'yes'))
  await generate.click()
  await expect(name).toHaveText('Resumed cabin')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cabin-requests')!))).toEqual(['Layout', 'Base', 'Cabin walls', 'Cabin walls'])
})

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
      if (calls === 0) localStorage.setItem('roof-recipe-first-messages', JSON.stringify(JSON.parse(String(init?.body)).messages))
      const answer = responses[calls++]
      localStorage.setItem('roof-recipe-request-count', String(calls))
      return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] })
    }
  }, fixture)
  await page.goto('./?debug=1')
  await page.getByPlaceholder(/Describe what to build/).fill('树林里面有一栋木屋')
  await page.getByRole('button', { name: 'Preview prompt', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'LLM Prompt' })
  const system = await preview.getByLabel('System message').inputValue()
  const user = await preview.getByLabel('User message (including app instructions)').inputValue()
  expect(user).toContain('Write a build manual')
  expect(user).toContain('User request: 树林里面有一栋木屋')
  const download = page.waitForEvent('download')
  await preview.getByRole('button', { name: /export txt/i }).click()
  const stream = await (await download).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString()).toBe(`# system\n${system}\n\n# user\n${user}`)
  await preview.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText(fixture.title, { timeout: 30_000 })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('roof-recipe-first-messages')!)))
    .toEqual([{ role: 'system', content: system }, { role: 'user', content: user }])
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
