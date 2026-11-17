import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const physicsEntries = [
  'src/lib/planUtils.ts',
  'src/lib/constructionScene.ts',
  'src/lib/rigidBrickTransform.ts',
  'src/lib/prepareAnalysisGeometry.ts',
  'src/lib/prepareStructuralGeometry.ts',
  'src/lib/planImport.ts',
  'src/lib/constructionValidationCache.ts',
  'src/lib/legacyConstructionMigration.ts',
]

/** Follow local physics dependencies so unrelated UI and generation edits keep their cache. */
export const getConstructionPhysicsRevision = (workspace: string) => {
  const excluded = new Set(['src/data/legoHogwartsPlan.json', 'src/data/hogwartsConstructionValidation.json'])
  const files = new Set<string>(['package-lock.json', 'server/constructionPhysicsRevision.ts'])
  const visit = (path: string) => {
    if (files.has(path) || excluded.has(path)) return
    files.add(path)
    const source = readFileSync(join(workspace, path), 'utf8')
    // Type-only references carry no runtime physics implementation.
    const runtime = source
      .replace(/\bimport\s+type\b[\s\S]*?\bfrom\s*(['"])[^'"]+\1\s*;?/g, '')
      .replace(/\bexport\s+type\s*(?:\{[^}]*\}|\*)\s*from\s*(['"])[^'"]+\1\s*;?/g, '')
    // Both static imports/exports and literal dynamic imports participate.
    for (const match of runtime.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)(['"])(\.[^'"]+)\1/g)) {
      const base = resolve(workspace, dirname(path), match[2])
      const target = ['', '.ts', '.tsx', '.json', '.mjs', '/index.ts'].map(extension => base + extension).find(candidate => existsSync(candidate) && /\.(?:ts|tsx|json|mjs)$/.test(candidate))
      if (!target) throw new Error(`Missing physics dependency ${path} -> ${match[2]}`)
      visit(relative(workspace, target).split('\\').join('/'))
    }
  }
  for (const path of physicsEntries) visit(path)
  const hash = createHash('sha256')
  for (const path of [...files].sort()) hash.update(path).update('\0').update(readFileSync(join(workspace, path)))
  return hash.digest('hex')
}
