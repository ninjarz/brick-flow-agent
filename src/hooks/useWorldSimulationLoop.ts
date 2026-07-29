import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { BuildPlan } from '../types/bricks'
import type { WorldState } from '../types/world'
import { advanceWorldFixedStepClock, createWorldFixedStepClock } from '../lib/worldClock'
import { worldSimulationStepSeconds } from '../lib/worldSimulation'
import { advanceWorldSimulationSteps } from '../lib/worldSimulationRuntime'

type WorldSimulationLoopOptions = {
  active: boolean
  enableAi: boolean
  readPlan: () => Pick<BuildPlan, 'bricks' | 'structures'>
  readDirectorPlayback: () => { active: boolean; simulationStarted: boolean }
  setWorld: Dispatch<SetStateAction<WorldState>>
}

export const useWorldSimulationLoop = ({
  active,
  enableAi,
  readPlan,
  readDirectorPlayback,
  setWorld,
}: WorldSimulationLoopOptions) => {
  const sourcesRef = useRef({ enableAi, readPlan, readDirectorPlayback })
  sourcesRef.current = { enableAi, readPlan, readDirectorPlayback }

  useEffect(() => {
    if (!active) return
    let timeoutId = 0
    let clock = createWorldFixedStepClock(performance.now())
    const resetClock = () => {
      clock = createWorldFixedStepClock(performance.now())
    }
    const scheduleWorldStep = () => {
      timeoutId = window.setTimeout(animateWorld, worldSimulationStepSeconds * 1_000)
    }
    const animateWorld = () => {
      const now = performance.now()
      const advanced = advanceWorldFixedStepClock(clock, now, worldSimulationStepSeconds)
      clock = advanced.clock
      if (advanced.stepCount > 0) {
        const source = sourcesRef.current
        const directorPlayback = source.readDirectorPlayback()
        setWorld((current) => advanceWorldSimulationSteps(
          current,
          source.readPlan(),
          advanced.stepCount,
          {
            enableAi: source.enableAi,
            directorPlaybackActive: directorPlayback.active,
            directorSimulationStarted: directorPlayback.simulationStarted,
          },
        ))
      }
      scheduleWorldStep()
    }
    document.addEventListener('visibilitychange', resetClock)
    scheduleWorldStep()
    return () => {
      document.removeEventListener('visibilitychange', resetClock)
      window.clearTimeout(timeoutId)
    }
  }, [active, setWorld])
}
