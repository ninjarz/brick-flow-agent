import { test, expect, type Page } from '@playwright/test'
import { renameCurrentWork } from './fixtures/currentWork'
import { createWorldEntity } from '../../src/lib/worldEntity'
import { worldEntityDefinitionById } from '../../src/data/worldEntityDefinitions'

const storePath = '/brick-flow-agent/src/lib/projectStore.ts'
const restoreModule = /\/src\/lib\/projectStore\.ts(?:\?.*)?$/
const prepare = async (page: Page) => {
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./?preset=robot')
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await renameCurrentWork(page, 'Authoritative project')
  await expect.poll(() => page.evaluate(async path => {
    const { projectStore } = await import(/* @vite-ignore */ path)
    return (await projectStore.read((await projectStore.list())[0].id)).snapshot.plan.title
  }, storePath)).toBe('Authoritative project')
}

const delayRestore = async (page: Page) => {
  await page.route(restoreModule, async route => {
    const response = await route.fetch()
    await route.fulfill({ response, body: `${await response.text()}
      const initializeBeforeDelay = projectStore.initialize;
      projectStore.initialize = async (...args) => {
        await new Promise(resolve => { window.releaseProjectRestore = resolve; });
        return initializeBeforeDelay(...args);
      };
    ` })
  })
}
const releaseRestore = async (page: Page) => page.evaluate(() => {
  (window as unknown as { releaseProjectRestore: () => void }).releaseProjectRestore()
})

test('slow restoration pauses the stale backup simulation and keeps the formal project', async ({ page }) => {
  await prepare(page)
  await page.evaluate(entity => {
    const draft = JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!)
    draft.plan.title = 'Stale backup'
    draft.world.entities = [entity]
    draft.world.paused = false
    localStorage.setItem('brick-flow-agent:workspace-draft:v1', JSON.stringify(draft))
  }, createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'stale-npc' }))
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (...args) {
      const message = args[0]
      if (message && typeof message === 'object' && 'world' in message && 'stepCount' in message) {
        localStorage.setItem('simulation-posted-during-restore', 'yes')
      }
      return post.apply(this, args)
    }
  })
  await delayRestore(page)
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectRestore?: () => void }).releaseProjectRestore))
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Stale backup')
  // Leave more than three simulation pulses inside the delayed restore window.
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => localStorage.getItem('simulation-posted-during-restore'))).toBeNull()
  await releaseRestore(page)
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Authoritative project')
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  const titles = await page.evaluate(async path => {
    const { projectStore } = await import(/* @vite-ignore */ path)
    return Promise.all((await projectStore.list()).map(async (project: { id: string }) => (await projectStore.read(project.id)).snapshot.plan.title))
  }, storePath)
  expect(titles).toEqual(['Authoritative project'])
})

test('editing before slow restoration finishes creates an independent recovered project', async ({ page }) => {
  await prepare(page)
  await delayRestore(page)
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectRestore?: () => void }).releaseProjectRestore))
  await renameCurrentWork(page, 'Recovered edit')
  await releaseRestore(page)
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  const titles = await page.evaluate(async path => {
    const { projectStore } = await import(/* @vite-ignore */ path)
    return Promise.all((await projectStore.list()).map(async (project: { id: string }) => (await projectStore.read(project.id)).snapshot.plan.title))
  }, storePath)
  expect(titles.sort()).toEqual(['Authoritative project', 'Recovered edit'])
  await page.unroute(restoreModule)
  await page.reload()
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Recovered edit')
})

test('save-as retains edits during creation and activation and restores them after reload', async ({ page, context }) => {
  await prepare(page)
  const other = await context.newPage()
  await other.goto('./')
  await expect(other.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await renameCurrentWork(other, 'Other tab edit')
  await expect.poll(() => other.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan.title)).toBe('Other tab edit')
  await renameCurrentWork(page, 'Before save-as')
  await expect(page.getByText(/Another tab changed this work/)).toBeVisible()
  await other.close()
  await page.evaluate(async path => {
    const { projectStore } = await import(/* @vite-ignore */ path)
    const delayed = window as unknown as { releaseProjectCreate?: () => void; releaseProjectActivate?: () => void }
    const create = projectStore.create
    const activate = projectStore.activate
    projectStore.create = async (...args: unknown[]) => {
      await new Promise<void>(resolve => { delayed.releaseProjectCreate = resolve })
      return create(...args)
    }
    projectStore.activate = async (...args: unknown[]) => {
      await new Promise<void>(resolve => { delayed.releaseProjectActivate = resolve })
      return activate(...args)
    }
  }, storePath)
  await page.getByRole('button', { name: 'Keep current copy', exact: true }).click()
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectCreate?: () => void }).releaseProjectCreate))
  await renameCurrentWork(page, 'Edit during creation')
  await page.evaluate(() => (window as unknown as { releaseProjectCreate: () => void }).releaseProjectCreate())
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectActivate?: () => void }).releaseProjectActivate))
  await renameCurrentWork(page, 'Edit during activation')
  await page.evaluate(() => (window as unknown as { releaseProjectActivate: () => void }).releaseProjectActivate())
  await expect(page.locator('main[data-workspace-storage="saved"]')).toBeVisible()
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Edit during activation')
  await page.reload()
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Edit during activation')
})

test('a file dropped during restoration imports afterwards and retains undo', async ({ page }) => {
  await prepare(page)
  await delayRestore(page)
  await page.reload()
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectRestore?: () => void }).releaseProjectRestore))
  await page.evaluate(() => {
    const plan = { id: 'queued-import', title: 'Queued import', prompt: '', source: 'template-local',
      bricks: [{ id: 'queued-brick', brickId: 'brick-1x1', color: 'red', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } }],
      steps: [{ id: 'queued-step', title: 'Queued', description: '', brickIds: ['queued-brick'] }] }
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify(plan)], 'queued.json', { type: 'application/json' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Authoritative project')
  await releaseRestore(page)
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Queued import')
  await page.getByLabel('Undo').click()
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText('Authoritative project')
})
