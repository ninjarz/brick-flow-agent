// Convert Greg Teft's CC BY 2.0 OMR assembly into editable bricks, retaining the 52 official steps.
// Usage: node scripts/build-big-ben-asset.mjs /path/to/geometry-audit.json
import * as esbuild from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const raw = await readFile('public/lego-replicas/models/21013-1.mpd', 'utf8')
const audit = JSON.parse(await readFile(process.argv[2], 'utf8'))
const frames = new Map(audit.audits.map((row) => [row.partNumber, row]))
const bundle = await esbuild.build({
  stdin: { contents: `export { brickDefinitions } from './src/data/basicBricks.ts'; export { transformBrickLocalPoint, footprintToWorld } from './src/lib/brickUnits.ts'`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const { brickDefinitions, transformBrickLocalPoint } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const aliases = { '6141': '4073', '3794': '3794b', '3044': '3044b' }
const numberOf = (name) => {
  const stem = name.toLowerCase().replace(/\.dat$/, '')
  return /p[0-9a-z]+$/.test(stem) ? stem : aliases[stem.match(/^\d+/)?.[0]] ?? stem.match(/^\d+/)?.[0]
}
const definitions = new Map(brickDefinitions.filter((part) => part.pack === 'lego').map((part) => [part.partNumber, part]))
const files = new Map()
let current
for (const line of raw.split(/\r?\n/)) {
  if (line.startsWith('0 FILE ')) { current = line.slice(7).toLowerCase(); files.set(current, []) }
  else if (current) files.get(current).push(line)
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const multiply = (a, b) => Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3), column = index % 3
  return [0, 1, 2].reduce((sum, k) => sum + a[row * 3 + k] * b[k * 3 + column], 0)
})
const vector = (matrix, point) => [0, 1, 2].map((row) => point.reduce((sum, n, k) => sum + matrix[row * 3 + k] * n, 0))
const add = (a, b) => a.map((n, i) => n + b[i])
const leaves = []
const walk = (name, matrix = identity, translation = [0, 0, 0], inheritedColor = 16, officialStep = 1, isRoot = false, stack = []) => {
  if (stack.includes(name)) throw new Error(`Recursive MPD: ${name}`)
  for (const line of files.get(name)) {
    if (line === '0 STEP' && isRoot) officialStep++
    if (!line.startsWith('1 ')) continue
    const fields = line.split(/\s+/, 14)
    const childName = line.trim().split(/\s+/).slice(14).join(' ').toLowerCase()
    const values = fields.slice(2, 14).map(Number)
    const nextMatrix = multiply(matrix, values.slice(3))
    const nextTranslation = add(translation, vector(matrix, values.slice(0, 3)))
    const color = Number(fields[1]) === 16 ? inheritedColor : Number(fields[1])
    if (files.has(childName)) walk(childName, nextMatrix, nextTranslation, color, officialStep, false, [...stack, name])
    else leaves.push({ number: numberOf(childName), matrix: nextMatrix, translation: nextTranslation, color, officialStep })
  }
}
walk(files.keys().next().value, identity, [0, 0, 0], 16, 1, true)
const colors = { 0: 'black', 15: 'white', 19: 'tan', 71: 'light-gray', 72: 'dark-gray', 288: 'dark-green' }
const pages = [20,20,21,22,22,23,23,24,24,25,26,26,27,27,28,28,29,29,30,30,31,31,32,32,33,33,34,34,35,36,36,37,38,39,40,40,41,42,42,43,44,45,46,47,48,49,50,51,52,53,59,60]
const titles = ['底板右半','底板右侧收边','底板左半','中央收边与铭牌','底板左侧收边','外围石铺路','东侧定位板','前庭定位板','草坪与内侧铺路','建筑地基','地基光面板','前庭光面板','首层墙柱','首层内部连接','首层圆柱','第二层外墙柱','第二层侧向连接砖','钟塔底部连接','第二层墙体','外墙竖向格栅','楼层压顶','檐口与装饰','檐口光面板','檐口圆柱','内侧支撑','内墙收口','钟塔墙角','屋顶侧向支撑','屋顶端面','上层墙面格栅','屋檐底座','侧墙格栅','前墙格栅','四角屋檐','钟塔楼板','钟塔内部连接','第一段竖向格栅','第一段四角圆柱','中层楼板','中层连接结构','第二段竖向格栅','第二段四角圆柱','上层楼板','上层连接结构','第三段竖向格栅','第三段四角圆柱','钟室底板','钟室装饰圆板','钟室楼板','四面钟盘连接砖','钟室与尖塔总成','四面钟盘']
const plan = { id: 'lego-21013-big-ben', title: 'LEGO 21013 大本钟', prompt: 'LEGO Architecture 21013 大本钟官方套装复刻', source: 'template-local', bricks: [], steps: [] }
const zero = { xStud: 0, yStud: 0, zStud: 0, rotationQuarterTurns: 0 }
const keys = ['x', 'y', 'z']
const orientations = []
// Roll=0 comes first so existing models keep their traditional yaw/pitch representation.
for (let roll = 0; roll < 4; roll++) for (let yaw = 0; yaw < 4; yaw++) for (let pitch = 0; pitch < 4; pitch++) {
  const pose = { ...zero, rotationQuarterTurns: yaw, verticalQuarterTurns: pitch, rollQuarterTurns: roll }
  const unit = { footprint: { widthStuds: 1, heightStuds: 1, depthStuds: 1 } }
  const origin = transformBrickLocalPoint(unit, pose, { x: 0, y: 0, z: 0 })
  const columns = keys.map((axis) => {
    const point = transformBrickLocalPoint(unit, pose, { x: +(axis === 'x'), y: +(axis === 'y'), z: +(axis === 'z') })
    return keys.map((key) => point[key] - origin[key])
  })
  const matrix = Array.from({ length: 9 }, (_, i) => columns[i % 3][Math.floor(i / 3)])
  orientations.push({ pose, matrix })
}
for (const leaf of leaves) {
  const definition = definitions.get(leaf.number)
  const geometry = frames.get(leaf.number)
  if (!definition || !geometry) throw new Error(`Missing native catalogue part: ${leaf.number}`)
  if (geometry.horizontalAxisMapping !== 'direct') throw new Error(`Use source-aligned footprint: ${leaf.number}`)
  const flipY = [1, 0, 0, 0, -1, 0, 0, 0, 1]
  const target = multiply(multiply(flipY, leaf.matrix), flipY)
  const orientation = orientations.find((candidate) => candidate.matrix.every((n, index) => n === target[index]))
  if (!orientation) throw new Error(`Unsupported orientation: ${leaf.number}`)
  const frame = geometry.alignedFrame
  const sourceOrigin = add(leaf.translation, vector(leaf.matrix, [frame.minX, frame.maxY, frame.minZ]))
  const localOrigin = transformBrickLocalPoint(definition, orientation.pose, { x: 0, y: 0, z: 0 })
  const round = (n) => Math.round(n * 10000) / 10000
  const pose = { xStud: round(sourceOrigin[0] / 20 + 6 - localOrigin.x), yStud: round(-sourceOrigin[1] / 20 - localOrigin.y), zStud: round(sourceOrigin[2] / 20 + 5 - localOrigin.z), rotationQuarterTurns: orientation.pose.rotationQuarterTurns }
  if (orientation.pose.verticalQuarterTurns) pose.verticalQuarterTurns = orientation.pose.verticalQuarterTurns
  if (orientation.pose.rollQuarterTurns) pose.rollQuarterTurns = orientation.pose.rollQuarterTurns
  const color = colors[leaf.color]
  if (!definition.colors.includes(color)) throw new Error(`Missing colour ${leaf.color} on ${leaf.number}`)
  const brick = { id: `big-ben-${plan.bricks.length + 1}`, brickId: definition.id, color, pose }
  plan.bricks.push(brick)
  const index = leaf.officialStep - 1
  plan.steps[index] ??= { id: `big-ben-step-${leaf.officialStep}`, title: `官方第 ${leaf.officialStep} 步：${titles[index]}`, description: `LEGO 21013 官方说明书 6115609，第 ${pages[index]} 页。${leaf.officialStep === 51 ? '包含钟室和尖塔的 10 个装配子步骤。' : ''}`, instructionStep: leaf.officialStep, brickIds: [] }
  plan.steps[index].brickIds.push(brick.id)
}
if (plan.bricks.length !== 346 || plan.steps.length !== 52 || plan.steps.some((step) => !step)) throw new Error('Unexpected Big Ben assembly size or steps')
await writeFile('src/data/legoBigBenPlan.json', `${JSON.stringify(plan, null, 2)}\n`)
await mkdir('docs/replicas/21013', { recursive: true })
await writeFile('docs/replicas/21013/source-audit.json', JSON.stringify({ author: 'Greg Teft [gregteft]', source: 'https://library.ldraw.org/library/omr/21013-1.mpd', license: 'CC BY 2.0', sha256: createHash('sha256').update(raw).digest('hex'), pieces: 346, steps: plan.steps.map((step, i) => ({ instructionStep: i + 1, pdfPage: pages[i], addedPieces: step.brickIds.length })) }, null, 2) + '\n')
console.log(`Native Big Ben: ${plan.bricks.length} editable pieces, ${plan.steps.length} official steps`)
