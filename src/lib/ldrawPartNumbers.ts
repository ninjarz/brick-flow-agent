export const normalizeLDrawPartNumber = (partNumber: string) => {
  const stem = partNumber.toLowerCase().replace(/\.dat$/, '')
  if (['3794a', '3794b', '3044b', '3957b', '4865a'].includes(stem)) return stem
  const printedNumber = partNumber.toLowerCase().match(/^\d+[a-z]*p[0-9a-z]+/)?.[0]
  if (printedNumber) return printedNumber
  const baseNumber = partNumber.match(/^\d+/)?.[0]
  return baseNumber ?? partNumber.toLowerCase()
}
