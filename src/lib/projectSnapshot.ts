import { parseImportedProject } from './planFileIO'
import type { WorkspaceSnapshot } from './workspaceSession'

/** Formal projects and checkpoints use the same input boundary as file imports. */
export const normalizeProjectSnapshot = (snapshot: WorkspaceSnapshot): WorkspaceSnapshot => {
  const parsed = parseImportedProject(snapshot)
  if (!parsed?.world || typeof snapshot.prompt !== 'string') throw new Error('PROJECT_CONTENT_INVALID')
  return { plan: parsed.plan, world: parsed.world, prompt: snapshot.prompt }
}
