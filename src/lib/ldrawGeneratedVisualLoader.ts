import { yieldToBrowser } from './yieldToBrowser'
import { registerLDrawVisualChunk } from './ldrawVisualRegistry'
export { onLDrawGeneratedVisualLoaded, getLoadedLDrawGeneratedVisualTriangles, getLoadedLDrawPrintLayers } from './ldrawVisualRegistry'
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
const getVisualChunkLoader = (partNumber: string) =>
  ldrawGeneratedVisualChunkLoaders[normalizeLDrawPartNumber(partNumber)]

// One queue covers renderer, analysis and previews; concurrent callers must
// not each start their own burst of large JS modules.
let activeLoads = 0
const waitingLoads: Array<() => void> = []
const scheduleLoad = async <T>(load: () => Promise<T>): Promise<T> => {
  if (activeLoads >= 2) await new Promise<void>(resolve => waitingLoads.push(resolve))
  else activeLoads++
  try { await yieldToBrowser(); return await load() } finally {
    const next = waitingLoads.shift()
    if (next) next()
    else activeLoads--
  }
}

const loadVisualChunk = (loader: VisualChunkLoader) => {
  const loadedChunk = loadedChunks.get(loader)
  if (loadedChunk) return Promise.resolve(loadedChunk)

  const activeLoad = loadingChunks.get(loader)
  if (activeLoad) return activeLoad

  const loading = scheduleLoad(loader)
    .then((module) => {
      loadedChunks.set(loader, module)
      registerLDrawVisualChunk(partNumbersByLoader.get(loader) ?? [], module)
      return module
    })
    .finally(() => loadingChunks.delete(loader))
  loadingChunks.set(loader, loading)
  return loading
}

export const loadLDrawGeneratedVisual = async (partNumbers = ldrawGeneratedVisualPartNumbers, onProgress?: (fraction: number) => void) => {
  const loaders = new Set(
    partNumbers
      .map(getVisualChunkLoader)
      .filter((loader): loader is VisualChunkLoader => Boolean(loader)),
  )
  let completed = 0
  onProgress?.(0)
  await Promise.all(Array.from(loaders, async loader => {
    await loadVisualChunk(loader)
    onProgress?.(++completed / loaders.size)
  }))
  onProgress?.(1)
}

export const loadLDrawGeneratedVisualTriangles = async (partNumber: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)
  const loader = getVisualChunkLoader(normalizedPartNumber)
  return loader
    ? (await loadVisualChunk(loader)).getLDrawGeneratedVisualTriangles(normalizedPartNumber)
    : undefined
}
