export const isDebugModeEnabled = (search: string) => {
  const value = new URLSearchParams(search).get('debug')?.trim().toLowerCase()
  return value === 'true' || value === '1'
}
