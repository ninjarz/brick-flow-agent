import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldFixedStepClock, createWorldFixedStepClock } from '../lib/worldClock'
import { worldSimulationStepSeconds } from '../lib/worldSimulation'
import { advanceWorldSimulationSteps } from '../lib/worldSimulationRuntime'
import {
  appendWorldSimulationBacklog,
  isExpectedWorldSimulationWorkerResponse,
  isWorldSimulationSnapshotCurrent,
  worldSimulationWorkerProtocolVersion,
  type WorldSimulationWorkerRequest,
  type WorldSimulationWorkerResponse,
} from '../lib/worldSimulationWorkerProtocol'

type WorldSimulationLoopOptions = {
  active: boolean
  enableAi: boolean
  readPlan: () => Pick<BuildPlan, 'bricks' | 'structures'>
  readWorld: () => WorldState
  readDirectorPlayback: () => {
    active: boolean
    simulationStarted: boolean
    suspendAutomaticControllers?: boolean
  }
  setWorld: Dispatch<SetStateAction<WorldState>>
}

/**
 * Drives the fixed-step world clock. Stepping runs in a dedicated worker so
 * large NPC worlds do not block rendering. The loop applies a snapshot-swap:
 * if local edits landed while a step was in flight, the worker result is
 * dropped and the next pulse re-simulates from the edited world, so user
 * edits never get overwritten by a stale simulation result.
 */
export const useWorldSimulationLoop = ({
  active,
  enableAi,
  readPlan,
  readWorld,
  readDirectorPlayback,
  setWorld,
}: WorldSimulationLoopOptions) => {
  const sourcesRef = useRef({ enableAi, readPlan, readWorld, readDirectorPlayback })
  sourcesRef.current = { enableAi, readPlan, readWorld, readDirectorPlayback }

  useEffect(() => {
    if (!active) return
    let timeoutId = 0
    let clock = createWorldFixedStepClock(performance.now())
    let pendingStepCount = 0
    let inFlight = false
    let inFlightRequestId = 0
    let inFlightStepCount = 0
    let nextRequestId = 1
    let sentWorld: WorldState | undefined
    let sentSnapshot: Parameters<typeof isWorldSimulationSnapshotCurrent>[0] | undefined
    let workerPlan: Pick<BuildPlan, 'bricks' | 'structures'> | undefined
    let planRevision = 0
    const canUseWorker = typeof Worker !== 'undefined'
    let worker: Worker | undefined
    try {
      if (canUseWorker) worker = new Worker(new URL('../workers/worldSimulationWorker.ts', import.meta.url), { type: 'module' })
    } catch { /* The main-thread loop remains available when Worker creation is denied. */ }
    const resetClock = () => {
      clock = createWorldFixedStepClock(performance.now())
    }
    const handleVisibilityChange = () => {
      pendingStepCount = 0
      resetClock()
    }
    const scheduleWorldStep = () => {
      timeoutId = window.setTimeout(animateWorld, document.hidden ? 500 : worldSimulationStepSeconds * 1_000)
    }
    const readOptions = () => {
      const source = sourcesRef.current
      const directorPlayback = source.readDirectorPlayback()
      return {
        enableAi: source.enableAi,
        directorPlaybackActive: directorPlayback.active,
        directorSimulationStarted: directorPlayback.simulationStarted,
        suspendAutomaticControllers: directorPlayback.suspendAutomaticControllers,
      }
    }
    const animateWorld = () => {
      if (document.hidden) {
        pendingStepCount = 0
        resetClock()
        scheduleWorldStep()
        return
      }
      const now = performance.now()
      const advanced = advanceWorldFixedStepClock(clock, now, worldSimulationStepSeconds)
      clock = advanced.clock
      pendingStepCount = appendWorldSimulationBacklog(pendingStepCount, advanced.stepCount)
      if (pendingStepCount > 0 && !inFlight) {
        const source = sourcesRef.current
        const stepCount = pendingStepCount
        pendingStepCount = 0
        if (worker) {
          inFlight = true
          inFlightRequestId = nextRequestId
          nextRequestId += 1
          inFlightStepCount = stepCount
          sentWorld = source.readWorld()
          const plan = source.readPlan()
          const planChanged = workerPlan?.bricks !== plan.bricks || workerPlan?.structures !== plan.structures
          if (planChanged) { planRevision += 1; workerPlan = plan }
          sentSnapshot = { world: sentWorld, plan, options: readOptions() }
          try {
            worker.postMessage({
              protocolVersion: worldSimulationWorkerProtocolVersion,
              requestId: inFlightRequestId,
              world: sentWorld,
              planRevision,
              ...(planChanged ? { plan } : {}),
              stepCount,
              options: sentSnapshot.options,
            } satisfies WorldSimulationWorkerRequest)
          } catch {
            inFlight = false
            pendingStepCount = appendWorldSimulationBacklog(pendingStepCount, inFlightStepCount)
            worker.terminate()
            worker = undefined
          }
        } else {
          setWorld((current) => advanceWorldSimulationSteps(current, source.readPlan(), stepCount, readOptions()))
        }
      }
      scheduleWorldStep()
    }
    if (worker) {
      const disableWorker = () => {
        if (!worker) return
        inFlight = false
        pendingStepCount = appendWorldSimulationBacklog(pendingStepCount, inFlightStepCount)
        worker.terminate()
        worker = undefined
      }
      worker.onmessage = (event: MessageEvent<WorldSimulationWorkerResponse>) => {
        if (!sentWorld || !sentSnapshot || !isExpectedWorldSimulationWorkerResponse(event.data, inFlightRequestId, sentWorld.id, planRevision)) {
          disableWorker()
          return
        }
        inFlight = false
        const nextWorld = event.data.world
        const snapshot = sentSnapshot
        const completedSteps = inFlightStepCount
        setWorld((current) => {
          const source = sourcesRef.current
          if (isWorldSimulationSnapshotCurrent(snapshot, { world: current, plan: source.readPlan(), options: readOptions() })) return nextWorld
          pendingStepCount = appendWorldSimulationBacklog(pendingStepCount, completedSteps)
          return current
        })
      }
      worker.onerror = disableWorker
      worker.onmessageerror = disableWorker
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    scheduleWorldStep()
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearTimeout(timeoutId)
      worker?.terminate()
    }
  }, [active, setWorld])
}
