import { expect, test } from '@playwright/test'
import { importBridgeExample } from './fixtures/importBridgeExample'

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

test('part pages can be jumped to and restored by category', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 980 })
  const pagination = page.getByRole('navigation', { name: 'Parts pagination' })
  const number = pagination.getByRole('spinbutton', { name: 'Page number' })
  const rows = page.locator('.part-list-item')
  await expect(pagination.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  await expect.poll(() => rows.count()).toBeGreaterThan(3)
  const pageSize = await rows.count()
  await expect(page.getByText(new RegExp(`Showing 1–${pageSize} of`))).toBeVisible()
  await pagination.getByRole('button', { name: 'Next page' }).click()
  await expect(number).toHaveValue('2')
  await number.fill('4')
  await number.press('Enter')
  await expect(number).toHaveValue('4')
  await pagination.getByRole('button', { name: 'Previous page' }).click()
  await expect(number).toHaveValue('3')
  const categories = page.locator('.part-kind-tabs')
  const brick = categories.getByRole('button', { name: 'Brick', exact: true })
  const all = categories.getByRole('button', { name: 'All', exact: true })
  await brick.click()
  await expect(number).toHaveValue('1')
  await pagination.getByRole('button', { name: 'Next page' }).click()
  await expect(number).toHaveValue('2')
  await all.click()
  await expect(number).toHaveValue('3')
  await brick.click()
  await expect(number).toHaveValue('2')
  const search = page.getByPlaceholder('Search parts, size, or type')
  await search.fill('brick')
  await expect(number).toHaveValue('1')
  await search.clear()
  await expect(number).toHaveValue('2')
  const layout = await pagination.evaluate(nav => {
    const box = nav.getBoundingClientRect()
    const list = nav.nextElementSibling!.getBoundingClientRect()
    const controls = [...nav.querySelectorAll('button, input')].map(element => element.getBoundingClientRect())
    return { widthDifference: Math.abs(box.width - list.width), heights: controls.map(control => control.height) }
  })
  expect(layout.widthDifference).toBeLessThan(1)
  expect(layout.heights).toEqual([30, 30, 30, 30])
})

test('the parts catalog fits a tall sidebar and keeps three items on a short screen', async ({ page }) => {
  const sidebar = page.locator('.control-panel')
  const rows = sidebar.locator('.part-list-item')
  await page.setViewportSize({ width: 1280, height: 1100 })
  await expect.poll(() => rows.count()).toBeGreaterThan(5)
  const tallCount = await rows.count()
  const overflow = () => sidebar.evaluate(panel => panel.scrollHeight - panel.clientHeight)
  await expect.poll(overflow).toBeLessThanOrEqual(1)
  const pager = page.getByRole('navigation', { name: 'Parts pagination' })
  await pager.getByRole('button', { name: 'Next page' }).click()
  const tallPageFirst = await rows.first().getByRole('button').getAttribute('title')
  await page.setViewportSize({ width: 1280, height: 495 })
  await expect(rows).toHaveCount(3)
  await expect(pager.getByRole('spinbutton')).toHaveValue(String(Math.floor(tallCount / 3) + 1))
  await expect(rows.locator(`button[title="${tallPageFirst}"]`)).toHaveCount(1)
  await expect.poll(overflow).toBeGreaterThan(0)
})

test('current work actions share one dialog and saving as an asset opens its model card', async ({ page }) => {
  await expect(page.getByLabel('Plan name', { exact: true })).toHaveCount(0)
  await page.getByLabel('Work & Library', { exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Work & Library', exact: true })
  await expect(library.getByRole('button', { name: 'Current work', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(library.getByLabel('Plan name')).toBeVisible()
  await expect(library.getByRole('button', { name: 'Export JSON', exact: true })).toBeVisible()
  await expect(library.getByRole('button', { name: 'Export LDraw', exact: true })).toBeVisible()
  await expect(library.getByText('Import JSON / LDraw', { exact: true })).toBeVisible()
  await library.getByPlaceholder(/Title, default:/).fill('Library test model')
  await library.getByRole('button', { name: 'Save as asset', exact: true }).click()
  await expect(library.getByRole('heading', { name: 'Library test model' })).toBeVisible()
  await expect(library.getByLabel('Plan name')).toHaveCount(0)
})

test('loading a library model shows progress before the model is placed', async ({ page }) => {
  test.setTimeout(60_000)
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('Clear Canvas').click()
  await expect(page.getByText('0 parts', { exact: true })).toBeVisible()
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await page.getByLabel('Work & Library', { exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Work & Library' })
  await library.getByRole('button', { name: 'Models', exact: true }).click()
  const castle = library.getByRole('article').filter({ has: page.getByRole('heading', { name: /LEGO 71043/ }) })
  let releaseGeometry!: () => void
  const geometryReady = new Promise<void>(resolve => { releaseGeometry = resolve })
  await page.route(/ldraw(?:GeneratedVisual|StructuralCache)Chunks\/|brick-flow-visuals\/.+\.bin\.gz/, async route => {
    await geometryReady
    await route.continue()
  })
  try {
    await castle.getByRole('button', { name: 'Load', exact: true }).click()
    await expect(library).toBeHidden()
    await expect(page.getByRole('progressbar', { name: 'Loading model…' })).toBeVisible()
    await expect(page.getByText('0 parts', { exact: true })).toBeVisible()
  } finally {
    releaseGeometry()
  }
  await expect(page.getByText('6025 parts', { exact: true })).toBeVisible({ timeout: 35_000 })
  await expect(page.getByRole('progressbar', { name: 'Loading model…' })).toBeHidden()
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
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Dropped E2E Project')
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
  await page.getByRole('button', { name: 'Anchored', exact: true }).click()
  await expect(page.getByText('2/10 records retained for this project.')).toBeVisible()
  await page.getByRole('slider', { name: /Hazard intensity/ }).press('Home')
  await expect(page.getByText('Additional hazard failures 0')).toBeVisible()
  await expect(page.getByText('3/10 records retained for this project.')).toBeVisible()

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

test('an imported bridge can be reinforced and exported without a practice shortcut in the asset library', async ({ page }) => {
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await page.getByLabel('Work & Library', { exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Work & Library' })
  await library.getByRole('button', { name: 'Models', exact: true }).click()
  await expect(library.getByRole('button', { name: 'Try bridge reinforcement in a new project' })).toHaveCount(0)
  await library.getByLabel('Close', { exact: true }).click()
  await importBridgeExample(page)
  await page.getByLabel('Stability disaster lab').click()
  const dialog = page.getByRole('dialog', { name: 'Stability disaster lab' })
  await expect(dialog.getByText('1/10 records retained for this project.')).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Generate reinforcement proposals' }).click()
  await expect(dialog.getByRole('button', { name: 'Apply reinforcement' }).first()).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Preview' }).first().click()
  await expect(dialog.getByRole('button', { name: 'Hide preview' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply reinforcement' }).first().click()
  await expect(dialog.getByText('2/10 records retained for this project.')).toBeVisible({ timeout: 30_000 })
  await dialog.getByLabel('Close').click()
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Bridge reinforcement exercise')
  await page.getByLabel('Work & Library', { exact: true }).click()
  await page.getByRole('button', { name: 'Build Manual', exact: true }).click()
  await expect(page.locator('.manual-current-parts')).toBeVisible()
  await page.getByText('Export & copy', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export manual JSON' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.json$/)
  await page.keyboard.press('Escape')
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

test('legacy manual checks the selected stage without treating a valid final model as stage proof', async ({ page }) => {
  await page.evaluate(() => {
    const pose = { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 }
    const plan = { id: 'manual-stage-review', title: 'Stage review', prompt: '', source: 'template-local',
      bricks: [{ id: 'top', brickId: 'brick-1x1', color: 'gray', pose: { ...pose, yStud: 1.2 } },
        { id: 'base', brickId: 'brick-1x1', color: 'gray', pose }], steps: [
        { id: 'top-step', title: 'Top', description: '', brickIds: ['top'] },
        { id: 'base-step', title: 'Base', description: '', brickIds: ['base'] },
      ] }
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify(plan)], 'stage.json', { type: 'application/json' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('2 parts', { exact: true })).toBeVisible()
  await page.getByLabel('Work & Library', { exact: true }).click()
  await page.getByRole('button', { name: 'Build Manual', exact: true }).click()
  await expect(page.locator('.manual-current-parts')).toBeVisible()
  await expect(page.locator('.manual-inventory')).not.toBeVisible()
  await expect(page.locator('.manual-step-list')).not.toBeVisible()
  const status = page.locator('.manual-preview .structure-status')
  await expect(status).toHaveClass(/warn/)
  await page.locator('.manual-page-controls').getByRole('button', { name: 'Next', exact: true }).click()
  await expect(status).toHaveClass(/ok/)
  await page.setViewportSize({ width: 390, height: 844 })
  const reader = await page.locator('.manual-modal').boundingBox()
  expect(reader!.x).toBeGreaterThanOrEqual(0)
  expect(reader!.x + reader!.width).toBeLessThanOrEqual(390)
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const positions = await page.evaluate(() => {
      const guides = document.querySelector('.manual-assembly-guides')!
      const measurements = []
      for (const labels of [[], ['从右向左安装'], ['从右向左安装', '从左向右安装', '从上向下安装', '从下向上安装', '从前向后安装', '从后向前安装']]) {
        guides.replaceChildren(...labels.map(label => {
          const span = document.createElement('span')
          span.textContent = label
          return span
        }))
        measurements.push({
          guideHeight: guides.getBoundingClientRect().height,
          viewerTop: document.querySelector('.manual-preview-viewer')!.getBoundingClientRect().top,
          controlsTop: document.querySelector('.manual-page-controls')!.getBoundingClientRect().top,
        })
      }
      return measurements
    })
    expect(positions[1]).toEqual(positions[0])
    expect(positions[2]).toEqual(positions[0])
  }
  await page.locator('.manual-secondary-tools > details').first().locator('summary').click()
  const inventory = page.locator('.manual-inventory .brick-count-list')
  await expect(inventory.locator('article')).toHaveCount(1)
  await expect(inventory.locator('article p')).toHaveText('Qty 2')
  await expect(inventory.locator('.count-glyph')).toBeVisible()
})
