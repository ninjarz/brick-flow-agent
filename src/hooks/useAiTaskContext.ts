import { useLayoutEffect, useRef } from 'react'
import { aiTasks } from '../lib/aiTasks'
import type { createWorkspaceSession } from '../lib/workspaceSession'
export const useAiTaskContext = (session: ReturnType<typeof createWorkspaceSession>, projectId: string, config: unknown) => {
  const version = useRef(0)
  useLayoutEffect(() => {
    version.current += 1
    const update = () => aiTasks.setContext({ projectId, epoch: session.getEpoch(), configVersion: version.current })
    update()
    const unsubscribe = session.onInvalidate(update)
    return () => { unsubscribe(); aiTasks.cancelAll() }
  }, [session, projectId, config])
}
