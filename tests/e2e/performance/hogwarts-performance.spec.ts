import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import type { Camera } from 'three'

type Point = { x: number; y: number }
declare global {
  interface Window {
    selectionProfileCamera: Camera
    selectionProfileFrames: number[]
  }
}

test('Hogwarts editor performance baseline', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const cpuRate = Number(process.env.BRICK_CPU_RATE ?? 1)
  const profile = process.env.BRICK_PROFILE_SELECTION === '1'
  const profileLoading = process.env.BRICK_PROFILE_LOADING === '1'
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  if (profile || profileLoading) await cdp.send('Profiler.enable')
  const timings: Record<string, number> = { cpuRate }
  const env = await page.request.get('./@vite/env')
  expect(env.ok()).toBe(true)
  const physicsRevision = (await env.text()).match(/__CONSTRUCTION_PHYSICS_REVISION__"?:\s*"([a-f\d]{64})"/)?.[1]
  const cache = JSON.parse(await readFile('src/data/hogwartsConstructionValidation.json', 'utf8')) as { physicsRevision: string }
  expect(physicsRevision).toBe(cache.physicsRevision)
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.route(/\/src\/components\/BrickScene\.tsx(?:\?.*)?$/, async route => {
    const response = await route.fetch()
    const source = await response.text()
    const marker = '    camera.updateProjectionMatrix();'
    if (!source.includes(marker)) throw new Error('Could not find the editor camera in the dev module')
    // Expose the dev camera only in the benchmark so clicks hit actual parts.
    await route.fulfill({ response, body: source.replace(marker, marker + ' window.selectionProfileCamera = camera;') })
  })

  await page.goto('./')
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('Clear Canvas').click()
  await expect(page.getByText('0 parts', { exact: true })).toBeVisible()
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await page.getByLabel('Work & Library', { exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Work & Library' })
  await library.getByRole('button', { name: 'Models', exact: true }).click()
  const load = library.getByRole('article').filter({ has: page.getByRole('heading', { name: /LEGO 71043/ }) })
    .getByRole('button', { name: 'Load', exact: true })
  if (profileLoading) await cdp.send('Profiler.start')
  const start = performance.now()
  await load.click()
  await expect(page.getByText('6025 parts', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.viewer [data-geometry-ready="true"]')).toBeVisible({ timeout: 60_000 })
  timings.loadAndGeometryMs = Math.round(performance.now() - start)
  if (profileLoading) {
    const { profile: loadingProfile } = await cdp.send('Profiler.stop')
    await writeFile(testInfo.outputPath('hogwarts-loading.cpuprofile'), JSON.stringify(loadingProfile))
  }
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const base = new URL('src/lib/', testInfo.project.use.baseURL).pathname
  const targets = await page.evaluate(async base => {
    const { projectStore } = await import(base + 'projectStore.ts') as typeof import('../src/lib/projectStore')
    const { getBrickBounds } = await import(base + 'planUtils.ts') as typeof import('../src/lib/planUtils')
    const [entry] = await projectStore.list()
    const project = await projectStore.read(entry.id)
    const plan = project?.snapshot.plan
    const annex = plan?.structures?.find(structure => structure.name === '礼堂与主塔')
    const camera = window.selectionProfileCamera
    const canvas = document.querySelector('.viewer canvas')!.getBoundingClientRect()
    if (!annex || !plan || !camera) throw new Error('Hogwarts annex or editor camera unavailable')
    camera.updateMatrixWorld(true)
    const members = new Set(annex.brickIds)
    return plan.bricks.filter(brick => members.has(brick.id)).slice(0, 150).flatMap(brick => {
      const bounds = getBrickBounds(brick)
      if (!bounds) return []
      const { minX, maxX, maxY, minZ, maxZ } = bounds
      const screen = camera.position.clone().set((minX + maxX) / 2, maxY - .01, (minZ + maxZ) / 2).project(camera)
      const x = canvas.left + canvas.width * (screen.x + 1) / 2
      const y = canvas.top + canvas.height * (1 - screen.y) / 2
      return x > canvas.left + 25 && x < canvas.right - 25 && y > canvas.top + 25 && y < canvas.bottom - 25 ? [{ x, y }] : []
    })
  }, base)
  let annex: Point | undefined
  const solid = page.getByText('3130 selected parts', { exact: true })
  const connected = page.getByText('5773 selected parts', { exact: true })
  for (const point of targets) {
    await page.mouse.click(point.x, point.y)
    const picked = await solid.waitFor({ state: 'visible', timeout: 450 }).then(() => true, () => false)
    if (picked) { annex = point; break }
  }
  if (!annex) throw new Error('Could not pick the Great Hall')

  const cameraBefore = await page.evaluate(() => {
    const frames = window.selectionProfileFrames = [] as number[]
    const deadline = performance.now() + 7000
    let previous = performance.now()
    const sample = (now: number) => {
      frames.push(now - previous)
      previous = now
      if (now < deadline) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    return window.selectionProfileCamera.position.toArray()
  })
  const first = performance.now()
  if (profile) await cdp.send('Profiler.start')
  await page.mouse.dblclick(annex.x, annex.y)
  const selectionReady = expect(connected).toBeVisible({ timeout: 30_000 })
    .then(() => { timings.firstSelectionMs = Math.round(performance.now() - first) })
  const zoom = performance.now()
  const cameraMoved = page.mouse.wheel(0, -40).then(async () => {
    await page.waitForFunction(position => window.selectionProfileCamera.position.toArray()
      .some((value, index) => Math.abs(value - position[index]) > 0.001), cameraBefore, { timeout: 8000 })
    timings.cameraZoomResponseMs = Math.round(performance.now() - zoom)
  })
  await Promise.all([selectionReady, cameraMoved])
  const frames = await page.evaluate(() => window.selectionProfileFrames.slice(1).sort((a, b) => a - b))
  if (frames.length) {
    timings.firstSelectionFrameGapP95Ms = Math.round(frames[Math.floor((frames.length - 1) * .95)])
    timings.firstSelectionMaxFrameGapMs = Math.round(frames[frames.length - 1])
  }

  await page.mouse.wheel(0, 40)
  await page.waitForFunction(position => window.selectionProfileCamera.position.toArray()
    .every((value, index) => Math.abs(value - position[index]) < 0.01), cameraBefore, { timeout: 8000 })
  await page.mouse.click(annex.x, annex.y)
  await page.getByRole('button', { name: 'Dissolve', exact: true }).click()
  const warm = performance.now()
  await page.mouse.dblclick(annex.x, annex.y)
  await expect(connected).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  timings.selectionAfterDissolveMs = Math.round(performance.now() - warm)
  if (profile) {
    const { profile: selectionProfile } = await cdp.send('Profiler.stop')
    await writeFile(testInfo.outputPath('hogwarts-selection.cpuprofile'), JSON.stringify(selectionProfile))
  }

  const drag = performance.now()
  await page.mouse.move(annex.x, annex.y)
  await page.mouse.down()
  try {
    await expect(page.locator('.placement-hint')).toBeVisible({ timeout: 20_000 })
    await page.mouse.move(annex.x + 24, annex.y + 12, { steps: 4 })
  } finally {
    await page.mouse.up()
  }
  timings.largeGroupDragMs = Math.round(performance.now() - drag)
  await page.keyboard.press('Escape')
  await expect(page.locator('.placement-hint')).toBeHidden()

  const manual = performance.now()
  await page.getByLabel('Work & Library', { exact: true }).click()
  await page.getByRole('button', { name: 'Build Manual', exact: true }).click()
  await expect(page.locator('.manual-current-parts')).toBeVisible({ timeout: 90_000 })
  timings.manualReadyMs = Math.round(performance.now() - manual)
  const result = { physicsRevision, ...timings }
  console.log(JSON.stringify(result))
  await testInfo.attach('hogwarts-editor-timings', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
})
