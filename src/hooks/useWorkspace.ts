import { useState, useSyncExternalStore } from 'react'
import { createWorkspaceSession, type WorkspaceSnapshot } from '../lib/workspaceSession'

export const useWorkspace = (initial: WorkspaceSnapshot) => {
  const [session] = useState(() => createWorkspaceSession(initial))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  // Stable read-through refs keep asynchronous consumers on the latest commit.
  const [refs] = useState(() => ({
    planRef: { get current() { return session.getSnapshot().plan } },
    worldRef: { get current() { return session.getSnapshot().world } },
    promptRef: { get current() { return session.getSnapshot().prompt } },
  }))
  return { ...snapshot, ...refs, session, setPlan: session.setPlan, setWorld: session.setWorld, editWorld: session.editWorld, setPrompt: session.setPrompt }
}
