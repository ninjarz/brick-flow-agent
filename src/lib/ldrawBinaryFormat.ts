import type { LDrawFixedColorLayer, LDrawGeneratedVisualChunk } from './ldrawGeneratedVisual'
import type { BrickFootprint } from '../types/bricks'
import type { MeshTriangle } from './structuralVoxelizer'

type PackedEdges = { points: number[]; footprint: BrickFootprint }
type Part = { offset: number; length: number; prints?: LDrawFixedColorLayer[]; edges?: { offset: number; length: number; footprint: BrickFootprint } }
type Metadata = { version: 1; parts: Record<string, Part> }
const magic = 0x314c4642
const littleEndian = new Uint8Array(new Float64Array([1]).buffer)[7] === 0x3f
const alignedOffset = (length: number) => Math.ceil((8 + length) / 8) * 8

/** Float64 preserves the reviewed source coordinates before render-time Float32 conversion. */
export const encodeLDrawBinary = (values: Record<string, number[]>, prints: Record<string, LDrawFixedColorLayer[]>, edges: Record<string, PackedEdges> = {}) => {
  const parts: Metadata['parts'] = {}
  let count = 0
  for (const [name, coordinates] of Object.entries(values)) {
    if (coordinates.length % 9 || coordinates.some(value => !Number.isFinite(value))) throw new Error('LDRAW_BINARY_COORDINATES')
    parts[name] = { offset: count, length: coordinates.length, prints: prints[name] }
    count += coordinates.length
    const outline = edges[name]
    if (outline) {
      if (outline.points.length % 6 || outline.points.some(value => !Number.isFinite(value))) throw new Error('LDRAW_BINARY_EDGES')
      parts[name].edges = { offset: count, length: outline.points.length, footprint: outline.footprint }
      count += outline.points.length
    }
  }
  const header = new TextEncoder().encode(JSON.stringify({ version: 1, parts } satisfies Metadata))
  const start = alignedOffset(header.length)
  const buffer = new ArrayBuffer(start + count * 8)
  const view = new DataView(buffer)
  view.setUint32(0, magic, true)
  view.setUint32(4, header.length, true)
  new Uint8Array(buffer, 8, header.length).set(header)
  const write = (offset: number, numbers: number[]) => {
    if (littleEndian) new Float64Array(buffer, start + offset * 8, numbers.length).set(numbers)
    else numbers.forEach((value, index) => view.setFloat64(start + (offset + index) * 8, value, true))
  }
  for (const [name, coordinates] of Object.entries(values)) {
    write(parts[name].offset, coordinates)
    if (parts[name].edges) write(parts[name].edges!.offset, edges[name].points)
  }
  return buffer
}

const dictionaryMagic = 0x31444642

/** Static dictionary coding preserves repeated numeric bit values, including negative zero. */
export const packLDrawBinary = (buffer: ArrayBuffer) => {
  if (buffer.byteLength < 8) throw new Error('LDRAW_BINARY_HEADER')
  const header = new DataView(buffer)
  if (header.getUint32(0, true) === dictionaryMagic) return buffer
  if (header.getUint32(0, true) !== magic) throw new Error('LDRAW_BINARY_HEADER')
  const start = alignedOffset(header.getUint32(4, true))
  if (start > buffer.byteLength || (buffer.byteLength - start) % 8) throw new Error('LDRAW_BINARY_RANGE')
  const count = (buffer.byteLength - start) / 8
  const values = littleEndian ? new Float64Array(buffer, start, count)
    : Float64Array.from({ length: count }, (_, i) => header.getFloat64(start + i * 8, true))
  const byValue = new Map<number | string, number>()
  const dictionary: number[] = []
  const indices = new Uint32Array(count)
  for (let i = 0; i < count; i++) {
    const value = values[i]
    const key = Object.is(value, -0) ? 'negative-zero' : value
    let index = byValue.get(key)
    if (index === undefined) { index = dictionary.length; byValue.set(key, index); dictionary.push(value) }
    indices[i] = index
  }
  const size = start + 8 + dictionary.length * 8 + count * 4
  if (size >= buffer.byteLength) return buffer
  const packed = new ArrayBuffer(size)
  new Uint8Array(packed, 0, start).set(new Uint8Array(buffer, 0, start))
  const view = new DataView(packed)
  view.setUint32(0, dictionaryMagic, true)
  view.setUint32(start, dictionary.length, true)
  view.setUint32(start + 4, count, true)
  const indexOffset = start + 8 + dictionary.length * 8
  if (littleEndian) {
    new Float64Array(packed, start + 8, dictionary.length).set(dictionary)
    new Uint32Array(packed, indexOffset, count).set(indices)
  } else {
    dictionary.forEach((value, i) => view.setFloat64(start + 8 + i * 8, value, true))
    indices.forEach((value, i) => view.setUint32(indexOffset + i * 4, value, true))
  }
  return packed
}

export const expandLDrawBinary = (buffer: ArrayBuffer) => {
  if (buffer.byteLength < 8) return buffer
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== dictionaryMagic) return buffer
  const start = alignedOffset(view.getUint32(4, true))
  if (start + 8 > buffer.byteLength) throw new Error('LDRAW_BINARY_PACKED_RANGE')
  const dictionaryLength = view.getUint32(start, true)
  const count = view.getUint32(start + 4, true)
  const indexOffset = start + 8 + dictionaryLength * 8
  if (indexOffset + count * 4 !== buffer.byteLength) throw new Error('LDRAW_BINARY_PACKED_RANGE')
  const expanded = new ArrayBuffer(start + count * 8)
  new Uint8Array(expanded, 0, start).set(new Uint8Array(buffer, 0, start))
  const targetView = new DataView(expanded)
  targetView.setUint32(0, magic, true)
  const dictionary = littleEndian ? new Float64Array(buffer, start + 8, dictionaryLength) : undefined
  const indices = littleEndian ? new Uint32Array(buffer, indexOffset, count) : undefined
  const values = littleEndian ? new Float64Array(expanded, start, count) : undefined
  for (let i = 0; i < count; i++) {
    const index = indices ? indices[i] : view.getUint32(indexOffset + i * 4, true)
    if (index >= dictionaryLength) throw new Error('LDRAW_BINARY_DICTIONARY_RANGE')
    const value = dictionary ? dictionary[index] : view.getFloat64(start + 8 + index * 8, true)
    if (values) values[i] = value
    else targetView.setFloat64(start + i * 8, value, true)
  }
  return expanded
}

export const decodeLDrawBinary = (packed: ArrayBuffer): LDrawGeneratedVisualChunk => {
  const buffer = expandLDrawBinary(packed)
  if (buffer.byteLength < 8) throw new Error('LDRAW_BINARY_HEADER')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== magic) throw new Error('LDRAW_BINARY_HEADER')
  const length = view.getUint32(4, true)
  const start = alignedOffset(length)
  if (start > buffer.byteLength) throw new Error('LDRAW_BINARY_HEADER')
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length))) as Metadata
  if (metadata.version !== 1 || !metadata.parts || typeof metadata.parts !== 'object') throw new Error('LDRAW_BINARY_VERSION')
  const coordinates = new Map<string, Float64Array>()
  const edgePoints = new Map<string, Float64Array>()
  const read = (offset: number, length: number, stride: number) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0
      || length % stride || start + (offset + length) * 8 > buffer.byteLength) throw new Error('LDRAW_BINARY_RANGE')
    const byteOffset = start + offset * 8
    return littleEndian ? new Float64Array(buffer, byteOffset, length)
      : Float64Array.from({ length }, (_, i) => view.getFloat64(byteOffset + i * 8, true))
  }
  for (const [name, part] of Object.entries(metadata.parts)) {
    coordinates.set(name, read(part.offset, part.length, 9))
    if (part.edges) {
      const footprint = part.edges.footprint
      if (!footprint || ![footprint.widthStuds, footprint.depthStuds, footprint.heightStuds].every(value => Number.isFinite(value) && value >= 0)) throw new Error('LDRAW_BINARY_FOOTPRINT')
      edgePoints.set(name, read(part.edges.offset, part.edges.length, 6))
    }
  }
  const triangles = new Map<string, MeshTriangle[]>()
  return {
    getLDrawGeneratedVisualValues: name => coordinates.get(name),
    getLDrawGeneratedEdgePoints: (name, footprint) => {
      const expected = metadata.parts[name]?.edges?.footprint
      if (expected && expected.widthStuds === footprint.widthStuds && expected.depthStuds === footprint.depthStuds && expected.heightStuds === footprint.heightStuds) return edgePoints.get(name)
      return undefined
    },
    getLDrawGeneratedPrintLayers: name => metadata.parts[name]?.prints,
    getLDrawGeneratedVisualTriangles: name => {
      const cached = triangles.get(name)
      if (cached) return cached
      const values = coordinates.get(name)
      if (!values) return undefined
      const result: MeshTriangle[] = []
      for (let i = 0; i < values.length; i += 9) result.push([
        { x: values[i], y: values[i + 1], z: values[i + 2] },
        { x: values[i + 3], y: values[i + 4], z: values[i + 5] },
        { x: values[i + 6], y: values[i + 7], z: values[i + 8] },
      ])
      triangles.set(name, result)
      return result
    },
  }
}
