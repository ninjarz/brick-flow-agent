import { chromium } from '@playwright/test'

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'warning' || message.type() === 'error') errors.push(message.text())
})
page.on('response', (response) => {
  if (response.status() >= 400 && response.url().includes('lego-replicas')) {
    errors.push(`${response.status()} ${response.url()}`)
  }
})
await page.goto(process.env.REPLICA_BASE_URL || 'http://127.0.0.1:4174/brick-flow-agent/')
await page.getByRole('button', { name: '素材库' }).click()
await page.getByRole('button', { name: '乐高复刻' }).click()
for (const number of (process.argv.slice(2).length ? process.argv.slice(2) : ['8099', '10124', '10030'])) {
  const started = Date.now()
  await page.locator('.lego-replica-select button').filter({ hasText: number }).click()
  await page.locator('.lego-replica-loading').waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('.lego-replica-loading').waitFor({ state: 'hidden', timeout: 120_000 })
  await page.getByLabel('搭建步骤').waitFor({ timeout: 120_000 })
  const slider = page.getByLabel('搭建步骤')
  const range = await slider.inputValue()
  await slider.focus()
  await slider.press('Home')
  if (await slider.inputValue() !== '0') throw new Error(`${number}: start step failed`)
  await page.getByRole('button', { name: '聚焦当前' }).click()
  await page.waitForTimeout(number === '10030' ? 1500 : 250)
  await page.screenshot({ path: `/tmp/brick-flow-replica-${number}-start.png` })
  await page.getByRole('button', { name: '完成' }).click()
  if (await slider.inputValue() !== range) throw new Error(`${number}: finish step failed`)
  await page.waitForTimeout(number === '10030' ? 1500 : 250)
  await page.screenshot({ path: `/tmp/brick-flow-replica-${number}.png` })
  console.log(`${number}: loaded in ${Date.now() - started} ms; final step ${range}; playback controls passed`)
}
console.log(JSON.stringify({ errors }))
await browser.close()
if (errors.length) process.exitCode = 1
