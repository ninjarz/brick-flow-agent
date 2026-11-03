import type { BrickDefinition } from '../types/bricks'
import type { StructuralCell } from './structuralGrid'
import { getStructuralDefinitionSignature } from './structuralDefinitionSignature'
import { structuralCacheLoaders } from './ldrawStructuralCacheManifest'

type ChunkLoader = (typeof structuralCacheLoaders)[string]
const chunks = new Map<ChunkLoader, ReturnType<ChunkLoader>>()
const cellsBySignature = new Map<string, Promise<StructuralCell[] | undefined>>()

export const loadPrecomputedStructuralCells = (definition: BrickDefinition) => {
  const loader = structuralCacheLoaders[definition.id]
  if (!loader || typeof DecompressionStream === 'undefined') return Promise.resolve(undefined)
  const signature = getStructuralDefinitionSignature(definition)
  const cached = cellsBySignature.get(signature)
  if (cached) return cached
  const loading = (async () => {
    let chunk = chunks.get(loader)
    if (!chunk) { chunk = loader(); chunks.set(loader, chunk) }
    const snapshot = (await chunk).snapshots[definition.id]
    if (!snapshot || snapshot.signature !== signature) return undefined
    const compressed = Uint8Array.from(atob(snapshot.gzip), char => char.charCodeAt(0))
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
    return JSON.parse(await new Response(stream).text()) as StructuralCell[]
  })().catch(() => undefined) // Missing/corrupt caches retain the exact original sampler.
  cellsBySignature.set(signature, loading)
  return loading
}
