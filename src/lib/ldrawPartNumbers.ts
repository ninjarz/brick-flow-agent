export const normalizeLDrawPartNumber = (partNumber: string) => {
  const baseNumber = partNumber.match(/^\d+/)?.[0]
  return baseNumber ?? partNumber.toLowerCase()
}
