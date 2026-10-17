// Audited, source-aligned native Architecture replicas. Official step membership is
// transcribed in architectureReplicaSources.json; original OMR files remain unchanged.
// Usage: node scripts/build-architecture-assets.mjs /path/to/geometry-audit.json
import * as esbuild from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const configs = JSON.parse(await readFile('scripts/architectureReplicaSources.json', 'utf8'))
const audit = JSON.parse(await readFile(process.argv[2], 'utf8'))
const frames = new Map(audit.audits.map((row) => [row.partNumber, row]))
const bundle = await esbuild.build({
  stdin: { contents: `export { brickDefinitions } from './src/data/basicBricks.ts'; export { transformBrickLocalPoint } from './src/lib/brickUnits.ts'; export { normalizeLDrawPartNumber } from './src/lib/ldrawPartNumbers.ts'`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const { brickDefinitions, transformBrickLocalPoint, normalizeLDrawPartNumber } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const definitions = new Map(brickDefinitions.filter((part) => part.pack === 'lego').map((part) => [normalizeLDrawPartNumber(part.partNumber), part]))
const numberOf = (name) => normalizeLDrawPartNumber(name === '6141.dat' ? '4073' : name)
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const multiply = (a, b) => Array.from({ length: 9 }, (_, index) => {
  const row = Math.floor(index / 3), column = index % 3
  return [0, 1, 2].reduce((sum, k) => sum + a[row * 3 + k] * b[k * 3 + column], 0)
})
const vector = (matrix, point) => [0, 1, 2].map((row) => point.reduce((sum, n, k) => sum + matrix[row * 3 + k] * n, 0))
const add = (a, b) => a.map((n, i) => n + b[i])
const colors = { 0: 'black', 15: 'white', 19: 'tan', 71: 'light-gray', 72: 'dark-gray', 297: 'pearl-gold' }
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
for (const config of configs) {
  const raw = await readFile(`public/lego-replicas/models/${config.set}-1.mpd`, 'utf8')
  if (createHash('sha256').update(raw).digest('hex') !== config.sha256) throw new Error(`Source changed: ${config.set}`)
  const files = new Map()
  let current = 'root'
  const lines = raw.split(/\r?\n/)
  if (!lines.some((line) => line.startsWith('0 FILE '))) files.set(current, lines)
  else for (const line of lines) {
    if (line.startsWith('0 FILE ')) { current = line.slice(7).toLowerCase(); files.set(current, []) }
    else if (files.has(current)) files.get(current).push(line)
  }
  const leaves = []
  const walk = (name, matrix = identity, translation = [0, 0, 0], inheritedColor = 16, stack = []) => {
    if (stack.includes(name)) throw new Error(`Recursive MPD: ${name}`)
    for (const line of files.get(name)) {
      if (!line.startsWith('1 ')) continue
      const fields = line.trim().split(/\s+/)
      const childName = fields.slice(14).join(' ').toLowerCase()
      const values = fields.slice(2, 14).map(Number)
      const nextMatrix = multiply(matrix, values.slice(3))
      const nextTranslation = add(translation, vector(matrix, values.slice(0, 3)))
      const color = Number(fields[1]) === 16 ? inheritedColor : Number(fields[1])
      if (files.has(childName)) walk(childName, nextMatrix, nextTranslation, color, [...stack, name])
      else leaves.push({ number: numberOf(childName), matrix: nextMatrix, translation: nextTranslation, color })
    }
  }
  walk(files.keys().next().value)
  const membership = config.groups.flat()
  if (membership.length !== config.pieces || new Set(membership).size !== config.pieces || membership.some((index) => index < 1 || index > config.pieces)) throw new Error(`Incomplete instruction membership: ${config.set}`)
  const plan = { id: config.id, title: config.title, prompt: `${config.title} 官方套装复刻`, source: 'template-local', bricks: [], steps: [] }
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
    const pose = { xStud: round(sourceOrigin[0] / 20 + config.offset[0] - localOrigin.x), yStud: round(-sourceOrigin[1] / 20 - localOrigin.y), zStud: round(sourceOrigin[2] / 20 + config.offset[1] - localOrigin.z), rotationQuarterTurns: orientation.pose.rotationQuarterTurns }
    if (orientation.pose.verticalQuarterTurns) pose.verticalQuarterTurns = orientation.pose.verticalQuarterTurns
    if (orientation.pose.rollQuarterTurns) pose.rollQuarterTurns = orientation.pose.rollQuarterTurns
    const color = colors[leaf.color]
    if (!definition.colors.includes(color)) throw new Error(`Missing colour ${leaf.color} on ${leaf.number}`)
    const brick = { id: `${config.id}-${plan.bricks.length + 1}`, brickId: definition.id, color, pose }
    plan.bricks.push(brick)
    const index = config.groups.findIndex((group) => group.includes(plan.bricks.length))
    if (index < 0) throw new Error(`No instruction step for ${brick.id}`)
    plan.steps[index] ??= { id: `${config.id}-step-${index + 1}`, title: `官方第 ${index + 1} 步：${config.titles[index]}`, description: `LEGO ${config.set} 官方说明书 ${config.pdf}，第 ${config.pages[index]} 页。${config.notes?.[index + 1] ?? ''}`, instructionStep: index + 1, brickIds: [] }
    plan.steps[index].brickIds.push(brick.id)
  }
  const order = new Map(config.groups.flat().map((number, index) => [`${config.id}-${number}`, index]))
  plan.bricks.sort((a, b) => order.get(a.id) - order.get(b.id))
  const groundOffset = -Math.min(...plan.bricks.map((brick) => brick.pose.yStud))
  for (const brick of plan.bricks) brick.pose.yStud = Math.round((brick.pose.yStud + groundOffset) * 10000) / 10000
  if (plan.bricks.length !== config.pieces || plan.steps.length !== config.pages.length || plan.steps.some((step) => !step)) throw new Error(`Unexpected assembly size or steps: ${config.set}`)
  await writeFile(`src/data/${config.output}.json`, `${JSON.stringify(plan, null, 2)}\n`)
  await mkdir(`docs/replicas/${config.set}`, { recursive: true })
  await writeFile(`docs/replicas/${config.set}/source-audit.json`, JSON.stringify({ author: config.author, source: `https://library.ldraw.org/library/omr/${config.set}-1.mpd`, license: 'CC BY 2.0', sha256: config.sha256, pieces: config.pieces, steps: plan.steps.map((step, i) => ({ instructionStep: i + 1, pdfPage: config.pages[i], addedPieces: step.brickIds.length })) }, null, 2) + '\n')
  console.log(`${config.title}: ${plan.bricks.length} editable pieces, ${plan.steps.length} official main steps`)
}
