import { chromium, expect } from '@playwright/test'

// The lighthouse uses the ordinary asset library, editor and manual.
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(process.env.REPLICA_BASE_URL || 'http://127.0.0.1:4174/brick-flow-agent/')
await page.getByRole('button', { name: '素材库', exact: true }).click()
await page.getByPlaceholder('搜索成品、分类或提示词').fill('30023')
const asset = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'LEGO 30023 灯塔', exact: true }) })
await asset.getByRole('button', { name: '手册', exact: true }).click()
const manual = page.getByRole('dialog', { name: '搭建手册', exact: true })
await expect(manual.getByText('LEGO 30023 灯塔 · 25 个零件 · 9 页', { exact: true })).toBeVisible()
for (let step = 1; step <= 9; step++) {
  await expect(manual.getByRole('heading', { name: new RegExp(`^第 ${step} 页 · 官方第 ${step} 步：`) })).toBeVisible()
  if (step < 9) await manual.getByRole('button', { name: '下一页', exact: true }).click()
}
await manual.getByRole('button', { name: '关闭', exact: true }).click()
await asset.getByRole('button', { name: '加载', exact: true }).click()
await expect(page.getByRole('heading', { name: '4x4 Round Brick with Hole', exact: true })).toBeVisible()
await expect(page.getByRole('dialog', { name: '素材库' })).toHaveCount(0)
console.log(JSON.stringify({ nativeLighthouse: true, pieces: 25, officialSteps: 9, errors }))
await browser.close()
if (errors.length) process.exitCode = 1
