import { test, expect } from '@playwright/test'
import { createEmptyWorldState, createWorldEntity } from '../../src/lib/worldEntity'
import { worldEntityDefinitionById } from '../../src/data/worldEntityDefinitions'

test('undo restores the complete original project', async ({ page }) => {
  const plan = { id: 'review-A', title: 'Review A', prompt: '', source: 'template-local', bricks: [{ id: 'b', brickId: 'brick-2x2', color: 'red', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } }], steps: [{ id: 's', title: 'Step', description: '', brickIds: ['b'] }] }
  const world = { ...createEmptyWorldState(plan.id), paused: true, entities: [createWorldEntity(worldEntityDefinitionById.get('knight')!, { id: 'review-npc', name: 'Review NPC' })] }
  await page.addInitScript((draft) => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    if (!localStorage.getItem('brick-flow-agent:workspace-draft:v1')) localStorage.setItem('brick-flow-agent:workspace-draft:v1', JSON.stringify(draft))
  }, { plan, prompt: '', world })
  await page.goto('./')
  await expect(page.getByLabel('Plan name')).toHaveValue('Review A')
  await page.evaluate((plan) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify({ ...plan, id: 'review-B', title: 'Review B' })], 'b.json'))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, plan)
  await expect(page.getByLabel('Plan name')).toHaveValue('Review B')
  await page.getByLabel('Undo').click()
  await expect(page.getByLabel('Plan name')).toHaveValue('Review A')
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!)
    return { id: stored.plan.id, entities: stored.world.entities.length }
  })).toEqual({ id: 'review-A', entities: 1 })
  await page.getByLabel('Redo').click()
  await expect(page.getByLabel('Plan name')).toHaveValue('Review B')
  await page.getByLabel('Undo').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).world.entities.length)).toBe(1)
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Review A')
})

test('corrupt draft remains downloadable and cannot be silently overwritten', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    localStorage.setItem('brick-flow-agent:workspace-draft:v1', '{ broken draft')
  })
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Download original draft' })).toBeVisible()
  await page.getByLabel('Plan name').fill('New edit')
  await page.getByLabel('Plan name').blur()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download original draft' }).click()
  expect((await download).suggestedFilename()).toBe('brick-flow-draft-recovery.json')
  expect(await page.evaluate(() => localStorage.getItem('brick-flow-agent:workspace-draft:v1'))).toBe('{ broken draft')
})

for (const keepStaleInline of [false, true]) test(`recovers newer IndexedDB data with ${keepStaleInline ? 'a stale inline draft' : 'no storage marker'}`, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'en-US'))
  await page.goto('./')
  await expect(page.getByText('Saved in this browser', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('brick-flow-agent:workspace-draft:v1')))).toBe(true)
  await page.evaluate(async (keepStaleInline) => {
    const stored = JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!)
    stored.plan.title = 'IndexedDB recovery'
    stored.savedAt = (stored.savedAt ?? 0) + 1000
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('brick-flow-agent')
      request.onupgradeneeded = () => request.result.createObjectStore('large-values')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['large-values', 'projects', 'project-content', 'project-meta', 'project-checkpoints'], 'readwrite')
        for (const name of ['projects', 'project-content', 'project-meta', 'project-checkpoints']) tx.objectStore(name).clear()
        tx.objectStore('large-values').put(stored, 'workspace-draft:v1')
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
    if (!keepStaleInline) localStorage.removeItem('brick-flow-agent:workspace-draft:v1')
  }, keepStaleInline)
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('IndexedDB recovery')
})

test('a late AI response cannot replace a newly imported project', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    localStorage.setItem('brick-flow-agent:llm-config', JSON.stringify({ modelName: 'mock', endpoint: 'https://mock.invalid/chat', apiKey: 'mock', requestMode: 'direct' }))
    const original = window.fetch
    window.fetch = async (input, init) => {
      if (String(input) !== 'https://mock.invalid/chat') return original(input, init)
      const body = new ReadableStream({ start(controller) {
        localStorage.setItem('review-request-started', 'yes')
        window.addEventListener('release-review-response', () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: 'Stale AI result', bricks: [{ brickId: 'brick-2x2', color: 'red', xStud: 0, yStud: 0, zStud: 0 }] }) } }] })))
          controller.close()
          localStorage.setItem('review-response-released', 'yes')
        }, { once: true })
      } })
      return new Response(body, { status: 200 })
    }
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('review-request-started'))).toBe('yes')
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan
    const transfer = new DataTransfer()
    // Deliberately reuse the old plan ID: identity alone cannot isolate this operation.
    transfer.items.add(new File([JSON.stringify({ ...current, title: 'Imported replacement' })], 'replacement.json'))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByLabel('Plan name')).toHaveValue('Imported replacement')
  await page.evaluate(() => window.dispatchEvent(new Event('release-review-response')))
  await expect(page.getByRole('button', { name: 'Generate plan', exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan.title)).toBe('Imported replacement')
  await page.reload()
  await expect(page.getByLabel('Plan name')).toHaveValue('Imported replacement')
})

test('storage access denial keeps the workspace usable', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Storage denied', 'SecurityError') }
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('./')
  await expect(page.getByLabel('Plan name')).toBeVisible()
  expect(errors).toEqual([])
})

test('unfinished saved draft is restored and retained', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    localStorage.setItem('brick-flow-agent:workspace-draft:v1', JSON.stringify({ plan: {
      id: 'unfinished-review', title: 'Unfinished review', prompt: '', source: 'template-local',
      bricks: [{ id: 'floating', brickId: 'brick-2x2', color: 'red', pose: { xStud: 0, yStud: 1.2, zStud: 0, rotationQuarterTurns: 0 } }],
      steps: [{ id: 's', title: 'Step', description: '', brickIds: ['floating'] }],
    }, prompt: '' }))
  })
  await page.goto('./')
  await expect(page.getByLabel('Plan name')).toHaveValue('Unfinished review')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('brick-flow-agent:workspace-draft:v1')!).plan.id)).toBe('unfinished-review')
})

test('plan changes retain the selected simulation case', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    const original = Worker.prototype.postMessage
    Worker.prototype.postMessage = function(message, ...args) {
      if (message?.type === 'simulate') localStorage.setItem('review-last-scenario', message.options.scenario)
      return original.call(this, message, ...args)
    }
  })
  await page.goto('./')
  await page.getByLabel('Stability disaster lab').click()
  const quake = page.getByRole('button', { name: 'Earthquake', exact: true })
  await quake.click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('review-last-scenario'))).toBe('earthquake')
  await page.evaluate(() => {
    const plan = { id: 'changed-review', title: 'Changed review', prompt: '', source: 'template-local',
      bricks: [{ id: 'b', brickId: 'brick-2x2', color: 'red', pose: { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 } }],
      steps: [{ id: 's', title: 'Step', description: '', brickIds: ['b'] }] }
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify(plan)], 'changed.json'))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByLabel('Plan name')).toHaveValue('Changed review')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('review-last-scenario'))).toBe('earthquake')
  await expect(quake).toHaveAttribute('aria-pressed', 'true')
})
