import { expect, test, type Page } from '@playwright/test'

test.setTimeout(90000)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brick-flow-agent:locale:v1', 'zh-CN'))
  await page.goto('./')
  page.on('dialog', dialog => dialog.accept())
  await page.getByLabel('素材库', { exact: true }).click()
  await page.locator('.asset-kind-tabs button').nth(1).click()
  await page.locator('.scenario-card').first().getByRole('button', { name: '开始场景', exact: true }).click()
  await expect(page.locator('.brick-editor-window')).toHaveCount(0)
})

const act = (page: Page, name: string) => page.locator('.world-story-actions').getByRole('button', { name, exact: true }).click()
const readDialogue = async (page: Page, lines: number) => {
  const actions = page.locator('.world-story-actions')
  await expect(actions.getByRole('button', { name: '下一句', exact: true })).toBeVisible({ timeout: 30000 })
  for (let i = 1; i < lines; i++) await actions.getByRole('button', { name: '下一句', exact: true }).click()
  await actions.getByRole('button', { name: '继续', exact: true }).click()
}

const investigate = async (page: Page) => {
  await act(page, '询问北路斥候')
  await readDialogue(page, 3)
  await expect(page.locator('.world-story-actions').getByRole('button', { name: '邀请艾琳同行', exact: true })).toBeVisible()
}

const confront = async (page: Page, fallBack = false) => {
  await act(page, '前往采石场查证')
  await expect(page.locator('.world-story-feed')).toContainText('断裂的商队货封', { timeout: 25000 })
  await act(page, '对质黑岩使者')
  await readDialogue(page, 4)
  const actions = page.locator('.world-story-actions')
  await expect(actions.getByRole('button', { name: '退到庭院', exact: true })).toBeVisible()
  if (fallBack) {
    await act(page, '退到庭院')
    await expect(page.locator('.world-story-feed')).toContainText('罗兰退到庭院', { timeout: 25000 })
    await act(page, '守住灰鸦酒馆')
  } else {
    await act(page, '原地迎战')
  }
}

test('a shared clue unlocks an optional companion, survives reload, and changes the fight', async ({ page }, testInfo) => {
  await investigate(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.world-story-actions').getByRole('button', { name: '邀请艾琳同行', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('mobile-story-choice.png') })
  expect(await page.locator('.world-story-dock').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await act(page, '邀请艾琳同行')
  await readDialogue(page, 4)
  await expect(page.locator('.world-story-feed')).toContainText('正式加入调查')
  await confront(page, true)
  await expect(page.locator('.world-story-feed')).toContainText('桌边的空地')
  await expect(page.locator('.world-story-feed')).toContainText('商队仍有生还者', { timeout: 35000 })
  await expect(page.locator('.world-story-outcome')).toContainText('本章完成')
  await page.screenshot({ path: testInfo.outputPath('companion-victory.png') })
})

test('fighting immediately reaches a simulated ending that can be replayed', async ({ page }, testInfo) => {
  await investigate(page)
  await confront(page)
  await expect(page.locator('.world-story-outcome')).toContainText(/本章完成|停战撤退/, { timeout: 35000 })
  await expect(page.locator('.world-story-identity')).toContainText('罗兰')
  await page.screenshot({ path: testInfo.outputPath('solo-ending.png') })
  await page.getByRole('button', { name: '重新挑战', exact: true }).click()
  await expect(page.locator('.world-story-actions').getByRole('button', { name: '询问北路斥候', exact: true })).toBeVisible()
  await expect(page.locator('.world-story-outcome')).toHaveCount(0)
})

test('the story dock updates after revival and keeps the next action draft', async ({ page }) => {
  // Isolate the composer state from provider availability and request billing.
  await page.evaluate(async () => {
    const reactPath = '/brick-flow-agent/node_modules/.vite/deps/react.js'
    const domPath = '/brick-flow-agent/node_modules/.vite/deps/react-dom_client.js'
    const dockPath = '/brick-flow-agent/src/components/WorldStoryDock.tsx'
    const i18nPath = '/brick-flow-agent/src/lib/i18n.tsx'
    const scenarioPath = '/brick-flow-agent/src/data/worldScenarios.ts'
    const reactModule = await import(reactPath)
    const React = reactModule.default ?? reactModule
    const domModule = await import(domPath)
    const createRoot = domModule.createRoot ?? domModule.default.createRoot
    const { WorldStoryDock } = await import(dockPath)
    const { I18nProvider } = await import(i18nPath)
    const { createDefaultWorldScenarios } = await import(scenarioPath)
    const asset = createDefaultWorldScenarios('zh-CN')[0]
    const world = asset.world
    const roland = world.entities.find((entity: { controller: string }) => entity.controller === 'player')
    const defeat = {
      ...asset.scenario,
      outcomeId: 'gray-raven-retreat',
      stages: asset.scenario.stages.map((stage: object) => ({ ...stage, status: 'completed' })),
    }
    const host = document.createElement('div')
    host.id = 'composer-state-test'
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:white'
    document.body.append(host)
    const root = createRoot(host)
    const render = (busy: boolean) => root.render(React.createElement(I18nProvider, null,
      React.createElement(WorldStoryDock, {
        world: {
          ...world,
          scenarios: [defeat],
          entities: world.entities.map((entity: { id: string }) => entity.id === roland.id
            ? { ...entity, health: busy ? 0 : 63 }
            : entity),
        },
        bricks: [], structures: [], openRequest: 0,
        llmConfigured: true, isLlmTesting: false, isDirectorThinking: busy,
        continuousAiDirectorEnabled: false, isAiActivityThinking: false,
        onGenerateStory() {}, onPlayActivity() {}, onPlayAiActivity: async () => undefined,
        onDirectWorld: async () => ({ requestMessage: '', responseMessage: '' }),
        onSetContinuousAiDirectorEnabled() {}, onStopDirector() {}, onCommitDirectorTurn() {},
        onReplayDirectorTurn: async () => {}, onReplayDirectorEntry: async () => {},
        onSelectEntity() {}, onOpenTavern() {}, onClose() {},
        onStoryAction: () => false, onAdvanceDialogue() {}, onResumeWorld() {},
      })))
    ;(window as unknown as { finishComposerTest: () => void }).finishComposerTest = () => render(false)
    render(true)
  })
  const dock = page.locator('#composer-state-test .world-story-dock')
  const outcome = dock.locator('.world-story-outcome')
  await expect(outcome).toContainText('罗兰倒下 · 停战撤退')
  await expect(dock.locator('.world-story-identity')).toContainText('已倒下')
  const composer = dock.locator('.world-story-composer')
  await composer.locator('textarea').fill('我想问艾琳，采石场里还有没有其他入口。')
  await expect(composer.getByRole('button', { name: '停止', exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as { finishComposerTest: () => void }).finishComposerTest())
  await expect(composer.locator('textarea')).toHaveValue('我想问艾琳，采石场里还有没有其他入口。')
  await expect(composer.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await expect(outcome).toContainText('本章结局 · 停战撤退')
  await expect(outcome).toContainText('罗兰已复活')
  await expect(outcome).not.toContainText('罗兰倒下')
  await expect(dock.locator('.world-story-identity')).not.toContainText('已倒下')
})
