const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

export const getCanonicalAppPath = (pathname: string, baseUrl: string) => {
  const baseSegment = trimSlashes(baseUrl)
  if (!baseSegment) return undefined

  const canonicalPath = `/${baseSegment}/`
  if (pathname === canonicalPath) return undefined
  const normalizedPath = `/${trimSlashes(pathname)}`
  const duplicatedPath = `/${baseSegment}/${baseSegment}`

  if (normalizedPath === duplicatedPath || normalizedPath.startsWith(`${duplicatedPath}/`)) {
    return canonicalPath
  }
  if (normalizedPath === `/${baseSegment}`) return canonicalPath
  return undefined
}
