import type { Page } from '@playwright/test'

export const renameCurrentWork = async (page: Page, title: string) => {
  await page.getByRole('button', { name: 'Work & Library', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Work & Library', exact: true })
  await dialog.getByLabel('Plan name').fill(title)
  await dialog.getByLabel('Close', { exact: true }).click()
}
