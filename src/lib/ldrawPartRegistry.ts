import { getLDrawGeneratedConnectors } from './ldrawGeneratedConnectors'
import { getLoadedLDrawGeneratedVisualTriangles } from './ldrawGeneratedVisualLoader'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'

export const getLDrawStructuralTriangles = (partNumber: string) =>
  getLoadedLDrawGeneratedVisualTriangles(normalizeLDrawPartNumber(partNumber))

export const getLDrawConnectors = (partNumber: string, brickId: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)

  return getLDrawGeneratedConnectors(normalizedPartNumber, brickId) ?? []
}
