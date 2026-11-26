import { expect, type Page } from '@playwright/test'
import { bridgeLabPlanPrefix, createBridgeLabPlan } from '../../../src/lib/bridgeLabExample'

export const importBridgeExample = async (page: Page) => {
  const plan = createBridgeLabPlan(bridgeLabPlanPrefix + 'fixture', 'Bridge reinforcement exercise', 'en-US')
  await page.evaluate(plan => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([JSON.stringify(plan)], 'bridge.json', { type: 'application/json' }))
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, plan)
  await expect(page.getByLabel('Current work title', { exact: true })).toHaveText(plan.title)
}
