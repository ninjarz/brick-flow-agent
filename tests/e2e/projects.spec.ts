import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./')
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
})
test('workspace edits still autosave after removing project controls', async ({ page }) => {
  await page.getByLabel('Plan name').fill('Autosaved work')
  await page.getByLabel('Plan name').blur()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan.title)).toBe('Autosaved work')
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Autosaved work')
})
test('two tabs detect stale writes and preserve conflict via save-as', async ({ page, context }) => {
  const other = await context.newPage()
  await other.goto('./')
  await expect(other.getByText('Saved in this browser', { exact: true })).toBeVisible()
  await other.getByLabel('Plan name').fill('Tab B saved')
  await other.getByLabel('Plan name').blur()
  await expect.poll(() => other.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan.title)).toBe('Tab B saved')
  await page.getByLabel('Plan name').fill('Tab A draft')
  await page.getByLabel('Plan name').blur()
  await expect(page.getByText(/Another tab changed this work/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep current copy', exact: true }).click()
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Tab A draft')
  await other.close()
})
test('transactions reject stale saves, deletion resurrection and quota failures', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = '/brick-flow-agent/src/lib/projectStore.ts'
    const { projectStore } = await import(/* @vite-ignore */ modulePath)
    const source = await projectStore.read((await projectStore.list())[0].id)
    const project = await projectStore.create(source.snapshot, 'Transaction fixture')
    await projectStore.save(project.id, project.revision, project.snapshot)
    let conflict = false
    try { await projectStore.save(project.id, project.revision, project.snapshot) } catch { conflict = true }
    const saved = await projectStore.read(project.id)
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () { throw new DOMException('Quota full', 'QuotaExceededError') }
    let quota = false
    try { await projectStore.save(saved.id, saved.revision, { ...saved.snapshot, prompt: 'lost' }) } catch { quota = true }
    finally { IDBObjectStore.prototype.put = put }
    const intact = (await projectStore.read(project.id)).snapshot.prompt === saved.snapshot.prompt
    const replacement = await projectStore.removeAndActivate(saved.id, saved.revision, source.id)
    let deleted = false
    try { await projectStore.save(saved.id, saved.revision, saved.snapshot) } catch { deleted = true }
    return { conflict, quota, intact, deleted, missing: !await projectStore.read(saved.id), active: (await projectStore.initialize(source.snapshot)).id === replacement.id }
  })
  expect(result).toEqual({ conflict: true, quota: true, intact: true, deleted: true, missing: true, active: true })
})
test('50 project index listing does not read project contents', async ({ page }) => {
  const reads = await page.evaluate(async () => {
    const modulePath = '/brick-flow-agent/src/lib/projectStore.ts'
    const { projectStore } = await import(/* @vite-ignore */ modulePath)
    const source = await projectStore.read((await projectStore.list())[0].id)
    for (let i = 0; i < 50; i++) await projectStore.create(source.snapshot, `Index ${i}`)
    let contents = 0
    const get = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function (...args) { if (this.name === 'project-content') contents++; return get.apply(this, args) }
    try { await projectStore.list() } finally { IDBObjectStore.prototype.get = get }
    return contents
  })
  expect(reads).toBe(0)
})
