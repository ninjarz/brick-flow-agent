import type { MeshTriangle } from './structuralVoxelizer'

type LDrawGeneratedVisualModule = {
  getLDrawGeneratedVisualTriangles: (partNumber: string) => MeshTriangle[] | undefined
}

let loadedModule: LDrawGeneratedVisualModule | undefined
let loadingModule: Promise<LDrawGeneratedVisualModule> | undefined
const loadListeners = new Set<() => void>()

const notifyLoaded = () => {
  for (const listener of loadListeners) listener()
}

export const onLDrawGeneratedVisualLoaded = (listener: () => void) => {
  loadListeners.add(listener)
  return () => loadListeners.delete(listener)
}

export const loadLDrawGeneratedVisual = async () => {
  if (loadedModule) return loadedModule
  loadingModule ??= import('./ldrawGeneratedVisual').then((module) => {
    loadedModule = module
    notifyLoaded()
    return module
  })
  return loadingModule
}

export const getLoadedLDrawGeneratedVisualTriangles = (partNumber: string) =>
  loadedModule?.getLDrawGeneratedVisualTriangles(partNumber)

export const loadLDrawGeneratedVisualTriangles = async (partNumber: string) =>
  (await loadLDrawGeneratedVisual()).getLDrawGeneratedVisualTriangles(partNumber)
