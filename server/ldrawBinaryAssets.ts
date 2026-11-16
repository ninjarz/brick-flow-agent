import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { BufferAttribute, BufferGeometry } from 'three'
import { brickDefinitions } from '../src/data/basicBricks'
import type { BrickFootprint } from '../src/types/bricks'
import { getLDrawEdgePoints } from '../src/lib/ldrawEdgePoints'
import { normalizeLDrawPartNumber } from '../src/lib/ldrawPartNumbers'
import type { LDrawFixedColorLayer } from '../src/lib/ldrawGeneratedVisual'
import type { Plugin } from 'vite'
import { encodeLDrawBinary, packLDrawBinary } from '../src/lib/ldrawBinaryFormat'

const compress = promisify(gzip)
const formatVersion = 'BFL1-v3'

const footprints = new Map<string, BrickFootprint | null>()
for (const definition of brickDefinitions.filter(definition => definition.pack === 'lego')) {
  const part = normalizeLDrawPartNumber(definition.partNumber)
  const previous = footprints.get(part)
  if (!footprints.has(part)) footprints.set(part, definition.footprint)
  else if (previous && JSON.stringify(previous) !== JSON.stringify(definition.footprint)) footprints.set(part, null)
}
const footprintSignature = JSON.stringify([...footprints])

const prepareEdges = (values: Record<string, number[]>, prints: Record<string, LDrawFixedColorLayer[]>) => {
  const edges: Record<string, { footprint: BrickFootprint; points: number[] }> = {}
  for (const [part, coordinates] of Object.entries(values)) {
    const footprint = footprints.get(part)
    if (!footprint) continue
    const layers = prints[part] ?? []
    const colored = new Set(layers.every(layer => layer.triangleIndices) ? layers.flatMap(layer => layer.triangleIndices) : [])
    const triangles = Array.from({ length: coordinates.length / 9 }, (_, index) => index).filter(index => !colored.has(index))
    const position = new Float32Array(triangles.length * 9)
    const origin = [footprint.widthStuds / 2, footprint.heightStuds / 2, footprint.depthStuds / 2]
    let offset = 0
    for (const index of triangles) for (let i = 0; i < 9; i++) position[offset++] = coordinates[index * 9 + i] - origin[i % 3]
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3))
    edges[part] = { footprint, points: getLDrawEdgePoints(geometry) }
    geometry.dispose()
  }
  return edges
}

/** Derived assets live in node_modules cache, leaving reviewed source data authoritative. */
export const prepareLDrawBinaryAssets = async (root: string) => {
  const source = join(root, 'src/lib/ldrawGeneratedVisualChunks')
  const target = join(root, 'node_modules/.cache/brick-flow-visuals')
  await mkdir(target, { recursive: true })
  const codec = await readFile(join(root, 'src/lib/ldrawBinaryFormat.ts'))
  const edgeAlgorithm = await readFile(join(root, 'src/lib/ldrawEdgePoints.ts'))
  const geometryAlgorithm = await readFile(join(root, 'src/lib/ldrawVisualGeometry.ts'))
  for (const name of (await readdir(source)).filter(name => /^chunk-.*\.ts$/.test(name))) {
    const text = await readFile(join(source, name), 'utf8')
    const hash = createHash('sha256').update(formatVersion).update(codec).update(edgeAlgorithm).update(geometryAlgorithm).update(footprintSignature).update(text).digest('hex')
    const output = join(target, name.replace('.ts', '.bin.gz'))
    let current = ''
    try { current = await readFile(`${output}.sha256`, 'utf8') } catch { /* First build or cleared cache. */ }
    if (current === hash) {
      try { await access(output); continue } catch { /* Recreate an incomplete cache. */ }
    }
    const coordinates = text.match(/const ldrawGeneratedVisualTriangleValues[^\n]*?JSON\.parse\((.*)\)/)
    const prints = text.match(/const printLayers[^\n]*?JSON\.parse\((.*)\)/)
    if (!coordinates || !prints) throw new Error(`Missing visual data in ${name}`)
    const values = JSON.parse(JSON.parse(coordinates[1])) as Record<string, number[]>
    const artwork = JSON.parse(JSON.parse(prints[1])) as Record<string, LDrawFixedColorLayer[]>
    const buffer = packLDrawBinary(encodeLDrawBinary(values, artwork, prepareEdges(values, artwork)))
    const temporary = `${output}.${randomUUID()}.tmp`
    await writeFile(temporary, await compress(new Uint8Array(buffer)))
    await rename(temporary, output)
    await writeFile(`${output}.sha256`, hash)
  }
}

export const ldrawBinaryAssetsPlugin = (): Plugin => {
  let root = ''
  return {
    name: 'ldraw-binary-assets',
    configResolved(config) { root = config.root },
    async buildStart() { await prepareLDrawBinaryAssets(root) },
  }
}
