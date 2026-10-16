import { expect, test } from '@playwright/test'
import { createEmptyWorldState, createWorldEntity } from '../../src/lib/worldEntity'
import { brickById } from '../../src/data/basicBricks'
import { createWorldObstacleIndex } from '../../src/lib/worldObstacleIndex'
import type { BuildPlan } from '../../src/types/bricks'
import { worldEntityDefinitionById } from '../../src/data/worldEntityDefinitions'

test('built app loads lazy geometry, simulation workers and survives reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const failedAssets: string[] = []
  page.on('response', (response) => { if (response.status() >= 400) failedAssets.push(response.url()) })
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.getByLabel('Stability disaster lab').click()
  await expect(page.getByText('1/10 records retained for this project.')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('dialog', { name: 'Stability disaster lab' }).getByLabel('Close').click()
  await page.getByLabel('Plan name').fill('Production round trip')
  await page.getByLabel('Plan name').blur()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1') ?? '{}').plan?.title)).toBe('Production round trip')
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Production round trip')
  expect(errors).toEqual([])
  expect(failedAssets).toEqual([])
})

test('records browser frame, heap and resource baselines for 1500 blocks and 60 NPCs', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Chromium-only heap and long-task instrumentation')
  test.setTimeout(60_000)
  const plan: BuildPlan = { id: 'browser-profile', title: 'Browser profile', prompt: '', source: 'template-local', steps: [],
    bricks: Array.from({ length: 1500 }, (_, i) => ({ id: String(i), brickId: 'minecraft-stone-block', color: 'gray',
      pose: { xStud: i % 50, yStud: 0, zStud: Math.floor(i / 50), rotationQuarterTurns: 0 } })) }
  expect(plan.bricks.every((brick) => brickById.has(brick.brickId))).toBe(true)
  expect(createWorldObstacleIndex(plan.bricks).bounds).toHaveLength(1500)
  const world = { ...createEmptyWorldState(plan.id), entities: Array.from({ length: 60 }, (_, i) => createWorldEntity(worldEntityDefinitionById.get('knight')!, {
    id: `profile-${i}`, transform: { x: i % 10 * 3 - 35, z: Math.floor(i / 10) * 3 - 25 },
  })) }
  await page.addInitScript((draft) => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    localStorage.setItem('brick-flow-agent:workspace-draft:v1', JSON.stringify(draft))
  }, { plan, world, prompt: '' })
  await page.goto('./')
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.getByText('1500 parts', { exact: true })).toBeVisible()
  const metrics = await page.evaluate(async () => {
    const longTasks: number[] = []
    const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)))
    observer.observe({ type: 'longtask', buffered: true })
    const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
    const heapBefore = heap()
    const frames: number[] = []
    let previous = performance.now()
    const started = previous
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        frames.push(now - previous)
        previous = now
        if (now - started < 10_000) requestAnimationFrame(frame)
        else resolve()
      }
      requestAnimationFrame(frame)
    })
    observer.disconnect()
    frames.sort((a, b) => a - b)
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    return { sampleSeconds: 10, frameCount: frames.length, frameP50Ms: frames[Math.floor(frames.length * 0.5)], frameP95Ms: frames[Math.floor(frames.length * 0.95)],
      longTaskCount: longTasks.length, longestTaskMs: Math.max(0, ...longTasks), heapBefore, heapAfter: heap(),
      resources: resources.map((item) => ({ name: new URL(item.name).pathname, transferBytes: item.transferSize, durationMs: item.duration })),
      worldSeconds: JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1') ?? '{}').world?.elapsedSeconds }
  })
  await info.attach('browser-performance.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
  console.log('Browser performance:', JSON.stringify(metrics))
  expect(metrics.frameCount).toBeGreaterThan(0)
  expect(metrics.worldSeconds).toBeGreaterThan(0)
})
