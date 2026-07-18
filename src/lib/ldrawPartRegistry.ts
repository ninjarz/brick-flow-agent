import { getLDrawGeneratedConnectors } from './ldrawGeneratedConnectors'
import { normalizeLDrawPartNumber } from './ldrawPartNumbers'

export const getLDrawConnectors = (partNumber: string, brickId: string) => {
  const normalizedPartNumber = normalizeLDrawPartNumber(partNumber)

  return getLDrawGeneratedConnectors(normalizedPartNumber, brickId) ?? []
}
