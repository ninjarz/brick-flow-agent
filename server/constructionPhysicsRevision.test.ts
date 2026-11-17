import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConstructionPhysicsRevision } from './constructionPhysicsRevision'

const sources = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  existsSync: (path: string) => sources.has(path),
  readFileSync: (path: string) => sources.get(path) ?? '',
}))

const root = '/physics-fixture'
beforeEach(() => {
  sources.clear()
  sources.set(`${root}/src/lib/planUtils.ts`, "export { precision } from './precision'")
  sources.set(`${root}/src/lib/precision.ts`, 'export const precision = 1e-6')
  sources.set(`${root}/package-lock.json`, '{}')
})

describe('construction physics revision', () => {
  it('tracks transitive physics edits while retaining certificates for unrelated UI edits', () => {
    const original = getConstructionPhysicsRevision(root)
    sources.set(`${root}/src/App.tsx`, 'Changed application controls')
    sources.set(`${root}/src/lib/llmGenerator.ts`, 'Changed generator prompt')
    expect(getConstructionPhysicsRevision(root)).toBe(original)
    sources.set(`${root}/src/lib/precision.ts`, 'export const precision = 1e-5')
    expect(getConstructionPhysicsRevision(root)).not.toBe(original)
  })

  it('excludes type-only presentation dependencies from the runtime physics digest', () => {
    sources.set(`${root}/src/lib/precision.ts`, "import type { Manual } from './presentation'\nexport type { Header } from './header'\nexport const precision = 1e-6")
    const original = getConstructionPhysicsRevision(root)
    sources.set(`${root}/src/lib/presentation.ts`, 'Changed Markdown formatting')
    sources.set(`${root}/src/lib/header.ts`, 'Changed UI header')
    expect(getConstructionPhysicsRevision(root)).toBe(original)
  })

  it('tracks literal lazy imports and dependency versions', () => {
    sources.set(`${root}/src/lib/precision.ts`, "export const contacts = () => import('../data/contact.json')")
    sources.set(`${root}/src/data/contact.json`, '[1,2,3]')
    const original = getConstructionPhysicsRevision(root)
    sources.set(`${root}/src/data/contact.json`, '[1,2,4]')
    expect(getConstructionPhysicsRevision(root)).not.toBe(original)
    const changedGeometry = getConstructionPhysicsRevision(root)
    sources.set(`${root}/package-lock.json`, '{"version":2}')
    expect(getConstructionPhysicsRevision(root)).not.toBe(changedGeometry)
  })

  it('keeps the separately hashed plan and generated certificate out of the physics digest', () => {
    sources.set(`${root}/src/lib/precision.ts`, "import '../data/legoHogwartsPlan.json'; import('../data/hogwartsConstructionValidation.json')")
    sources.set(`${root}/src/data/legoHogwartsPlan.json`, '{}')
    sources.set(`${root}/src/data/hogwartsConstructionValidation.json`, '{}')
    const original = getConstructionPhysicsRevision(root)
    sources.set(`${root}/src/data/legoHogwartsPlan.json`, '{"bricks":[]}')
    sources.set(`${root}/src/data/hogwartsConstructionValidation.json`, '{"steps":{}}')
    expect(getConstructionPhysicsRevision(root)).toBe(original)
  })
})
