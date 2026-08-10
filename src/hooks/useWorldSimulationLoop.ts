import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldFixedStepClock, createWorldFixedStepClock } from '../lib/worldClock'
import { worldSimulationStepSeconds } from '../lib/worldSimulation'
import { advanceWorldSimulationSteps } from '../lib/worldSimulationRuntime'
import type { WorldSimulationWorkerRequest, WorldSimulationWorkerResponse } from '../workers/worldSimulationWorker'

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
    let sentWorld: WorldState | undefined
    const canUseWorker = typeof Worker !== 'undefined'
    const worker = canUseWorker
      ? new Worker(new URL('../workers/worldSimulationWorker.ts', import.meta.url), { type: 'module' })
      : undefined
    const resetClock = () => {
      clock = createWorldFixedStepClock(performance.now())
    }
    const scheduleWorldStep = () => {
      timeoutId = window.setTimeout(animateWorld, worldSimulationStepSeconds * 1_000)
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
      const now = performance.now()
      const advanced = advanceWorldFixedStepClock(clock, now, worldSimulationStepSeconds)
      clock = advanced.clock
      pendingStepCount += advanced.stepCount
      if (pendingStepCount > 0 && !inFlight) {
        const source = sourcesRef.current
        const stepCount = pendingStepCount
        pendingStepCount = 0
        if (worker) {
          inFlight = true
          sentWorld = source.readWorld()
          worker.postMessage({
            world: sentWorld,
            plan: source.readPlan(),
            stepCount,
            options: readOptions(),
          } satisfies WorldSimulationWorkerRequest)
        } else {
          setWorld((current) => advanceWorldSimulationSteps(current, source.readPlan(), stepCount, readOptions()))
        }
      }
      scheduleWorldStep()
    }
    if (worker) {
      worker.onmessage = (event: MessageEvent<WorldSimulationWorkerResponse>) => {
        inFlight = false
        const nextWorld = event.data.world
        setWorld((current) => (current === sentWorld ? nextWorld : current))
      }
      worker.onerror = () => {
        inFlight = false
      }
    }
    document.addEventListener('visibilitychange', resetClock)
    scheduleWorldStep()
    return () => {
      document.removeEventListener('visibilitychange', resetClock)
      window.clearTimeout(timeoutId)
      worker?.terminate()
    }
  }, [active, setWorld])
}
