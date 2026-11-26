import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('indexed simulation runs in the page and renders a 200 NPC world', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./')
  await expect(page.getByLabel('Current work title', { exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const root = '/brick-flow-agent/src/'
    const { createEmptyWorldState, createWorldEntity } = await import(root + 'lib/worldEntity.ts')
    const { worldEntityDefinitionById } = await import(root + 'data/worldEntityDefinitions.ts')
    const { stepWorldSimulation } = await import(root + 'lib/worldSimulation.ts')
    const { createWorldVisibilityIndex } = await import(root + 'lib/worldVisibility.ts')
    const { createWorldEntityOccupancyIndex, queryWorldEntityOccupantIds } = await import(root + 'lib/worldEntityCollision.ts')
    const bricks = [0, 200].map((x, index) => ({ id: 'edge-' + index, brickId: 'brick-1x1', color: 'gray', pose: { xStud: x, yStud: 0, zStud: x, rotationQuarterTurns: 0 } }))
    const structures: never[] = []
    let world = {
      ...createEmptyWorldState('performance'),
      entities: Array.from({ length: 200 }, (_, index) => createWorldEntity(worldEntityDefinitionById.get('knight'), {
        id: 'npc-' + index, factionId: index % 2 ? 'red' : 'blue',
        transform: { x: 5 + index % 20 * 8, z: 5 + Math.floor(index / 20) * 8 },
      })),
      hiddenTargets: [{ kind: 'brick', id: 'edge-0' }],
    }
    const first = createWorldVisibilityIndex(world, bricks, structures)
    const second = createWorldVisibilityIndex(structuredClone(world), bricks, structures)
    const revealed = createWorldVisibilityIndex({ ...world, hiddenTargets: [] }, bricks, structures)
    const occupancy = createWorldEntityOccupancyIndex(world.entities)
    const candidates = world.entities.reduce((sum: number, entity: { transform: { x: number; z: number } }) => sum + queryWorldEntityOccupantIds(occupancy, entity.transform, 18).length, 0)
    const started = performance.now()
    for (let step = 0; step < 30; step++) world = stepWorldSimulation(world, bricks, .1, structures)
    const simulationMs = performance.now() - started
    const plan = { id: 'performance', title: '200 NPC performance scene', prompt: '', source: 'template-local', bricks, steps: bricks.map(brick => ({ id: 'step-' + brick.id, title: 'Boundary marker', description: '', brickIds: [brick.id] })) }
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify({ plan, world })], 'performance.json', { type: 'application/json' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    return { cachedScene: first.visibleBricks === second.visibleBricks, revealInvalidated: revealed.visibleBricks.length === 2 && first.visibleBricks.length === 1, candidates, fullScanCandidates: 200 * 200, simulationMs, elapsed: world.elapsedSeconds, entityCount: world.entities.length }
  })
  expect(result.cachedScene).toBe(true)
  expect(result.revealInvalidated).toBe(true)
  expect(result.candidates).toBeLessThan(result.fullScanCandidates / 3)
  expect(result.entityCount).toBe(200)
  expect(result.elapsed).toBeCloseTo(3)
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('200 NPC performance scene')
  await expect(page.getByText('200 active units', { exact: true })).toBeVisible()
  await page.locator('.world-story-dock').getByLabel('Close', { exact: true }).click()
  await expect(page.locator('.viewer canvas')).toBeVisible()
  await expect(page.locator('.viewer .scene-loading')).toHaveCount(0)
  await page.waitForTimeout(2000)
  expect(errors).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('200-npc-scene.png') })
  const metricsPath = testInfo.outputPath('performance.json')
  await writeFile(metricsPath, JSON.stringify(result, null, 2))
  await testInfo.attach('performance', { path: metricsPath, contentType: 'application/json' })
})
