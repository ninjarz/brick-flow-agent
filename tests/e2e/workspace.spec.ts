import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
  })
  await page.goto('./')
})

test('clear canvas leaves a genuinely empty workspace', async ({ page }) => {
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByLabel('Clear Canvas').click()
  await expect(page.getByText('0 parts', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Undo')).toBeDisabled()
})

test('a project file can be dropped anywhere in the workspace', async ({ page }) => {
  await page.evaluate(() => {
    const project = {
      id: 'e2e-import',
      title: 'Dropped E2E Project',
      prompt: '',
      source: 'template-local',
      bricks: [{
        id: 'e2e-brick',
        brickId: 'brick-2x2',
        color: 'red',
        pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 },
      }],
      steps: [{ id: 'step-1', title: 'Step 1', description: '', brickIds: ['e2e-brick'] }],
    }
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify(project)], 'dropped.json', { type: 'application/json' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByLabel('Plan name')).toHaveValue('Dropped E2E Project')
  await expect(page.getByText('1 parts', { exact: true })).toBeVisible()
})

test('feedback is prefilled with non-sensitive diagnostics', async ({ page }) => {
  const feedback = page.getByLabel('Send feedback or request a feature')
  await expect(feedback).toHaveAttribute('href', /github\.com\/ninjarz\/brick-flow-agent\/issues\/new/)
  await expect(feedback).toHaveAttribute('href', /Brick\+Flow%3A\+0\.4\.0/)
})

test('stability analysis is retained and exports a PNG report', async ({ page }) => {
  await page.getByLabel('Stability disaster lab').click()
  await expect(page.getByText('Analysis history and comparison')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('1/10 records retained for this project.')).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTitle('Export PNG image').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/-stability-report\.png$/)
})

test('a structural test suite finds and replays the weakest case', async ({ page }) => {
  await page.getByLabel('Stability disaster lab').click()
  await expect(page.getByRole('button', { name: 'Run test suite' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Run test suite' }).click()
  await expect(page.getByRole('button', { name: 'Replay weakest' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Weakest case', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Replay weakest' }).click()
  await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible({ timeout: 30_000 })
})

test('a verified reinforcement can be previewed, applied, and undone', async ({ page }) => {
  await page.evaluate(() => {
    const project = {
      id: 'e2e-reinforcement',
      title: 'Reinforcement E2E',
      prompt: '',
      source: 'template-local',
      bricks: [
        { id: 'base', brickId: 'brick-1x1', color: 'gray', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } },
        { id: 'cantilever', brickId: 'brick-1x4', color: 'gray', pose: { xStud: 0, yStud: 1.2, zStud: 0, rotationQuarterTurns: 0 } },
      ],
      steps: [
        { id: 'step-base', title: 'Base', description: '', brickIds: ['base'] },
        { id: 'step-cantilever', title: 'Cantilever', description: '', brickIds: ['cantilever'] },
      ],
    }
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify(project)], 'reinforcement.json', { type: 'application/json' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('2 parts', { exact: true })).toBeVisible()
  await page.getByLabel('Stability disaster lab').click()
  const dialog = page.getByRole('dialog', { name: 'Stability disaster lab' })
  await dialog.getByRole('button', { name: 'Generate reinforcement proposals' }).click()
  await expect(dialog.getByRole('button', { name: 'Apply reinforcement' }).first()).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Preview' }).first().click()
  await expect(dialog.getByRole('button', { name: 'Hide preview' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply reinforcement' }).first().click()
  await dialog.getByLabel('Close').click()
  await expect(page.getByLabel('Undo')).toBeEnabled()
  await page.getByLabel('Undo').click()
  await expect(page.getByText('2 parts', { exact: true })).toBeVisible()
})

test('LDraw compatibility details remain available in debug mode after import', async ({ page }) => {
  await expect(page.getByLabel('Import Compatibility Center')).toHaveCount(0)
  await page.goto('./?debug=1')
  await page.evaluate(() => {
    const ldraw = [
      '0 FILE compatibility-demo.ldr',
      '0 Compatibility demo',
      '1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      '1 999 80 0 0 1 0 0 0 1 0 0 0 1 99999.dat',
      '1 999 160 0 0 1 0 0 0 1 0 0 0 1 99999.dat',
    ].join('\n')
    const transfer = new DataTransfer()
    transfer.items.add(new File([ldraw], 'compatibility-demo.ldr', { type: 'text/plain' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })

  await expect(page.getByText('1 parts', { exact: true })).toBeVisible()
  await page.getByLabel('Import Compatibility Center').click()
  await expect(page.getByRole('dialog', { name: 'Import Compatibility Center' })).toBeVisible()
  await expect(page.getByText('99999 ×2')).toBeVisible()
  await expect(page.getByText('Unknown colors')).toBeVisible()
})
