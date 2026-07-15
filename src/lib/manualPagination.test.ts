import { describe, expect, it } from 'vitest'
import { getManualPageTabItems, getManualStepPage } from './manualPagination'

describe('manual pagination', () => {
  it('keeps the selected step inside a fixed-size window', () => {
    expect(getManualStepPage(1243, 0)).toMatchObject({ start: 0, end: 30, hasPrevious: false, hasNext: true })
    expect(getManualStepPage(1243, 617)).toMatchObject({ start: 600, end: 630, hasPrevious: true, hasNext: true })
    expect(getManualStepPage(1243, 1242)).toMatchObject({ start: 1230, end: 1243, hasPrevious: true, hasNext: false })
  })

  it('renders only the first, last, and nearby page tabs for large manuals', () => {
    expect(getManualPageTabItems(1243, 617)).toEqual([
      { kind: 'step', index: 0 },
      { kind: 'gap', key: '0-614' },
      { kind: 'step', index: 614 },
      { kind: 'step', index: 615 },
      { kind: 'step', index: 616 },
      { kind: 'step', index: 617 },
      { kind: 'step', index: 618 },
      { kind: 'step', index: 619 },
      { kind: 'step', index: 620 },
      { kind: 'gap', key: '620-1242' },
      { kind: 'step', index: 1242 },
    ])
  })
})
