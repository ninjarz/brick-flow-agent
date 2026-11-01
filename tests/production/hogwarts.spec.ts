import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

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
  await expect(page.locator('canvas').first()).toBeVisible()
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
})
