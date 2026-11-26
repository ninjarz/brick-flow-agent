import { expect, test } from '@playwright/test'
import type { Camera } from 'three'
import type { BuildPlan } from '../../src/types/bricks'
import { importBridgeExample } from './fixtures/importBridgeExample'

test('a ground pointer under the bridge places a support below the deck', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.route(/\/src\/components\/BrickScene\.tsx(?:\?.*)?$/, async route => {
    const response = await route.fetch()
    const source = await response.text()
    const marker = '    camera.updateProjectionMatrix();'
    expect(source).toContain(marker)
    await route.fulfill({ response, body: source.replace(marker, marker + ' window.placementTestCamera = camera;') })
  })
  await page.goto('./')
  await importBridgeExample(page)
  const viewer = page.locator('.viewer')
  await expect(viewer.locator('[data-geometry-ready="true"]')).toBeAttached()
  await page.getByTitle('Add 1x1 Brick', { exact: true }).click()
  const point = await page.evaluate(() => {
    const camera = (window as Window & { placementTestCamera: Camera }).placementTestCamera
    const canvas = document.querySelector('.viewer canvas')!.getBoundingClientRect()
    camera.updateMatrixWorld(true)
    const screen = camera.position.clone().set(2.5, -0.01, 0.85).project(camera)
    return {
      x: canvas.left + canvas.width * (screen.x + 1) / 2,
      y: canvas.top + canvas.height * (1 - screen.y) / 2,
    }
  })
  await page.mouse.move(point.x, point.y)
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => page.evaluate(() => {
    const draft = JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1') ?? '{}') as { plan?: BuildPlan }
    return draft.plan?.bricks.find(brick => brick.id !== 'deck' && brick.id !== 'pier')?.pose
  })).toMatchObject({ xStud: 2, yStud: 0, zStud: 0 })
})
