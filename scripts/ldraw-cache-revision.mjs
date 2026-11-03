import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const getStructuralSourceRevision = async (workspace) => {
  const chunks = (await readdir(join(workspace, 'src/lib/ldrawGeneratedVisualChunks'))).filter(name => name.endsWith('.ts')).sort()
  const sources = [
    'src/lib/structuralGrid.ts', 'src/lib/structuralVoxelizer.ts',
    'src/lib/brickUnits.ts', 'src/lib/ldrawPartNumbers.ts', 'src/lib/ldrawBounds.ts',
    ...chunks.map(name => `src/lib/ldrawGeneratedVisualChunks/${name}`),
  ]
  const hash = createHash('sha256')
  for (const path of sources) hash.update(path).update(await readFile(join(workspace, path)))
  return hash.digest('hex')
}
