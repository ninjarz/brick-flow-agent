import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldFixedStepClock, createWorldFixedStepClock } from '../lib/worldClock'
import { worldSimulationStepSeconds } from '../lib/worldSimulation'
import { advanceWorldSimulationSteps } from '../lib/worldSimulationRuntime'
import {
  appendWorldSimulationBacklog,
  isExpectedWorldSimulationWorkerResponse,
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
    const canUseWorker = typeof Worker !== 'undefined'
    let worker = canUseWorker
      ? new Worker(new URL('../workers/worldSimulationWorker.ts', import.meta.url), { type: 'module' })
      : undefined
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
          try {
            worker.postMessage({
              protocolVersion: worldSimulationWorkerProtocolVersion,
              requestId: inFlightRequestId,
              world: sentWorld,
              plan: source.readPlan(),
              stepCount,
              options: readOptions(),
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
        if (!sentWorld || !isExpectedWorldSimulationWorkerResponse(event.data, inFlightRequestId, sentWorld.id)) {
          disableWorker()
          return
        }
        inFlight = false
        const nextWorld = event.data.world
        setWorld((current) => {
          if (current === sentWorld) return nextWorld
          pendingStepCount = appendWorldSimulationBacklog(pendingStepCount, inFlightStepCount)
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
