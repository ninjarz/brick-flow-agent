import * as esbuild from 'esbuild'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspace = process.cwd()
const temporary = await mkdtemp(join(tmpdir(), 'brick-visual-verification-'))
try {
  const entry = join(temporary, 'entry.ts')
  const output = join(temporary, 'entry.mjs')
  await writeFile(entry, `
import { readFile, readdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import assert from 'node:assert/strict'
import { prepareLDrawBinaryAssets } from ${JSON.stringify(workspace + '/server/ldrawBinaryAssets.ts')}
import { decodeLDrawBinary } from ${JSON.stringify(workspace + '/src/lib/ldrawBinaryFormat.ts')}
import { brickDefinitions } from ${JSON.stringify(workspace + '/src/data/basicBricks.ts')}
import { loadLDrawGeneratedVisual } from ${JSON.stringify(workspace + '/src/lib/ldrawGeneratedVisualLoader.ts')}
import { createLoadedLDrawBodyGeometry } from ${JSON.stringify(workspace + '/src/lib/ldrawVisualGeometry.ts')}
import { getLDrawEdgePoints } from ${JSON.stringify(workspace + '/src/lib/ldrawEdgePoints.ts')}
import { normalizeLDrawPartNumber } from ${JSON.stringify(workspace + '/src/lib/ldrawPartNumbers.ts')}
const root = ${JSON.stringify(workspace)}
await prepareLDrawBinaryAssets(root)
await loadLDrawGeneratedVisual()
const definitions = new Map(brickDefinitions.filter(definition => definition.pack === 'lego').map(definition => [normalizeLDrawPartNumber(definition.partNumber), definition]))
let chunks = 0, parts = 0, coordinates = 0, edgeProfiles = 0, edgeCoordinates = 0
for (const name of await readdir(root + '/src/lib/ldrawGeneratedVisualChunks')) {
  if (!name.endsWith('.ts')) continue
  const text = await readFile(root + '/src/lib/ldrawGeneratedVisualChunks/' + name, 'utf8')
  const original = JSON.parse(JSON.parse(text.match(/const ldrawGeneratedVisualTriangleValues[^\\n]*?JSON\\.parse\\((.*)\\)/)[1]))
  const prints = JSON.parse(JSON.parse(text.match(/const printLayers[^\\n]*?JSON\\.parse\\((.*)\\)/)[1]))
  const raw = gunzipSync(await readFile(root + '/node_modules/.cache/brick-flow-visuals/' + name.replace('.ts', '.bin.gz')))
  const chunk = decodeLDrawBinary(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  for (const [part, values] of Object.entries(original) as Array<[string, number[]]>) {
    const packed = chunk.getLDrawGeneratedVisualValues!(part)!
    assert.equal(packed.length, values.length, part)
    for (let i = 0; i < values.length; i++) assert.ok(Object.is(values[i], packed[i]), part)
    assert.deepEqual(chunk.getLDrawGeneratedPrintLayers(part), prints[part], part)
    const definition = definitions.get(part)
    if (definition) {
      const outline = chunk.getLDrawGeneratedEdgePoints?.(part, definition.footprint)
      if (outline) {
        const geometry = createLoadedLDrawBodyGeometry(part, definition.footprint)!
        assert.deepEqual(Array.from(outline), getLDrawEdgePoints(geometry), part)
        edgeProfiles++
        edgeCoordinates += outline.length
      }
    }
    parts++
    coordinates += packed.length
  }
  chunks++
}
console.log(JSON.stringify({ chunks, parts, coordinates, edgeProfiles, edgeCoordinates, exact: true }))
`)
  await esbuild.build({ entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  await import(output)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
