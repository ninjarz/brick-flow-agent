import { describe, expect, it } from 'vitest'
import { maxObjFileBytes, maxMtlFileBytes, validateObjImportFiles } from './objImportFiles'

describe('shared OBJ file validation', () => {
  it('enforces the same size and extension limit for picker, dropped file and worker entry', () => {
    expect(validateObjImportFiles({ name: 'part.obj', size: maxObjFileBytes })).toBeUndefined()
    expect(validateObjImportFiles({ name: 'part.OBJ', size: maxObjFileBytes + 1 })).toBe('OBJ_FILE_SIZE')
    expect(validateObjImportFiles({ name: 'part.zip', size: 1 })).toBe('OBJ_FILE_TYPE')
    expect(validateObjImportFiles({ name: 'part.obj', size: NaN })).toBe('OBJ_FILE_SIZE')
  })
  it('caps combined material file size before any file is read', () => {
    expect(validateObjImportFiles({ name: 'part.obj', size: 1 }, [{ name: 'a.mtl', size: maxMtlFileBytes }, { name: 'b.mtl', size: 1 }])).toBe('MTL_FILE_SIZE')
    expect(validateObjImportFiles({ name: 'part.obj', size: 1 }, [{ name: 'a.exe', size: 1 }])).toBe('MTL_FILE_TYPE')
  })
})
