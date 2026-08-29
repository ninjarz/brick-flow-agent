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
  await expect(feedback).toHaveAttribute('href', /Brick\+Flow%3A\+0\.1\.0/)
})
