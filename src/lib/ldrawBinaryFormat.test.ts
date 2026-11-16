import { describe, expect, it } from 'vitest'
import { decodeLDrawBinary, encodeLDrawBinary, packLDrawBinary } from './ldrawBinaryFormat'

const values = { part: [0, -0, .12345678912345678, -1e-12, 2, 3, 4, 5, 6] }
const prints = { part: [{ color: 4, hex: '#ff0000', opacity: 1, triangleIndices: [0] }] }

describe('lossless binary visual resources', () => {
  it('preserves every Float64 coordinate, artwork and lazily cached triangle', () => {
    const buffer = encodeLDrawBinary(values, prints)
    const chunk = decodeLDrawBinary(buffer)
    const packed = chunk.getLDrawGeneratedVisualValues!('part') as Float64Array
    expect(packed.buffer).toBe(buffer)
    expect(Array.from(packed)).toEqual(values.part)
    expect(chunk.getLDrawGeneratedPrintLayers('part')).toEqual(prints.part)
    const triangles = chunk.getLDrawGeneratedVisualTriangles('part')!
    expect(triangles).toEqual([[{ x: 0, y: -0, z: values.part[2] }, { x: -1e-12, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }]])
    expect(chunk.getLDrawGeneratedVisualTriangles('part')).toBe(triangles)
    expect(chunk.getLDrawGeneratedVisualTriangles('missing')).toBeUndefined()
  })

  it('rejects truncated, invalid and unsupported resources', () => {
    expect(() => decodeLDrawBinary(new ArrayBuffer(4))).toThrow('LDRAW_BINARY_HEADER')
    const buffer = encodeLDrawBinary(values, prints)
    expect(() => decodeLDrawBinary(buffer.slice(0, -1))).toThrow('LDRAW_BINARY_RANGE')
    const version = buffer.slice(0)
    const length = new DataView(version).getUint32(4, true)
    const header = new TextDecoder().decode(new Uint8Array(version, 8, length)).replace('"version":1', '"version":2')
    new Uint8Array(version, 8, length).set(new TextEncoder().encode(header))
    expect(() => decodeLDrawBinary(version)).toThrow('LDRAW_BINARY_VERSION')
    expect(() => encodeLDrawBinary({ invalid: [Infinity] }, {})).toThrow('LDRAW_BINARY_COORDINATES')
  })
})

it('keeps prepared outlines specific to their exact footprint', () => {
  const footprint = { widthStuds: 1, depthStuds: 1, heightStuds: 1.2 }
  const points = [0, 0, 0, 1, 1, 1]
  const chunk = decodeLDrawBinary(encodeLDrawBinary(values, prints, { part: { footprint, points } }))
  expect(Array.from(chunk.getLDrawGeneratedEdgePoints!('part', footprint)!)).toEqual(points)
  expect(chunk.getLDrawGeneratedEdgePoints!('part', { ...footprint, widthStuds: 2 })).toBeUndefined()
})

it('round-trips dictionary values bit-exactly and rejects invalid indices', () => {
  const values = Array.from({ length: 90 }, (_, i) => [0, -0, Number('1.2345678912345678')][i % 3])
  const original = encodeLDrawBinary({ part: values }, {})
  const packed = packLDrawBinary(original)
  expect(packed.byteLength).toBeLessThan(original.byteLength)
  expect(Array.from(decodeLDrawBinary(packed).getLDrawGeneratedVisualValues!('part')!)).toEqual(values)
  const broken = packed.slice(0)
  const view = new DataView(broken)
  const start = Math.ceil((8 + view.getUint32(4, true)) / 8) * 8
  const dictionaryLength = view.getUint32(start, true)
  view.setUint32(start + 8 + dictionaryLength * 8, dictionaryLength, true)
  expect(() => decodeLDrawBinary(broken)).toThrow('LDRAW_BINARY_DICTIONARY_RANGE')
  expect(() => decodeLDrawBinary(packed.slice(0, -1))).toThrow('LDRAW_BINARY_PACKED_RANGE')
})
