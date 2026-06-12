import * as esbuild from 'esbuild'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname as pathDirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const completeZipUrl = 'https://library.ldraw.org/library/updates/complete.zip'
const workspace = process.cwd()
const tempDir = await mkdtemp(join(tmpdir(), 'brick-flow-agent-ldraw-download-'))
const entry = join(tempDir, 'entry.ts')
const outfile = join(tempDir, 'entry.mjs')
const cacheDir = join(workspace, '.cache/ldraw')
const zipPath = join(cacheDir, 'complete.zip')
const publicLDrawDir = join(workspace, 'public/ldraw')

await writeFile(entry, `
  import { brickDefinitions } from ${JSON.stringify(`${workspace}/src/data/basicBricks.ts`)};
  import { normalizeLDrawPartNumber } from ${JSON.stringify(`${workspace}/src/lib/ldrawPartNumbers.ts`)};

  export const partNumbers = Array.from(new Set(
    brickDefinitions.map((definition) => normalizeLDrawPartNumber(definition.partNumber))
  )).sort();
`)

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
})

const { partNumbers } = await import(`file://${outfile}`)

await mkdir(publicLDrawDir, { recursive: true })
await mkdir(cacheDir, { recursive: true })

console.log(`Downloading ${completeZipUrl}`)
const curlResult = spawnSync('curl', ['-L', '-C', '-', '-o', zipPath, completeZipUrl], { stdio: 'inherit' })
if (curlResult.status !== 0) throw new Error('Failed to download LDraw complete.zip')

const listResult = spawnSync('unzip', ['-Z', '-1', zipPath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (listResult.status !== 0) throw new Error('Failed to read LDraw complete.zip file list')

const zipEntries = listResult.stdout.split(/\r?\n/).filter(Boolean)
const zipEntryByNormalizedPath = new Map()
const zipEntryByPartNumber = new Map()
for (const entryPath of zipEntries) {
  const normalizedEntryPath = entryPath.replace(/\\/g, '/').toLowerCase()
  const ldrawMatch = normalizedEntryPath.match(/(?:^|\/)ldraw\/(.+)$/)
  if (ldrawMatch) zipEntryByNormalizedPath.set(ldrawMatch[1], entryPath)

  const match = entryPath.match(/(?:^|\/)parts\/([^/]+)\.dat$/i)
  if (match) zipEntryByPartNumber.set(match[1].toLowerCase(), entryPath)
}

const normalizeReference = (reference) => reference.replace(/\\/g, '/').toLowerCase()

const getRelativeLDrawPath = (zipEntry) => {
  const normalizedEntryPath = zipEntry.replace(/\\/g, '/')
  const match = normalizedEntryPath.match(/(?:^|\/)ldraw\/(.+)$/i)
  return match?.[1] ?? normalizedEntryPath
}

const dirname = (path) => {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

const resolveReference = (parentRelativePath, reference) => {
  const normalizedReference = normalizeReference(reference)
  const parentDir = dirname(parentRelativePath.toLowerCase())
  const candidates = []

  if (normalizedReference.startsWith('parts/') || normalizedReference.startsWith('p/')) {
    candidates.push(normalizedReference)
  } else if (normalizedReference.startsWith('s/')) {
    candidates.push(`parts/${normalizedReference}`)
    if (parentDir) candidates.push(`${parentDir}/${normalizedReference}`)
  } else {
    if (parentDir) candidates.push(`${parentDir}/${normalizedReference}`)
    candidates.push(`parts/${normalizedReference}`)
    candidates.push(`p/${normalizedReference}`)
  }

  return candidates.find((candidate) => zipEntryByNormalizedPath.has(candidate))
}

const getReferences = (source) =>
  source
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((tokens) => tokens[0] === '1' && tokens.length >= 15)
    .map((tokens) => tokens.slice(14).join(' '))
    .filter(Boolean)

const extractLDrawEntry = async (zipEntry) => {
  const relativePath = getRelativeLDrawPath(zipEntry)
  const outputPath = join(publicLDrawDir, relativePath)
  const unzipResult = spawnSync('unzip', ['-p', zipPath, zipEntry], {
    maxBuffer: 64 * 1024 * 1024,
  })
  if (unzipResult.status !== 0) {
    console.error(unzipResult.stderr.toString())
    throw new Error(`Failed to extract LDraw file ${zipEntry}`)
  }

  await mkdir(pathDirname(outputPath), { recursive: true })
  await writeFile(outputPath, unzipResult.stdout)
}

const pathsToExtract = new Set()
const missing = []
const ldConfigEntry = zipEntryByNormalizedPath.get('ldconfig.ldr')
if (ldConfigEntry) pathsToExtract.add(ldConfigEntry)

for (const partNumber of partNumbers) {
  const pathInZip = zipEntryByPartNumber.get(partNumber.toLowerCase())
  if (!pathInZip) {
    missing.push(partNumber)
    continue
  }
  pathsToExtract.add(pathInZip)
}

if (pathsToExtract.size > 0) {
  await rm(publicLDrawDir, { recursive: true, force: true })
  await mkdir(publicLDrawDir, { recursive: true })

  for (const zipEntry of pathsToExtract) {
    await extractLDrawEntry(zipEntry)
  }
}

const pending = Array.from(pathsToExtract)
for (let index = 0; index < pending.length; index += 1) {
  const zipEntry = pending[index]
  const relativePath = getRelativeLDrawPath(zipEntry)
  const localPath = join(publicLDrawDir, relativePath)
  const source = await readFile(localPath, 'utf8')

  for (const reference of getReferences(source)) {
    const resolvedReference = resolveReference(relativePath, reference)
    if (!resolvedReference) {
      missing.push(`${relativePath} -> ${reference}`)
      continue
    }

    const referencedZipEntry = zipEntryByNormalizedPath.get(resolvedReference)
    if (!pathsToExtract.has(referencedZipEntry)) {
      pathsToExtract.add(referencedZipEntry)
      pending.push(referencedZipEntry)
      await extractLDrawEntry(referencedZipEntry)
    }
  }
}

console.log(JSON.stringify({
  requested: partNumbers.length,
  extracted: pathsToExtract.size,
  missing: missing.length,
  missingReferences: missing,
}, null, 2))
