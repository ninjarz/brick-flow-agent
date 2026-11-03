import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

test.use({ deviceScaleFactor: 2 })

test('complete Hogwarts asset loads through the standard library and exports every native piece', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Large replica load and download regression')
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./')
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible({ timeout: 30_000 })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('Clear Canvas').click()
  await expect(page.getByText('0 parts', { exact: true })).toBeVisible()
  await page.getByLabel('Asset Library', { exact: true }).click()
  const card = page.locator('.asset-card').filter({ has: page.getByRole('heading', { name: 'LEGO 71043 霍格沃茨城堡', exact: true }) })
  await expect(card).toContainText('6025 parts')
  await expect(card).toContainText('819 steps')
  await card.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(page.getByText('6025 parts', { exact: true })).toBeVisible({ timeout: 60_000 })
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  await expect(page.locator('[data-geometry-ready]')).toHaveAttribute('data-geometry-ready', 'true', { timeout: 60_000 })
  // Large models must retain the same high-DPI backing resolution as small ones.
  await expect.poll(() => canvas.evaluate(element => element.width / element.clientWidth)).toBeGreaterThan(1.9)
  await page.locator('.brick-editor-window').getByLabel('Close', { exact: true }).click()
  const viewport = (await canvas.boundingBox())!
  const selectionStarted = Date.now()
  let pickedPoint = { x: 0, y: 0 }
  for (const [x, y] of [[.5, .65], [.55, .7], [.5, .5]]) {
    pickedPoint = { x: viewport.x + viewport.width * x, y: viewport.y + viewport.height * y }
    await page.mouse.click(pickedPoint.x, pickedPoint.y)
    if (await page.locator('.brick-editor-window').isVisible()) break
  }
  // Official subassemblies select as a group; the picked piece must still be identified.
  await expect(page.locator('.selected-piece-card')).toContainText('Instance')
  info.annotations.push({ type: 'large-scene-selection-ms', description: String(Date.now() - selectionStarted) })
  // Camera drags preserve selection, including excursions that return to their origin.
  const blank = { x: viewport.x + viewport.width * .2, y: viewport.y + viewport.height * .8 }
  const pickedInstance = await page.locator('.selected-piece-card').textContent()
  await page.mouse.move(blank.x, blank.y)
  await page.mouse.down()
  await page.mouse.move(blank.x + 20, blank.y, { steps: 4 })
  await page.mouse.move(blank.x, blank.y, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('.selected-piece-card')).toHaveText(pickedInstance!)
  // A fresh click on visible ground clears the selection.
  await page.mouse.click(blank.x, blank.y)
  await expect(page.locator('.selected-piece-card')).toHaveCount(0)
  await page.mouse.click(pickedPoint.x, pickedPoint.y)
  await expect(page.locator('.selected-piece-card')).toContainText('Instance')
  // A real click may include a few pixels of hand jitter. Ground release
  // still clears selection, while the larger camera drag above preserves it.
  await page.mouse.move(blank.x, blank.y)
  await page.mouse.down()
  await page.mouse.move(blank.x + 3, blank.y + 4)
  await page.mouse.up()
  await expect(page.locator('.brick-editor-window')).toHaveCount(0)
  await page.mouse.click(pickedPoint.x, pickedPoint.y)
  await expect(page.locator('.selected-piece-card')).toContainText('Instance')
  // Native pointer tracking must still enter and cancel a group placement.
  await page.mouse.move(pickedPoint.x, pickedPoint.y)
  const dragStarted = Date.now()
  await page.mouse.down()
  const placementHint = page.getByText('Move to position · Left-click to confirm · Right-click or Esc to cancel', { exact: true })
  await expect(placementHint).toBeVisible({ timeout: 10_000 })
  info.annotations.push({ type: 'large-scene-longpress-ready-ms', description: String(Date.now() - dragStarted) })
  // Releasing the initiating long press must leave placement active.
  await page.mouse.up()
  await expect(placementHint).toBeVisible()
  await page.mouse.move(pickedPoint.x + 20, pickedPoint.y + 8, { steps: 10 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(placementHint).not.toBeVisible()
  // A rapid move followed immediately by a click must wait for that drop,
  // rather than losing confirmation when React batches the pointer updates.
  await page.mouse.move(pickedPoint.x, pickedPoint.y)
  await page.mouse.down()
  await expect(placementHint).toBeVisible({ timeout: 10_000 })
  await page.mouse.up()
  await page.mouse.move(blank.x, blank.y, { steps: 12 })
  await page.mouse.click(blank.x, blank.y)
  await expect(placementHint).not.toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Undo', { exact: true }).click()
  await expect(page.getByText('6025 parts', { exact: true })).toBeVisible()
  const downloadReady = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click()
  const download = await downloadReady
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.plan.bricks).toHaveLength(6025)
  expect(exported.plan.steps).toHaveLength(819)
  expect(exported.manual.totalPieces).toBe(6025)
  expect(exported.manual.steps.at(-1).completedPieceCount).toBe(6025)
  expect(exported.manual.validation.blockingIssueCount).toBe(0)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1') ?? '{}').plan?.bricks.length)).toBe(6025)
  await page.reload()
  await expect(page.getByText('6025 parts', { exact: true })).toBeVisible({ timeout: 60_000 })
  // Explicitly release the large live scene before browser-fixture teardown.
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('Clear Canvas').click()
  await expect(page.getByText('0 parts', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
  console.log('Hogwarts high-DPI load, selection, export and reload verified')
})
