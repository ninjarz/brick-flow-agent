import * as esbuild from 'esbuild'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

const workspace = process.cwd()
const outputPath = join(workspace, 'src/data/officialPartColors.ts')
const dataDir = process.env.REBRICKABLE_DATA_DIR ?? join(tmpdir(), 'brick-flow-agent-rebrickable-colors')
const refresh = process.argv.includes('--refresh')

const sources = [
  {
    filename: 'elements.csv.gz',
    url: 'https://cdn.rebrickable.com/media/downloads/elements.csv.gz',
  },
  {
    filename: 'colors.csv.gz',
    url: 'https://cdn.rebrickable.com/media/downloads/colors.csv.gz',
  },
]

const brickColorOrder = [
  'red',
  'blue',
  'yellow',
  'green',
  'white',
  'black',
  'gray',
  'brown',
  'orange',
  'tan',
  'cyan',
  'lime',
  'pink',
  'trans-pink',
  'trans-red',
  'trans-blue',
  'trans-yellow',
  'trans-green',
  'trans-orange',
  'trans-cyan',
  'trans-lime',
  'trans-brown',
  'trans-black',
  'trans-clear',
]

const partAliases = {
  '4150p03': ['4150'],
  '4162p0g': ['4162'],
  // Rebrickable lists the modern 1x1 round plate under 6141 variants.
  '4073': ['6141', '6141a', '6141b'],
}

const exactColorBuckets = {
  'aqua': 'cyan',
  'bright light orange': 'orange',
  'bright light yellow': 'yellow',
  'chrome antique brass': 'tan',
  'chrome gold': 'yellow',
  'copper': 'orange',
  'coral': 'pink',
  'dark azure': 'cyan',
  'dark nougat': 'brown',
  'dark turquoise': 'cyan',
  'fabuland brown': 'brown',
  'flat dark gold': 'yellow',
  'glow in dark opaque': 'white',
  'glow in dark trans': 'white',
  'glow in dark white': 'white',
  'light blue': 'cyan',
  'light nougat': 'tan',
  'light orange': 'orange',
  'light salmon': 'pink',
  'light turquoise': 'cyan',
  'medium azure': 'cyan',
  'medium blue': 'cyan',
  'medium lime': 'lime',
  'medium nougat': 'tan',
  'medium orange': 'orange',
  'medium tan': 'tan',
  'metallic gold': 'yellow',
  'milky white': 'white',
  'nougat': 'tan',
  'pearl gold': 'yellow',
  'salmon': 'pink',
  'speckle black-copper': 'black',
  'speckle dbgray-silver': 'gray',
  'trans-bright green': 'lime',
  'trans-clear': 'white',
  'trans-dark pink': 'trans-pink',
  'trans-light purple': 'trans-pink',
  'trans-neon green': 'lime',
  'trans-neon yellow': 'lime',
  'trans-pink': 'trans-pink',
  'trans-purple': 'trans-pink',
  'very light orange': 'orange',
  'vibrant yellow': 'yellow',
  'warm gold': 'yellow',
}

const csvRows = (text) => {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        value += character
      }
    } else if (character === '"') {
      quoted = true
    } else if (character === ',') {
      row.push(value)
      value = ''
    } else if (character === '\n') {
      row.push(value.replace(/\r$/, ''))
      rows.push(row)
      row = []
      value = ''
    } else {
      value += character
    }
  }

  if (value || row.length) {
    row.push(value.replace(/\r$/, ''))
    rows.push(row)
  }

  const [headers, ...records] = rows
  return records
    .filter((record) => record.length === headers.length)
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])))
}

const downloadSource = async ({ filename, url }) => {
  const destination = join(dataDir, filename)
  if (!refresh && existsSync(destination)) return destination

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()))
  return destination
}

const loadCurrentPartNumbers = async () => {
  const bundle = await esbuild.build({
    stdin: {
      contents: `
        import { brickDefinitions } from ${JSON.stringify(join(workspace, 'src/data/basicBricks.ts'))};
        export const partNumbers = Array.from(new Set(brickDefinitions.filter((definition) => definition.pack === 'lego').map((definition) => definition.partNumber)));
      `,
      loader: 'ts',
      resolveDir: workspace,
      sourcefile: 'entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  })

  const source = bundle.outputFiles[0].text
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  return (await import(moduleUrl)).partNumbers
}

const mapRebrickableColor = (name, isTransparent = false) => {
  const normalized = name.toLowerCase()
  if (isTransparent || normalized.startsWith('trans-')) {
    const baseColor = exactColorBuckets[normalized] ?? mapRebrickableColor(normalized.replace(/^trans-/, ''))
    if (!baseColor) return undefined
    if (baseColor.startsWith('trans-')) return baseColor
    const transparentBase = { white: 'clear', gray: 'black', tan: 'brown' }[baseColor] ?? baseColor
    return `trans-${transparentBase}`
  }
  if (exactColorBuckets[normalized]) return exactColorBuckets[normalized]
  if (normalized.includes('silver') || normalized.includes('gray') || normalized.includes('grey') || normalized.includes('chrome')) return 'gray'
  if (normalized.includes('black')) return 'black'
  if (normalized.includes('white') || normalized.includes('clear')) return 'white'
  if (
    normalized.includes('trans') &&
    (
      normalized.includes('purple') ||
      normalized.includes('violet') ||
      normalized.includes('lavender') ||
      normalized.includes('magenta') ||
      normalized.includes('pink')
    )
  ) return 'trans-pink'
  if (
    normalized.includes('purple') ||
    normalized.includes('violet') ||
    normalized.includes('lavender') ||
    normalized.includes('magenta') ||
    normalized.includes('pink')
  ) return 'pink'
  if (normalized.includes('lime')) return 'lime'
  if (
    normalized.includes('azure') ||
    normalized.includes('turquoise') ||
    normalized.includes('aqua') ||
    normalized.includes('medium blue') ||
    normalized.includes('light blue')
  ) return 'cyan'
  if (normalized.includes('blue')) return 'blue'
  if (normalized.includes('green')) return 'green'
  if (normalized.includes('yellow') || normalized.includes('gold')) return 'yellow'
  if (normalized.includes('orange') || normalized.includes('copper')) return 'orange'
  if (normalized.includes('tan') || normalized.includes('nougat') || normalized.includes('flesh') || normalized.includes('sand')) return 'tan'
  if (normalized.includes('brown') || normalized.includes('rust')) return 'brown'
  if (normalized.includes('red')) return 'red'
  return undefined
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getPartCandidateNumbers = (partNumber, colorsByPartNumber) => {
  const normalized = partNumber.toLowerCase()
  const candidates = new Set([normalized, ...(partAliases[normalized] ?? [])])

  if (!colorsByPartNumber.has(normalized)) {
    const variantPattern = new RegExp(`^${escapeRegExp(normalized)}[a-z]$`)
    for (const candidate of colorsByPartNumber.keys()) {
      if (variantPattern.test(candidate)) candidates.add(candidate)
    }
  }

  return [...candidates]
}

const serializeColors = (colors) => `[${colors.map((color) => `'${color}'`).join(', ')}]`

const main = async () => {
  await mkdir(dataDir, { recursive: true })
  const paths = Object.fromEntries(await Promise.all(
    sources.map(async (source) => [source.filename, await downloadSource(source)]),
  ))

  const colorRows = csvRows(gunzipSync(await readFile(paths['colors.csv.gz'])).toString('utf8'))
  const elementRows = csvRows(gunzipSync(await readFile(paths['elements.csv.gz'])).toString('utf8'))
  const rebrickableColors = new Map(colorRows.map((row) => [row.id, row]))
  const colorsByPartNumber = new Map()
  const unmappedColorNames = new Set()

  for (const element of elementRows) {
    const color = rebrickableColors.get(element.color_id)
    if (!color || color.id === '-1') continue

    const appColor = mapRebrickableColor(color.name, ['t', 'true', '1'].includes(String(color.is_trans).toLowerCase()))
    if (!appColor) {
      unmappedColorNames.add(color.name)
      continue
    }

    const partNumber = element.part_num.toLowerCase()
    if (!colorsByPartNumber.has(partNumber)) colorsByPartNumber.set(partNumber, new Set())
    colorsByPartNumber.get(partNumber).add(appColor)
  }

  const partNumbers = await loadCurrentPartNumbers()
  const generated = Object.fromEntries(
    partNumbers
      .sort((left, right) => Number(left) - Number(right) || left.localeCompare(right))
      .map((partNumber) => {
        const colors = new Set()
        for (const candidate of getPartCandidateNumbers(partNumber, colorsByPartNumber)) {
          for (const color of colorsByPartNumber.get(candidate) ?? []) {
            colors.add(color)
          }
        }

        return [partNumber, brickColorOrder.filter((color) => colors.has(color))]
      }),
  )

  const missing = Object.entries(generated)
    .filter(([, colors]) => colors.length === 0)
    .map(([partNumber]) => partNumber)
  if (missing.length > 0) {
    throw new Error(`Missing official color data for part numbers: ${missing.join(', ')}`)
  }

  const generatedOn = new Date().toISOString().slice(0, 10)
  const source = [
    "import type { BrickColor } from '../types/bricks'",
    '',
    `// Generated from Rebrickable elements.csv/colors.csv on ${generatedOn}.`,
    '// Re-run `npm run generate:part-colors` to refresh this coarse mapping.',
    '// Rebrickable color names are folded into the current BrickColor palette.',
    'export const officialPartColorsByPartNumber: Record<string, BrickColor[]> = {',
    ...Object.entries(generated).map(([partNumber, colors]) => `  '${partNumber}': ${serializeColors(colors)},`),
    '}',
    '',
    'export const getOfficialPartColors = (partNumber: string, fallback: BrickColor[]) =>',
    '  officialPartColorsByPartNumber[partNumber] ?? fallback',
    '',
  ].join('\n')

  await writeFile(outputPath, source)
  console.log(`Wrote ${outputPath}`)

  if (unmappedColorNames.size > 0) {
    console.warn(`Ignored unmapped Rebrickable colors: ${[...unmappedColorNames].sort().join(', ')}`)
  }
}

await main()
