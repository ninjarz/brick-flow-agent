import {
  ldrawGeneratedVisualChunkLoaders,
  ldrawGeneratedVisualPartNumbers,
  type LDrawGeneratedVisualChunk,
} from './ldrawGeneratedVisual'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'

type VisualChunkLoader = () => Promise<LDrawGeneratedVisualChunk>

const loadedChunks = new Map<VisualChunkLoader, LDrawGeneratedVisualChunk>()
const loadingChunks = new Map<VisualChunkLoader, Promise<LDrawGeneratedVisualChunk>>()
const partNumbersByLoader = new Map<VisualChunkLoader, string[]>()
for (const [partNumber, loader] of Object.entries(ldrawGeneratedVisualChunkLoaders)) {
  const partNumbers = partNumbersByLoader.get(loader)
  if (partNumbers) partNumbers.push(partNumber)
  else partNumbersByLoader.set(loader, [partNumber])
}
const loadListeners = new Set<(partNumbers: readonly string[]) => void>()

const notifyLoaded = (loader: VisualChunkLoader) => {
  const partNumbers = partNumbersByLoader.get(loader) ?? []
  for (const listener of loadListeners) listener(partNumbers)
}

export const onLDrawGeneratedVisualLoaded = (listener: (partNumbers: readonly string[]) => void) => {
  loadListeners.add(listener)
  return () => loadListeners.delete(listener)
}

const getVisualChunkLoader = (partNumber: string) =>
  ldrawGeneratedVisualChunkLoaders[normalizeLDrawPartNumber(partNumber)]

const loadVisualChunk = (loader: VisualChunkLoader) => {
  const loadedChunk = loadedChunks.get(loader)
  if (loadedChunk) return Promise.resolve(loadedChunk)

  const activeLoad = loadingChunks.get(loader)
  if (activeLoad) return activeLoad

  const loading = loader()
    .then((module) => {
      loadedChunks.set(loader, module)
      notifyLoaded(loader)
      return module
    })
    .finally(() => loadingChunks.delete(loader))
  loadingChunks.set(loader, loading)
  return loading
}

export const loadLDrawGeneratedVisual = async (partNumbers = ldrawGeneratedVisualPartNumbers) => {
  const loaders = new Set(
    partNumbers
      .map(getVisualChunkLoader)
      .filter((loader): loader is VisualChunkLoader => Boolean(loader)),
  )
  await Promise.all(Array.from(loaders, loadVisualChunk))
}

export const getLoadedLDrawGeneratedVisualTriangles = (partNumber: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)
  const loader = getVisualChunkLoader(normalizedPartNumber)
  return loader
    ? loadedChunks.get(loader)?.getLDrawGeneratedVisualTriangles(normalizedPartNumber)
    : undefined
}

export const loadLDrawGeneratedVisualTriangles = async (partNumber: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)
  const loader = getVisualChunkLoader(normalizedPartNumber)
  return loader
    ? (await loadVisualChunk(loader)).getLDrawGeneratedVisualTriangles(normalizedPartNumber)
    : undefined
}
