import { describe, expect, it } from 'vitest'
import { selectCheckpointEvictions } from './projectCheckpointRetention'

describe('checkpoint retention', () => {
  it('does not charge per-project evictions against another project', () => {
    const checkpoints = [...Array.from({ length: 6 }, (_, id) => ({ id, projectId: 'A', size: 9 })), { id: 6, projectId: 'B', size: 1 }]
    expect(selectCheckpointEvictions(checkpoints, { perProject: 5, bytes: 50 }, item => item.size).map(item => item.id)).toEqual([5])
  })

  it('keeps smaller older checkpoints when an oversized checkpoint cannot fit', () => {
    const checkpoints = [{ projectId: 'A', size: 51 }, { projectId: 'B', size: 10 }, { projectId: 'B', size: 41 }]
    expect(selectCheckpointEvictions(checkpoints, { perProject: 5, bytes: 50 }, item => item.size)).toEqual([checkpoints[0], checkpoints[2]])
  })
})
