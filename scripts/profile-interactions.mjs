/* global window, document, requestAnimationFrame, localStorage */
import { chromium, webkit } from '@playwright/test'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Build first. This profiler owns an isolated production server and browser.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(process.argv[2] ?? join(root, 'docs/performance-2026-11-15'))
const port = Number(process.env.BRICK_PROFILE_PORT ?? 4181)
const base = `http://127.0.0.1:${port}/brick-flow-agent/`
const engine = process.env.BRICK_PROFILE_BROWSER ?? 'chromium'
assert.ok(['chromium', 'webkit'].includes(engine), 'BRICK_PROFILE_BROWSER must be chromium or webkit')
const samples = [], memory = [], errors = [], rss = []
const stressEdits = Number(process.env.BRICK_PROFILE_STRESS_EDITS ?? 20)
const stressBlock = Number(process.env.BRICK_PROFILE_STRESS_BLOCK ?? 10)
const modelCycles = Number(process.env.BRICK_PROFILE_MODEL_CYCLES ?? 0)
const manualCycles = Number(process.env.BRICK_PROFILE_MANUAL_CYCLES ?? 0)
const gpuEnabled = process.env.BRICK_PROFILE_GPU === '1'
const sampleRss = process.env.BRICK_PROFILE_RSS === '1'
assert.ok([stressEdits, modelCycles, manualCycles].every(value => Number.isSafeInteger(value) && value >= 0))
assert.ok(Number.isSafeInteger(stressBlock) && stressBlock > 0)
const executeFile = promisify(execFile)
await mkdir(output, { recursive: true })
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-4000) })
server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-4000) })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let browser, page, processSession, rssTimer
let samplingRss = false
const metadata = { stressEdits, stressBlock, modelCycles, manualCycles, gpuEnabled, engine, date: new Date().toISOString(), platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model, viewport: { width: 1440, height: 1000 }, deviceScaleFactor: Number(process.env.BRICK_PROFILE_DPR ?? 2) }
metadata.buildIndexSha256 = createHash('sha256').update(await readFile(join(root, 'dist/index.html'))).digest('hex')
const persist = () => writeFile(join(output, 'measurements.json'), JSON.stringify({ metadata, samples, memory, rss, errors }, null, 2))
const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
async function measure(name, action) {
  await page.evaluate(name => { window.brickProfile.actionName = name; window.brickProfile.frames = []; window.brickProfile.tasks = []; window.brickProfile.last = performance.now() }, name).catch(() => {})
  let cpuSession
  if (process.env.BRICK_PROFILE_CPU === name && engine === 'chromium') {
    cpuSession = await page.context().newCDPSession(page)
    await cpuSession.send('Profiler.enable')
    await cpuSession.send('Profiler.start')
  }
  const start = performance.now()
  let detail
  try {
    detail = await action()
    await paint()
    const stats = await page.evaluate(() => {
      const profile = window.brickProfile
      const sorted = profile.frames.filter(value => value > 0).sort((a, b) => a - b)
      const gpu = profile.gpu.samples.filter(sample => sample.name === profile.actionName).map(sample => sample.ms).sort((a, b) => a - b)
      return { gpu: gpu.length ? { count: gpu.length, p50Ms: gpu[Math.floor(gpu.length * .5)], p95Ms: gpu[Math.floor(gpu.length * .95)], maxMs: gpu.at(-1) } : null, frameP95Ms: sorted[Math.floor(sorted.length * .95)] ?? null, maxFrameMs: sorted.at(-1) ?? null, longTasks: profile.longTasksSupported ? profile.tasks.length : null, longestTaskMs: Math.max(0, ...profile.tasks), gl: { ...profile.gl } }
    })
    samples.push({ name, ok: true, ms: performance.now() - start, ...stats, detail })
  } catch (error) {
    samples.push({ name, ok: false, ms: performance.now() - start, error: error.message })
  }
  if (cpuSession) {
    const { profile } = await cpuSession.send('Profiler.stop')
    await writeFile(join(output, 'operation.cpuprofile'), JSON.stringify(profile))
    await cpuSession.detach()
  }
  console.log(JSON.stringify(samples.at(-1)))
  await persist()
  return samples.at(-1)
}
async function ready() {
  await page.getByText('6025 parts', { exact: true }).waitFor({ timeout: 120_000 })
  await page.locator('[data-geometry-ready="true"]').waitFor({ timeout: 120_000 })
  await paint()
}
async function closeEditor() {
  const close = page.locator('.brick-editor-window').getByLabel('Close', { exact: true })
  if (await close.isVisible()) await close.click()
}
async function clear() {
  page.once('dialog', dialog => dialog.accept())
  await page.getByLabel('Clear Canvas', { exact: true }).click()
  await page.getByText('0 parts', { exact: true }).waitFor()
}
async function load() {
  await clear()
  await page.getByLabel('Asset Library', { exact: true }).click()
  const card = page.locator('.asset-card').filter({ has: page.getByRole('heading', { name: 'LEGO 71043 霍格沃茨城堡', exact: true }) })
  await card.getByRole('button', { name: 'Load', exact: true }).click()
  await ready()
  await closeEditor()
}
async function point(x, y) {
  const box = await page.locator('canvas').first().boundingBox()
  return { x: box.x + x * box.width, y: box.y + y * box.height }
}
async function selectGroup(size) {
  const candidates = size === 72 ? [[.45, .83], [.44, .84], [.43, .85], [.46, .82]] : [[.5, .65], [.55, .7], [.5, .5]]
  for (const [x, y] of candidates) {
    await closeEditor()
    const at = await point(x, y)
    await page.mouse.click(at.x, at.y)
    const card = page.locator('.selected-piece-card')
    if (!(await card.isVisible())) continue
    const text = await card.innerText()
    if (text.startsWith(`${size} selected parts`)) return at
  }
  throw new Error(`Could not select the ${size}-piece structure`)
}
const coordinates = () => page.locator('.brick-editor-window input[type=number]').evaluateAll(inputs => inputs.map(input => Number(input.value)))
async function setCoordinate(axis, value) {
  const input = page.locator('.brick-editor-window').getByLabel(axis, { exact: true })
  await input.fill(String(value))
  await input.press('Tab')
  await page.waitForFunction(({ axis, value }) => {
    const index = ['X', 'Y', 'Z'].indexOf(axis)
    return Math.abs(Number(document.querySelectorAll('.brick-editor-window input[type=number]')[index]?.value) - value) < 1e-5
  }, { axis, value }, { timeout: 30_000 })
}
async function nudge(key, holdMs = 0) {
  const before = await coordinates()
  if (holdMs) { await page.keyboard.down(key); await page.waitForTimeout(holdMs); await page.keyboard.up(key) }
  else await page.keyboard.press(key)
  await page.waitForFunction(before => {
    const current = [...document.querySelectorAll('.brick-editor-window input[type=number]')].map(input => Number(input.value))
    return current.length === before.length && current.some((value, i) => Math.abs(value - before[i]) > 1e-5)
  }, before, { timeout: 30_000 })
  return { before, after: await coordinates(), holdMs }
}
async function rotate(axis, value) {
  await page.locator('.brick-editor-window select').nth(axis).selectOption(String(value))
  await page.waitForFunction(({ axis, value }) => document.querySelectorAll('.brick-editor-window select')[axis]?.value === String(value), { axis, value }, { timeout: 30_000 })
}
async function exported(button = 'Export JSON') {
  const ready = page.waitForEvent('download', { timeout: 120_000 })
  await page.getByRole('button', { name: button, exact: true }).click()
  return readFile(await (await ready).path(), 'utf8')
}
async function snapshotMemory(label) {
  if (engine !== 'chromium') {
    memory.push({ label, unavailable: 'CDP heap metrics are Chromium-only', gl: await page.evaluate(() => ({ ...window.brickProfile.gl })) })
    await persist()
    return
  }
  const session = await page.context().newCDPSession(page)
  await session.send('HeapProfiler.collectGarbage')
  const heap = await session.send('Runtime.getHeapUsage')
  await session.detach()
  const workers = []
  // Dedicated workers have separate heaps. Measure them through their own CDP targets.
  const control = await browser.newBrowserCDPSession()
  const targets = await control.send('Target.getTargets')
  for (const target of targets.targetInfos.filter(target => target.type === 'worker' && target.url.startsWith(base))) {
    let attachment
    try {
      attachment = await control.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
      let nextId = 0
      const request = method => new Promise((resolve, reject) => {
        const id = ++nextId
        const timeout = setTimeout(() => { control.off('Target.receivedMessageFromTarget', handler); reject(new Error('Worker memory timeout')) }, 30_000)
        const handler = event => {
          if (event.sessionId !== attachment.sessionId) return
          const response = JSON.parse(event.message)
          if (response.id !== id) return
          clearTimeout(timeout); control.off('Target.receivedMessageFromTarget', handler)
          if (response.error) reject(new Error(response.error.message)); else resolve(response.result)
        }
        control.on('Target.receivedMessageFromTarget', handler)
        control.send('Target.sendMessageToTarget', { sessionId: attachment.sessionId, message: JSON.stringify({ id, method }) }).catch(error => { clearTimeout(timeout); control.off('Target.receivedMessageFromTarget', handler); reject(error) })
      })
      await request('HeapProfiler.collectGarbage')
      workers.push({ target: target.url.split('/').at(-1), ...(await request('Runtime.getHeapUsage')) })
    } catch (error) { workers.push({ target: target.url.split('/').at(-1), error: error.message }) }
    finally { if (attachment) await control.send('Target.detachFromTarget', { sessionId: attachment.sessionId }).catch(() => {}) }
  }
  await control.detach()
  const gl = await page.evaluate(() => ({ ...window.brickProfile.gl }))
  const entry = { label, heap, workers, gl }
  memory.push(entry)
  console.log(JSON.stringify({ memory: entry }))
  await persist()
}

try {
  const deadline = performance.now() + 20_000
  for (;;) {
    if (server.exitCode !== null) throw new Error(serverLog)
    try { if ((await fetch(base)).ok) break } catch { /* Wait for this profiler's server. */ }
    if (performance.now() > deadline) throw new Error(`Preview startup timed out ${serverLog}`)
    await delay(100)
  }
  browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await chromium.launch({ channel: 'chromium', headless: true })
  metadata.browser = browser.version()
  page = await browser.newPage({ viewport: metadata.viewport, deviceScaleFactor: metadata.deviceScaleFactor })
  if (sampleRss && engine === 'chromium') {
    processSession = await browser.newBrowserCDPSession()
    rssTimer = setInterval(async () => {
      if (samplingRss) return
      samplingRss = true
      try {
        const { processInfo } = await processSession.send('SystemInfo.getProcessInfo')
        const { stdout } = await executeFile('ps', ['-o', 'pid=,rss=', '-p', processInfo.map(item => item.id).join(',')])
        const byPid = new Map(stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number)))
        const processes = processInfo.map(item => ({ type: item.type, pid: item.id, rssBytes: (byPid.get(item.id) ?? 0) * 1024 }))
        rss.push({ elapsedMs: performance.now(), bytes: processes.reduce((sum, item) => sum + item.rssBytes, 0), processes })
      } catch (error) { if (!rss.some(sample => sample.error)) rss.push({ error: error.message }) }
      finally { samplingRss = false }
    }, 1000)
  }
  page.setDefaultTimeout(30_000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(({ gpuEnabled }) => {
    localStorage.setItem('brick-flow-agent:locale:v1', 'en-US')
    const profile = window.brickProfile = { frames: [], tasks: [], last: performance.now(), gl: { activeBuffers: 0, bufferBytes: 0, createdBuffers: 0, deletedBuffers: 0, uploadBytes: 0 } }
    profile.gpu = { enabled: gpuEnabled, supportedContexts: 0, unsupportedContexts: 0, samples: [] }
    const gpuContexts = []
    const tick = time => {
      for (let i = gpuContexts.length - 1; i >= 0; i--) {
        const state = gpuContexts[i], gl = state.gl
        if (!gl.canvas.isConnected || gl.isContextLost()) {
          for (const item of state.pending) gl.deleteQuery(item.query)
          gpuContexts.splice(i, 1)
          continue
        }
        const disjoint = gl.getParameter(state.extension.GPU_DISJOINT_EXT)
        state.pending = state.pending.filter(item => {
          const available = gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)
          if (!available && !disjoint) return true
          if (available && !disjoint && profile.gpu.samples.length < 12000) profile.gpu.samples.push({ name: item.name, ms: gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6 })
          gl.deleteQuery(item.query)
          return false
        })
      } if (profile.frames.length < 12000) profile.frames.push(time - profile.last); profile.last = time; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    profile.longTasksSupported = PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false
    if (profile.longTasksSupported) new PerformanceObserver(list => { for (const entry of list.getEntries()) profile.tasks.push(entry.duration) }).observe({ type: 'longtask', buffered: false })
    for (const Type of [window.WebGL2RenderingContext ?? window.WebGLRenderingContext]) {
      if (!Type) continue
      const sizes = new WeakMap(), bindings = new WeakMap(), prototype = Type.prototype
      if (gpuEnabled) {
        const states = new WeakMap()
        for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const draw = prototype[method]
          prototype[method] = function (...args) {
            if (!states.has(this)) {
              const extension = this.getExtension('EXT_disjoint_timer_query_webgl2')
              const state = extension ? { gl: this, extension, active: false, pending: [] } : null
              states.set(this, state)
              if (state) { gpuContexts.push(state); profile.gpu.supportedContexts++ }
              else profile.gpu.unsupportedContexts++
            }
            const state = states.get(this)
            if (state && !state.active && state.pending.length < 8 && !this.getQuery(state.extension.TIME_ELAPSED_EXT, this.CURRENT_QUERY)) {
              const query = this.createQuery(), name = profile.actionName
              this.beginQuery(state.extension.TIME_ELAPSED_EXT, query)
              state.active = true
              queueMicrotask(() => {
                if (!this.isContextLost()) { this.endQuery(state.extension.TIME_ELAPSED_EXT); state.pending.push({ query, name }) }
                state.active = false
              })
            }
            return draw.apply(this, args)
          }
        }
      }
      const create = prototype.createBuffer, remove = prototype.deleteBuffer, bind = prototype.bindBuffer, data = prototype.bufferData, update = prototype.bufferSubData
      prototype.createBuffer = function (...args) { const buffer = create.apply(this, args); if (buffer) { sizes.set(buffer, 0); profile.gl.activeBuffers++; profile.gl.createdBuffers++ } return buffer }
      prototype.bindBuffer = function (target, buffer) { let context = bindings.get(this); if (!context) { context = new Map(); bindings.set(this, context) } context.set(target, buffer); return bind.call(this, target, buffer) }
      prototype.bufferData = function (target, value, ...args) {
        const buffer = bindings.get(this)?.get(target), bytes = typeof value === 'number' ? value : value?.byteLength ?? 0
        if (buffer && sizes.has(buffer)) { profile.gl.bufferBytes += bytes - sizes.get(buffer); sizes.set(buffer, bytes) }
        profile.gl.uploadBytes += bytes
        return data.call(this, target, value, ...args)
      }
      prototype.bufferSubData = function (target, offset, value, start, length) { profile.gl.uploadBytes += length ? length * (value.BYTES_PER_ELEMENT ?? 1) : value?.byteLength ?? 0; return update.apply(this, arguments) }
      prototype.deleteBuffer = function (buffer) { if (buffer && sizes.has(buffer)) { profile.gl.bufferBytes -= sizes.get(buffer); sizes.delete(buffer); profile.gl.activeBuffers--; profile.gl.deletedBuffers++ } return remove.call(this, buffer) }
    }
  }, { gpuEnabled })
  await measure('empty page navigation', async () => { await page.goto(base); await page.getByText('Saved in this browser', { exact: true }).waitFor() })
  await measure('load complete Hogwarts', load)
  await page.screenshot({ path: join(output, 'loaded.png') })
  const blank = await point(.12, .85)
  await measure('orbit 30 events', async () => { await page.mouse.move(blank.x, blank.y); await page.mouse.down(); await page.mouse.move(blank.x + 90, blank.y - 35, { steps: 30 }); await page.mouse.move(blank.x, blank.y, { steps: 30 }); await page.mouse.up() })
  await measure('pan 30 events', async () => { await page.mouse.move(blank.x, blank.y); await page.mouse.down({ button: 'right' }); await page.mouse.move(blank.x + 60, blank.y + 20, { steps: 30 }); await page.mouse.move(blank.x, blank.y, { steps: 30 }); await page.mouse.up({ button: 'right' }) })
  for (const direction of [-1, 1]) await measure(`wheel ${direction}`, async () => { await page.mouse.wheel(0, direction * 300); await page.waitForTimeout(500); return { observationMs: 500 } })
  await measure('unselected WASD camera navigation', async () => { for (const key of ['w', 'a', 's', 'd']) await page.keyboard.press(key) })
  // Reload the library asset to make the selection coordinates reproducible after camera tests.
  await load()
  await measure('select 2643-piece structure', () => selectGroup(2643))
  await measure('cold large group lift', async () => { const before = await coordinates(); await setCoordinate('Y', before[1] + 100) })
  await page.locator('.selected-piece-card').click()
  for (let i = 0; i < 3; i++) await measure(`large group W ${i + 1}`, () => nudge('w'))
  for (const axis of [0, 1]) for (let i = 0; i < 3; i++) await measure(`large group rotation ${axis} sample ${i + 1}`, () => rotate(axis, i % 2 ? 0 : 1))
  const beforeHold = JSON.parse(await exported()).plan
  await snapshotMemory('large scene warm')
  await page.locator('.selected-piece-card').click()
  await measure('hold large group W 1000ms', () => nudge('w', 1000))
  const afterHold = JSON.parse(await exported()).plan
  await measure('undo held movement', async () => { await page.getByLabel('Undo', { exact: true }).click() })
  assert.deepEqual(JSON.parse(await exported()).plan.bricks, beforeHold.bricks)
  await measure('redo held movement', async () => { await page.getByLabel('Redo', { exact: true }).click() })
  assert.deepEqual(JSON.parse(await exported()).plan.bricks, afterHold.bricks)
  await load()
  const hutPoint = await selectGroup(72)
  await measure('ground drag preserves hut selection', async () => { const text = await page.locator('.selected-piece-card').innerText(); await page.mouse.move(blank.x, blank.y); await page.mouse.down(); await page.mouse.move(blank.x + 20, blank.y, { steps: 4 }); await page.mouse.move(blank.x, blank.y, { steps: 4 }); await page.mouse.up(); assert.equal(await page.locator('.selected-piece-card').innerText(), text) })
  await measure('blank click clears selection', async () => { await page.mouse.click(blank.x, blank.y); await page.locator('.brick-editor-window').waitFor({ state: 'hidden' }) })
  await page.mouse.click(hutPoint.x, hutPoint.y)
  const placement = page.getByText('Move to position · Left-click to confirm · Right-click or Esc to cancel', { exact: true })
  await measure('hut longpress and cancel placement', async () => { await page.mouse.move(hutPoint.x, hutPoint.y); await page.mouse.down(); await placement.waitFor(); await page.mouse.up(); await page.mouse.move(hutPoint.x - 30, hutPoint.y, { steps: 10 }); await page.keyboard.press('Escape'); await placement.waitFor({ state: 'hidden' }) })
  await measure('hut longpress and confirm placement', async () => { await page.mouse.move(hutPoint.x, hutPoint.y); await page.mouse.down(); await placement.waitFor(); await page.mouse.up(); await page.mouse.move(blank.x, blank.y, { steps: 12 }); await page.mouse.click(blank.x, blank.y); await placement.waitFor({ state: 'hidden', timeout: 60_000 }) })
  if (!(await page.locator('.selected-piece-card').isVisible())) throw new Error('Hut selection lost after placement')
  await measure('hut lift', async () => { const before = await coordinates(); await setCoordinate('Y', before[1] + 30) })
  await page.locator('.selected-piece-card').click()
  for (let i = 0; i < 3; i++) await measure(`hut W ${i + 1}`, () => nudge('w'))
  for (const axis of [0, 1]) await measure(`hut rotation ${axis}`, () => rotate(axis, 1))
  await snapshotMemory('before repeated hut edits')
  for (let block = 0; block < Math.ceil(stressEdits / stressBlock); block++) {
    await page.locator('.selected-piece-card').click()
    for (let i = 0; i < Math.min(stressBlock, stressEdits - block * stressBlock); i++) await measure(`stress block ${block + 1} step ${i + 1}`, () => nudge(i % 2 ? 's' : 'w'))
    await exported() // Wait behind pending background analysis before taking heap samples.
    await snapshotMemory(`after ${Math.min(stressEdits, (block + 1) * stressBlock)} hut edits`)
  }
  await measure('dissolve hut', async () => { await page.getByRole('button', { name: 'Dissolve', exact: true }).click(); await page.getByRole('button', { name: 'Duplicate', exact: true }).waitFor() })
  await measure('single part position', async () => { const before = await coordinates(); await setCoordinate('Y', before[1] + 10) })
  await page.locator('.selected-piece-card').click()
  await measure('single part W', () => nudge('w'))
  await measure('duplicate part', async () => { await page.getByRole('button', { name: 'Duplicate', exact: true }).click(); await page.getByText('6026 parts', { exact: true }).waitFor() })
  await measure('delete duplicate', async () => { await page.locator('.brick-editor-window').getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByText('6025 parts', { exact: true }).waitFor() })
  await load()
  await measure('cold manual open', async () => { await page.getByRole('button', { name: 'Build Manual', exact: true }).click(); await page.locator('.manual-preview').waitFor({ timeout: 60_000 }) })
  await measure('manual assembled view', async () => { await page.locator('.manual-timeline-actions input[type=checkbox]').uncheck() })
  await measure('manual exploded view', async () => { await page.locator('.manual-timeline-actions input[type=checkbox]').check() })
  await measure('manual autoplay and pause', async () => {
    await page.locator('.manual-timeline-actions select').selectOption('650')
    await page.locator('.manual-timeline-actions button').first().click()
    await page.waitForFunction(() => Number(document.querySelector('.manual-timeline input[type=range]')?.value) > 0)
    await page.locator('.manual-timeline-actions button').first().click()
    await page.locator('.manual-timeline-actions button').nth(1).click()
    assert.equal(await page.locator('.manual-timeline input[type=range]').inputValue(), '0')
    return { playbackIntervalMs: 650 }
  })
  for (const key of ['ArrowRight', 'ArrowLeft']) await measure(`manual ${key}`, async () => { const slider = page.locator('.manual-timeline input[type=range]'); const before = Number(await slider.inputValue()); await page.keyboard.press(key); await page.waitForFunction(expected => Number(document.querySelector('.manual-timeline input[type=range]')?.value) === expected, before + (key === 'ArrowRight' ? 1 : -1)) })
  await measure('manual last step', async () => { await page.locator('.manual-timeline input[type=range]').fill('818'); await page.locator('.manual-preview [data-geometry-ready="true"]').waitFor({ timeout: 60_000 }) })
  for (let cycle = 0; cycle < manualCycles; cycle++) {
    for (const step of [400, 818]) await measure(`manual repeat ${cycle + 1} step ${step}`, async () => {
      await page.locator('.manual-timeline input[type=range]').fill(String(step))
      await page.locator('.manual-preview [data-geometry-ready="true"]').waitFor({ timeout: 60_000 })
    })
  }
  await page.screenshot({ path: join(output, 'manual-final.png') })
  let markdown
  await measure('manual Markdown export', async () => { markdown = await exported('Export Markdown'); assert.match(markdown, /6025/) })
  await measure('manual JSON export', async () => { const manual = JSON.parse(await exported('Export manual JSON')); assert.equal(manual.totalPieces, 6025); assert.equal(manual.steps.length, 819) })
  await measure('manual HTML export', async () => { const html = await exported('Export HTML'); assert.match(html, /<html/i); assert.match(html, /6025/); assert.match(html, /819/) })
  await measure('copy manual Markdown', async () => {
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.brickCopiedText = text } } }))
    await page.getByRole('button', { name: 'Copy Markdown', exact: true }).click()
    assert.equal(await page.evaluate(() => window.brickCopiedText), markdown)
    return { clipboardApi: 'stubbed in isolated test page' }
  })

  await page.keyboard.press('Escape')
  await measure('warm JSON export', async () => { const data = JSON.parse(await exported()); assert.equal(data.plan.bricks.length, 6025); assert.equal(data.manual.totalPieces, 6025); assert.equal(data.manual.steps.length, 819); assert.equal(data.manual.steps.at(-1).completedPieceCount, 6025) })
  await measure('LDraw export', async () => {
    const text = await exported('Export LDraw')
    assert.equal(text.split('\n').filter(line => line.startsWith('1 ')).length, 6025)
    const metadata = text.split('\n').filter(line => line.startsWith('0 !BRICK_FLOW_AGENT_PLAN ')).map(line => line.split(' ').at(-1)).join('')
    const embedded = JSON.parse(Buffer.from(metadata, 'base64').toString('utf8'))
    assert.equal(embedded.bricks.length, 6025)
    assert.equal(embedded.steps.length, 819)
    return { referenceCount: 6025, embeddedPieces: embedded.bricks.length }
  })
  await measure('reload persisted scene', async () => { await page.reload(); await ready() })
  for (let cycle = 0; cycle < modelCycles; cycle++) await measure(`model reload cycle ${cycle + 1}`, load)
  await measure('clear scene', clear)
  if (engine === 'chromium') {
  const control = await browser.newBrowserCDPSession()
  const retireDeadline = performance.now() + 30_000
  while ((await control.send('Target.getTargets')).targetInfos.some(target => target.type === 'worker' && target.url.startsWith(base) && target.url.includes('editorAnalysisWorker'))) {
    if (performance.now() > retireDeadline) throw new Error('Analysis workers did not retire after canvas clear')
    await delay(100)
  }
  await control.detach()
  }
  // Passive effects and renderer disposal may trail the DOM count update.
  await page.waitForTimeout(1000)
  await paint()
  await snapshotMemory('cleared scene')
  if (engine === 'webkit') {
    await page.waitForTimeout(9000)
    await paint()
    await snapshotMemory('cleared scene after 10 seconds')
  }
  if (process.env.BRICK_PROFILE_MEMORY_PRESSURE === '1' && processSession) {
    try {
      await processSession.send('Memory.simulatePressureNotification', { level: 'critical' })
      await page.waitForTimeout(2000)
      await snapshotMemory('after diagnostic memory pressure')
    } catch (error) { metadata.memoryPressureUnavailable = error.message }
  }
  metadata.gpu = await page.evaluate(() => window.brickProfile.gpu)
} catch (error) {
  errors.push(error.stack ?? error.message)
} finally {
  clearInterval(rssTimer)
  await processSession?.detach().catch(() => {})
  await persist()
  await browser?.close()
  server.kill('SIGTERM')
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))
}
const rows = samples.map(sample => `| ${sample.name} | ${sample.ok ? Math.round(sample.ms) : '失败'} | ${sample.frameP95Ms == null ? '—' : Math.round(sample.frameP95Ms)} | ${sample.maxFrameMs == null ? '—' : Math.round(sample.maxFrameMs)} | ${sample.longTasks ?? '—'} |`)
const report = ['# 完整场景交互实测', '', '使用生产构建、独立浏览器与本机预览服务。时间包含自动化输入和两次RAF，长任务由PerformanceObserver记录。滚轮观察期500ms与持续按键1000ms均包含在总时长内。GPU计数为WebGL缓冲区API层统计，堆数据为GC后的V8使用量，均不等同进程RSS或显存总量。', '', `环境为 ${metadata.platform} ${metadata.arch}，${metadata.cpu}，${metadata.engine} ${metadata.browser}，1440×1000，DPR${metadata.deviceScaleFactor}。`, '', '| 操作 | 总耗时ms | RAF P95 ms | 最大RAF间隔ms | 长任务数 |', '|---|---:|---:|---:|---:|', ...rows, '', '## 内存与资源', '', '详见 measurements.json 中的 memory 字段，包含主页面、各工作线程和WebGL缓冲区计数。', '', '## 测试状态', '', `成功操作 ${samples.filter(sample => sample.ok).length}，失败操作 ${samples.filter(sample => !sample.ok).length}，运行错误 ${errors.length}。`, '', '本测试覆盖大场景编辑与手册路径，模型生成和第三方API服务另有单元测试，未在此调用外部付费接口。', ''].join('\n')
await writeFile(join(output, 'interaction-results.md'), report)
if (errors.length || samples.some(sample => !sample.ok)) process.exitCode = 1
console.log(`Report ${output}`)
