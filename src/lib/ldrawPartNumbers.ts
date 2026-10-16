export const normalizeLDrawPartNumber = (partNumber: string) => {
  const stem = partNumber.toLowerCase().replace(/\.dat$/, '')
  if (stem === '3794b' || stem === '3044b') return stem
  const printedNumber = partNumber.toLowerCase().match(/^\d+[a-z]*p[0-9a-z]+/)?.[0]
  if (printedNumber) return printedNumber
  const baseNumber = partNumber.match(/^\d+/)?.[0]
  return baseNumber ?? partNumber.toLowerCase()
}
