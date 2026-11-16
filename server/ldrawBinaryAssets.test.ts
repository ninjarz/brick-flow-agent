import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { decodeLDrawBinary } from '../src/lib/ldrawBinaryFormat'
import { prepareLDrawBinaryAssets } from './ldrawBinaryAssets'

it('builds exact assets, reuses unchanged inputs and repairs missing cache files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'brick-binary-assets-'))
  try {
    const source = join(root, 'src/lib/ldrawGeneratedVisualChunks')
    await mkdir(source, { recursive: true })
    await writeFile(join(root, 'src/lib/ldrawBinaryFormat.ts'), 'codec-version-one')
    await writeFile(join(root, 'src/lib/ldrawEdgePoints.ts'), 'edges-version-one')
    await writeFile(join(root, 'src/lib/ldrawVisualGeometry.ts'), 'geometry-version-one')
    const values = [0, 0, .12345678912345678, 1, 0, 0, 0, 1, 0]
    const text = `const ldrawGeneratedVisualTriangleValues = JSON.parse(${JSON.stringify(JSON.stringify({ part: values }))})\nconst printLayers = JSON.parse("{}")\n`
    await writeFile(join(source, 'chunk-00.ts'), text)
    await prepareLDrawBinaryAssets(root)
    const output = join(root, 'node_modules/.cache/brick-flow-visuals/chunk-00.bin.gz')
    const encoded = await readFile(output)
    const raw = gunzipSync(encoded)
    const decoded = decodeLDrawBinary(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
    expect(Array.from(decoded.getLDrawGeneratedVisualValues!('part')!)).toEqual(values)
    const inode = (await stat(output)).ino
    await prepareLDrawBinaryAssets(root)
    expect((await stat(output)).ino).toBe(inode)
    await rm(output)
    await prepareLDrawBinaryAssets(root)
    expect(await readFile(output)).toEqual(encoded)
    const hash = await readFile(`${output}.sha256`, 'utf8')
    await writeFile(join(root, 'src/lib/ldrawBinaryFormat.ts'), 'codec-version-two')
    await prepareLDrawBinaryAssets(root)
    expect(await readFile(`${output}.sha256`, 'utf8')).not.toBe(hash)
  } finally { await rm(root, { recursive: true, force: true }) }
})
