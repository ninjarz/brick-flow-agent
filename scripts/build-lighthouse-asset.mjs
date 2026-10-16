// Convert the independently authored official steps into the editor's native model format.
// Usage: node scripts/build-lighthouse-asset.mjs /path/to/generate-ldraw-structural-output.json
import { readFile, writeFile } from 'node:fs/promises'

if (!process.argv[2]) throw new Error('Pass the geometry generator audit JSON path')
const audit = JSON.parse(await readFile(process.argv[2], 'utf8'))
const frames = new Map(audit.audits.map((row) => [row.partNumber, row]))
const manifest = JSON.parse(await readFile('src/data/legoReplicaManifest.json', 'utf8')).find((item) => item.number === '30023')
const definitions = {
  3031: ['plate-4x4', 4, 4], 3700: ['technic-brick-1x2-hole', 2, 1],
  3001: ['brick-2x4', 4, 2], 3039: ['slope-2x2', 2, 2],
  87081: ['brick-round-4x4-hole', 4, 4], 54200: ['slope-cheese-1x1', 1, 1],
  85080: ['brick-round-corner-2x2', 2, 2], 2419: ['plate-cut-corners-3x6', 6, 3],
  3941: ['brick-round-2x2-axle', 2, 2], 6141: ['round-1x1-plate', 1, 1],
  43898: ['dish-3x3', 3, 3],
}
const colors = { 0: 'black', 2: 'green', 4: 'red', 15: 'white', 46: 'trans-yellow', 70: 'brown', 71: 'light-gray', 72: 'dark-gray' }
const yawMatrices = [[1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0]]
const round = (value) => Number(value.toFixed(4))
const plan = { id: 'lego-30023-lighthouse', title: 'LEGO 30023 灯塔', prompt: 'LEGO Creator 30023 官方灯塔复刻', source: 'template-local', bricks: [], steps: [] }
let stepIndex = 0
for (const line of (await readFile('public/lego-replicas/models/30023-1.mpd', 'utf8')).split('\n')) {
  if (line === '0 STEP') { stepIndex++; continue }
  if (!line.startsWith('1 ')) continue
  const tokens = line.split(/\s+/)
  const color = colors[tokens[1]]
  const [tx, ty, tz, a, , c, , , , g, , i] = tokens.slice(2, 14).map(Number)
  const number = Number(tokens[14].match(/^\d+/)[0])
  const [brickId, width, depth] = definitions[number]
  const { alignedFrame: frame, horizontalAxisMapping } = frames.get(String(number === 6141 ? 4073 : number))
  if (horizontalAxisMapping !== 'direct') throw new Error(`Unexpected source axes: ${number}`)
  const rotation = yawMatrices.findIndex((matrix) => matrix.every((value, index) => value === [a, c, g, i][index]))
  if (rotation < 0 || !color) throw new Error(`Unsupported reference: ${line}`)
  const [ox, oz] = [[0, 0], [depth, 0], [width, depth], [0, width]][rotation]
  const brick = { id: `lighthouse-${plan.bricks.length + 1}`, brickId, color, pose: {
    xStud: round((tx + a * frame.minX + c * frame.minZ) / 20 + 3 - ox),
    yStud: round((8 - ty - frame.maxY) / 20),
    zStud: round((tz + g * frame.minX + i * frame.minZ) / 20 + 3 - oz),
    rotationQuarterTurns: rotation,
  } }
  plan.bricks.push(brick)
  if (!plan.steps[stepIndex]) {
    const info = manifest.manualSteps[stepIndex]
    plan.steps[stepIndex] = { id: `lighthouse-step-${stepIndex + 1}`, title: `官方第 ${stepIndex + 1} 步：${info.title}`, description: `官方说明书第 ${info.page} 页。${info.check}`, instructionStep: stepIndex + 1, brickIds: [] }
  }
  plan.steps[stepIndex].brickIds.push(brick.id)
}
await writeFile('src/data/legoLighthousePlan.json', `${JSON.stringify(plan, null, 2)}\n`)
console.log(`Native lighthouse: ${plan.bricks.length} editable pieces, ${plan.steps.length} official steps`)
