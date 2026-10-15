import { test, expect, type Page } from '@playwright/test'
import { createWorldEntity } from '../../src/lib/worldEntity'
import { worldEntityDefinitionById } from '../../src/data/worldEntityDefinitions'

const storePath = '/brick-flow-agent/src/lib/projectStore.ts'
const restoreModule = /\/src\/lib\/projectStore\.ts(?:\?.*)?$/
const prepare = async (page: Page) => {
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./')
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
  await page.getByLabel('Plan name').fill('Authoritative project')
  await page.getByLabel('Plan name').blur()
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
  await expect(page.getByLabel('Plan name')).toHaveValue('Stale backup')
  // Leave more than three simulation pulses inside the delayed restore window.
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => localStorage.getItem('simulation-posted-during-restore'))).toBeNull()
  await releaseRestore(page)
  await expect(page.getByLabel('Plan name')).toHaveValue('Authoritative project')
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
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
  await page.getByLabel('Plan name').fill('Recovered edit')
  await page.getByLabel('Plan name').blur()
  await releaseRestore(page)
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
  const titles = await page.evaluate(async path => {
    const { projectStore } = await import(/* @vite-ignore */ path)
    return Promise.all((await projectStore.list()).map(async (project: { id: string }) => (await projectStore.read(project.id)).snapshot.plan.title))
  }, storePath)
  expect(titles.sort()).toEqual(['Authoritative project', 'Recovered edit'])
  await page.unroute(restoreModule)
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Recovered edit')
})

test('save-as retains edits during creation and activation and restores them after reload', async ({ page, context }) => {
  await prepare(page)
  const other = await context.newPage()
  await other.goto('./')
  await expect(other.getByText('Saved in this browser', { exact: true })).toBeVisible()
  await other.getByLabel('Plan name').fill('Other tab edit')
  await other.getByLabel('Plan name').blur()
  await expect.poll(() => other.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan.title)).toBe('Other tab edit')
  await page.getByLabel('Plan name').fill('Before save-as')
  await page.getByLabel('Plan name').blur()
  await expect(page.getByText(/Save conflict:/)).toBeVisible()
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
  await page.locator('.project-manager').first().locator('summary').click()
  await page.getByRole('button', { name: 'Save as new project', exact: true }).click()
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectCreate?: () => void }).releaseProjectCreate))
  await page.getByLabel('Plan name').fill('Edit during creation')
  await page.getByLabel('Plan name').blur()
  await page.evaluate(() => (window as unknown as { releaseProjectCreate: () => void }).releaseProjectCreate())
  await page.waitForFunction(() => Boolean((window as unknown as { releaseProjectActivate?: () => void }).releaseProjectActivate))
  await page.getByLabel('Plan name').fill('Edit during activation')
  await page.getByLabel('Plan name').blur()
  await page.evaluate(() => (window as unknown as { releaseProjectActivate: () => void }).releaseProjectActivate())
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Plan name')).toHaveValue('Edit during activation')
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Edit during activation')
})
