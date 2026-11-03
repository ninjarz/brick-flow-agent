import type { LDrawGeneratedVisualChunk } from './ldrawGeneratedVisual'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'

// Geometry consumers can read already-loaded moulds without pulling the full
// dynamic rendering manifest into structural analysis workers.
const loaded = new Map<string, LDrawGeneratedVisualChunk>()
const listeners = new Set<(partNumbers: readonly string[]) => void>()

export const registerLDrawVisualChunk = (parts: readonly string[], chunk: LDrawGeneratedVisualChunk) => {
  for (const part of parts) loaded.set(normalizeLDrawPartNumber(part), chunk)
  for (const listener of listeners) listener(parts)
}
export const onLDrawGeneratedVisualLoaded = (listener: (partNumbers: readonly string[]) => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getLoadedLDrawGeneratedVisualTriangles = (partNumber: string) => {
  const part = normalizeLDrawPartNumber(partNumber)
  return loaded.get(part)?.getLDrawGeneratedVisualTriangles(part)
}
export const getLoadedLDrawPrintLayers = (partNumber: string) => {
  const part = normalizeLDrawPartNumber(partNumber)
  return loaded.get(part)?.getLDrawGeneratedPrintLayers(part)
}
