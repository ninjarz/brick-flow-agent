export const maxObjFileBytes = 100 * 1024 * 1024
export const maxMtlFileBytes = 20 * 1024 * 1024
export const validateObjImportFiles = (file: Pick<File, 'name' | 'size'>, materials: Array<Pick<File, 'name' | 'size'>> = []) => {
  if (!/\.obj$/i.test(file.name)) return 'OBJ_FILE_TYPE'
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > maxObjFileBytes) return 'OBJ_FILE_SIZE'
  if (materials.some((item) => !/\.mtl$/i.test(item.name))) return 'MTL_FILE_TYPE'
  if (materials.some((item) => !Number.isFinite(item.size) || item.size < 0) || materials.reduce((sum, item) => sum + item.size, 0) > maxMtlFileBytes) return 'MTL_FILE_SIZE'
  return undefined
}
