import { describe, expect, it } from 'vitest'
import { makeBrick } from './planUtils'
import {
  getDisasterFrame,
  runDisasterSimulation,
  solveAffineContactReactions,
  solveStudConnection,
  type StudContactPoint,
} from './disasterSimulation'

const createStableStack = () => [
  makeBrick('brick-2x4', 'gray', 0, 0, 0),
  makeBrick('brick-2x2', 'gray', 1, 1.2, 1),
]

describe('disaster simulation', () => {
  it('balances vertical force and both overturning moments with an affine stud-contact field', () => {
    const points: StudContactPoint[] = [
      { x: 0.3, z: 0.3, studId: '0:0' },
      { x: 0.7, z: 0.3, studId: '0:0' },
      { x: 0.7, z: 0.7, studId: '0:0' },
      { x: 0.3, z: 0.7, studId: '0:0' },
      { x: 1.3, z: 0.3, studId: '1:0' },
      { x: 1.7, z: 0.3, studId: '1:0' },
      { x: 1.7, z: 0.7, studId: '1:0' },
      { x: 1.3, z: 0.7, studId: '1:0' },
      { x: 0.3, z: 1.3, studId: '0:1' },
      { x: 0.7, z: 1.3, studId: '0:1' },
      { x: 0.7, z: 1.7, studId: '0:1' },
      { x: 0.3, z: 1.7, studId: '0:1' },
      { x: 1.3, z: 1.3, studId: '1:1' },
      { x: 1.7, z: 1.3, studId: '1:1' },
      { x: 1.7, z: 1.7, studId: '1:1' },
      { x: 1.3, z: 1.7, studId: '1:1' },
    ]
    const centered = solveAffineContactReactions(points, 2.8, { x: 1, z: 1 })
    const eccentric = solveAffineContactReactions(points, 2.8, { x: -0.5, z: 1 })
    const farther = solveAffineContactReactions(points, 2.8, { x: -1.5, z: 1 })

    expect(centered?.maxStudTension).toBe(0)
    expect(centered?.forceResidual).toBeCloseTo(0, 10)
    expect(eccentric?.forceResidual).toBeCloseTo(0, 10)
    expect(eccentric?.momentResidual.x).toBeCloseTo(0, 10)
    expect(eccentric?.momentResidual.z).toBeCloseTo(0, 10)
    expect(eccentric?.maxStudTension ?? 0).toBeGreaterThan(0)
    expect(farther?.maxStudTension ?? 0).toBeGreaterThan(eccentric?.maxStudTension ?? 0)
  })

  it('combines per-stud shear and overturning tension in one friction budget', () => {
    const points: StudContactPoint[] = [
      { x: -0.2, z: -0.2, studId: 'stud' },
      { x: 0.2, z: -0.2, studId: 'stud' },
      { x: 0.2, z: 0.2, studId: 'stud' },
      { x: -0.2, z: 0.2, studId: 'stud' },
    ]
    const createLoad = (applicationHeight: number) => ({
      verticalLoad: 0.2,
      verticalLoadCenter: { x: 0, z: 0 },
      horizontalForce: { x: 0.2, z: 0 },
      horizontalLoadCenter: { x: 0, z: 0 },
      applicationHeight,
    })
    const lowLoad = solveStudConnection(points, createLoad(0.2))
    const tallLoad = solveStudConnection(points, createLoad(2))

    expect(tallLoad?.tensionUtilization ?? 0).toBeGreaterThan(lowLoad?.tensionUtilization ?? 0)
    expect(tallLoad?.shearUtilization).toBeCloseTo(lowLoad?.shearUtilization ?? 0, 10)
    expect(tallLoad?.utilization ?? 0).toBeGreaterThan(
      Math.max(tallLoad?.tensionUtilization ?? 0, tallLoad?.shearUtilization ?? 0),
    )
  })

  it('is deterministic and produces a weighted bridge-game score', () => {
    const bricks = createStableStack()
    const first = runDisasterSimulation(bricks, { scenario: 'earthquake', intensity: 82 })
    const second = runDisasterSimulation(bricks, { scenario: 'earthquake', intensity: 82 })

    expect([...first.failureTimeByBrickId]).toEqual([...second.failureTimeByBrickId])
    expect([...first.failureModeByBrickId]).toEqual([...second.failureModeByBrickId])
    expect(first.score).toBe(second.score)
    expect(first.score).toBeGreaterThanOrEqual(0)
    expect(first.score).toBeLessThanOrEqual(100)
    expect(first.initialStaticFailureCount).toBe(0)
    expect(Object.keys(first.scoreBreakdown)).toEqual(['survival', 'staticStability', 'span', 'materialEfficiency'])
  })

  it('propagates the failure of a detached component', () => {
    const [base, top] = createStableStack()
    const detached = { ...top, id: 'detached-test', pose: { ...top.pose, yStud: 5 } }
    const result = runDisasterSimulation([base, detached], { scenario: 'wind', intensity: 35 })
    const finalFrame = getDisasterFrame(result, result.options.durationSeconds)

    expect(result.failureTimeByBrickId.get(detached.id)).toBe(0)
    expect(result.failureModeByBrickId.get(detached.id)).toBe('detached')
    expect(finalFrame.failedIds.has(detached.id)).toBe(true)
    expect(finalFrame.offsetsByBrickId.get(detached.id)?.y).toBeLessThan(0)
  })

  it('applies stronger visible displacement at higher intensity', () => {
    const bricks = createStableStack()
    const low = runDisasterSimulation(bricks, { scenario: 'wind', intensity: 20, physicsProfile: 'realistic' })
    const high = runDisasterSimulation(bricks, { scenario: 'wind', intensity: 50, physicsProfile: 'realistic' })
    const lowFrame = getDisasterFrame(low, 2)
    const highFrame = getDisasterFrame(high, 2)
    const topId = bricks[1].id
    const lowOffset = lowFrame.offsetsByBrickId.get(topId)?.x ?? 0
    const highOffset = highFrame.offsetsByBrickId.get(topId)?.x ?? 0

    expect(Math.abs(highOffset)).toBeGreaterThan(Math.abs(lowOffset))
  })

  it('applies wind load using the projected area from the selected direction', () => {
    const wall = [
      makeBrick('brick-2x8', 'gray', 0, 0, 0),
      makeBrick('brick-1x6', 'gray', 1, 1.2, 0),
      makeBrick('brick-1x6', 'gray', 1, 2.4, 0),
      makeBrick('brick-1x6', 'gray', 1, 3.6, 0),
    ]
    const narrowSide = runDisasterSimulation(wall, { scenario: 'wind', intensity: 30, directionDegrees: 0, physicsProfile: 'realistic' })
    const broadSide = runDisasterSimulation(wall, { scenario: 'wind', intensity: 30, directionDegrees: 90, physicsProfile: 'realistic' })
    const topId = wall.at(-1)!.id
    const narrowStress = narrowSide.peakStressByBrickId.get(topId) ?? 0
    const broadStress = broadSide.peakStressByBrickId.get(topId) ?? 0

    expect(broadStress).toBeGreaterThan(narrowStress * 2)
  })

  it('only loads the first brick hit by a fully blocked wind ray', () => {
    const front = makeBrick('brick-1x2', 'gray', 0, 0, 0)
    const rear = makeBrick('brick-1x2', 'gray', 3, 0, 0)
    const result = runDisasterSimulation([front, rear], {
      scenario: 'wind',
      intensity: 20,
      directionDegrees: 0,
      physicsProfile: 'realistic',
    })

    expect(result.windExposureByBrickId.get(front.id)?.exposedRatio).toBe(1)
    expect(result.windExposureByBrickId.get(rear.id)?.exposedRatio).toBe(0)
    const frame = getDisasterFrame(result, 2)
    expect(Math.abs(frame.offsetsByBrickId.get(front.id)?.x ?? 0)).toBeGreaterThan(0)
    expect(frame.offsetsByBrickId.get(rear.id)?.x).toBe(0)

    result.failureTimeByBrickId.set(front.id, 1)
    const unshieldedFrame = getDisasterFrame(result, 2)
    expect(unshieldedFrame.windExposureByBrickId.get(rear.id)?.exposedRatio).toBe(1)
    expect(Math.abs(unshieldedFrame.offsetsByBrickId.get(rear.id)?.x ?? 0)).toBeGreaterThan(0)
  })

  it('scales wind load by the visible fraction of a partially blocked face', () => {
    const front = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const rear = makeBrick('brick-2x2', 'gray', 3, 0, 0)
    const result = runDisasterSimulation([front, rear], {
      scenario: 'wind',
      intensity: 70,
      directionDegrees: 0,
    })
    const rearExposure = result.windExposureByBrickId.get(rear.id)

    expect(rearExposure?.exposedRatio).toBeCloseTo(0.5, 1)
    expect(rearExposure?.exposedArea).toBeCloseTo((rearExposure?.projectedArea ?? 0) * 0.5, 1)
  })

  it('only applies direct rain load to the top brick in a covered stack', () => {
    const base = makeBrick('brick-1x2', 'gray', 0, 0, 0)
    const roof = makeBrick('brick-1x2', 'gray', 0, 1.2, 0)
    const result = runDisasterSimulation([base, roof], { scenario: 'rain', intensity: 10 })

    expect(result.rainExposureByBrickId.get(roof.id)?.exposedRatio).toBe(1)
    expect(result.rainExposureByBrickId.get(base.id)?.exposedRatio).toBe(0)
  })

  it('tracks partial roof coverage and exposes lower bricks after the roof fails', () => {
    const base = makeBrick('brick-2x2', 'gray', 0, 0, 0)
    const roof = makeBrick('brick-1x1', 'gray', 0, 1.2, 0)
    const result = runDisasterSimulation([base, roof], { scenario: 'rain', intensity: 10 })

    expect(result.rainExposureByBrickId.get(base.id)?.exposedRatio).toBeCloseTo(0.75, 2)
    result.failureTimeByBrickId.set(roof.id, 1)
    const unshieldedFrame = getDisasterFrame(result, 2)
    expect(unshieldedFrame.rainExposureByBrickId.get(base.id)?.exposedRatio).toBe(1)
    expect(unshieldedFrame.waterAccumulation).toBeGreaterThan(0)
  })

  it('transfers rain load to a cantilever root and rotates the detached span around that connection', () => {
    const place = (id: string, brickId: string, x: number, y: number, z: number) => ({
      ...makeBrick(brickId, 'gray', x, y, z),
      id,
    })
    const footing = place('cantilever-footing', 'brick-2x8', 0, 0, 0)
    const base = place('cantilever-base', 'brick-2x2', 3, 1.2, 0)
    const deck = place('cantilever-deck', 'plate-2x6', 0, 2.4, 0)
    const leftLoad = place('cantilever-left-load', 'brick-2x2', 0, 2.8, 0)
    const middleLoad = place('cantilever-middle-load', 'brick-2x2', 2, 2.8, 0)
    const result = runDisasterSimulation([footing, base, deck, leftLoad, middleLoad], {
      scenario: 'rain',
      intensity: 80,
    })
    const centeredFooting = place('centered-footing', 'brick-2x8', 0, 0, 0)
    const centeredBase = place('centered-base', 'brick-2x2', 2, 1.2, 0)
    const centeredDeck = place('centered-deck', 'plate-2x6', 0, 2.4, 0)
    const centeredLeftLoad = place('centered-left-load', 'brick-2x2', 1, 2.8, 0)
    const centeredRightLoad = place('centered-right-load', 'brick-2x2', 3, 2.8, 0)
    const centeredResult = runDisasterSimulation(
      [centeredFooting, centeredBase, centeredDeck, centeredLeftLoad, centeredRightLoad],
      { scenario: 'rain', intensity: 80 },
    )
    const realisticResult = runDisasterSimulation([footing, base, deck, leftLoad, middleLoad], {
      scenario: 'rain',
      intensity: 100,
      physicsProfile: 'realistic',
    })
    const failureTime = result.failureTimeByBrickId.get(deck.id)

    expect(result.peakStressByBrickId.get(deck.id) ?? 0)
      .toBeGreaterThan((centeredResult.peakStressByBrickId.get(centeredDeck.id) ?? 0) * 1.4)
    expect([...result.failureModeByBrickId.values()]).toContain('rain-peel')
    expect(['rain-peel', 'detached']).toContain(result.failureModeByBrickId.get(deck.id))
    expect(centeredResult.failureModeByBrickId.get(centeredDeck.id)).not.toBe('rain-peel')
    expect(realisticResult.failureModeByBrickId.get(deck.id)).not.toBe('rain-peel')
    expect(result.peakConnectionUtilizationByBrickId.get(deck.id) ?? 0)
      .toBeGreaterThan((realisticResult.peakConnectionUtilizationByBrickId.get(deck.id) ?? 0) * 5)
    expect(result.failureHingeByBrickId.get(deck.id)?.pivot.x).toBeGreaterThan(3)
    expect(result.failureHingeByBrickId.get(deck.id)?.axis.z).toBeGreaterThan(0)
    expect(failureTime).toBeDefined()
    const rotatingFrame = getDisasterFrame(result, (failureTime ?? 0) + 0.5)
    expect(rotatingFrame.rotationsByBrickId.get(deck.id)?.angle ?? 0).toBeGreaterThan(0)
    expect(rotatingFrame.rotationsByBrickId.get(leftLoad.id)?.angle ?? 0).toBeGreaterThan(0)
  })

  it('releases at most one overloaded rain connection per load increment', () => {
    const place = (id: string, brickId: string, x: number, y: number, z: number) => ({
      ...makeBrick(brickId, 'gray', x, y, z),
      id,
    })
    const bricks = [
      place('progressive-footing-a', 'brick-2x8', 0, 0, 0),
      place('progressive-base-a', 'brick-2x2', 3, 1.2, 0),
      place('progressive-deck-a', 'plate-2x6', 0, 2.4, 0),
      place('progressive-load-a', 'brick-2x4', 0, 2.8, 0),
      place('progressive-footing-b', 'brick-2x8', 10, 0, 0),
      place('progressive-base-b', 'brick-2x2', 13, 1.2, 0),
      place('progressive-deck-b', 'plate-2x6', 10, 2.4, 0),
      place('progressive-load-b', 'brick-2x4', 10, 2.8, 0),
    ]
    const result = runDisasterSimulation(bricks, {
      scenario: 'rain',
      intensity: 80,
      physicsProfile: 'challenge',
    })
    const directFailureCountByTime = new Map<number, number>()
    for (const [brickId, time] of result.failureTimeByBrickId) {
      if (result.failureModeByBrickId.get(brickId) === 'detached') continue
      directFailureCountByTime.set(time, (directFailureCountByTime.get(time) ?? 0) + 1)
    }

    expect(directFailureCountByTime.size).toBeGreaterThan(1)
    expect(Math.max(...directFailureCountByTime.values())).toBe(1)
  })

  it('classifies wind failures from overturning moment separately from shear', () => {
    const tower = [
      makeBrick('brick-2x8', 'gray', -3, 0, 0),
      makeBrick('brick-2x2', 'gray', 0, 1.2, 0),
      makeBrick('brick-1x1', 'gray', 0.5, 2.4, 0.5),
      makeBrick('brick-1x1', 'gray', 0.5, 3.6, 0.5),
      makeBrick('brick-1x1', 'gray', 0.5, 4.8, 0.5),
    ]
    const result = runDisasterSimulation(tower, {
      scenario: 'wind',
      intensity: 100,
      directionDegrees: 0,
    })
    const realistic = runDisasterSimulation(tower, {
      scenario: 'wind',
      intensity: 100,
      directionDegrees: 0,
      physicsProfile: 'realistic',
    })

    expect([...result.failureModeByBrickId.values()]).toContain('overturn')
    expect(Math.min(...result.failureTimeByBrickId.values()))
      .toBeLessThan(Math.min(...realistic.failureTimeByBrickId.values()))
    expect(result.loadCalibration).toEqual({ baseValue: 30, unit: 'm/s', loadMultiplier: 2 })
  })

  it('transfers upper-storey inertia into the supporting connection during earthquakes', () => {
    const tower = [
      makeBrick('brick-2x8', 'gray', -3, 0, 0),
      ...Array.from({ length: 8 }, (_, index) => (
        makeBrick('brick-1x1', 'gray', 0, (index + 1) * 1.2, 0)
      )),
    ]
    const result = runDisasterSimulation(tower, {
      scenario: 'earthquake',
      intensity: 100,
      directionDegrees: 0,
    })
    const realistic = runDisasterSimulation(tower, {
      scenario: 'earthquake',
      intensity: 100,
      directionDegrees: 0,
      physicsProfile: 'realistic',
    })

    expect(result.peakStressByBrickId.get(tower[1].id) ?? 0)
      .toBeGreaterThan(result.peakStressByBrickId.get(tower.at(-1)!.id) ?? 0)
    expect([...result.failureModeByBrickId.values()]).toContain('seismic-overturn')
    expect(realistic.failedBrickCount).toBe(0)
    expect(result.loadCalibration).toEqual({ baseValue: 2, unit: 'g', loadMultiplier: 5 })
  })

  it('stores compact per-step connection loads and interpolates them for timeline playback', () => {
    const bricks = createStableStack()
    const result = runDisasterSimulation(bricks, {
      scenario: 'wind',
      intensity: 70,
      directionDegrees: 0,
      physicsProfile: 'challenge',
    })
    const topId = bricks[1].id
    const history = result.connectionUtilizationHistoryByBrickId.get(topId)

    expect(history).toBeInstanceOf(Float32Array)
    expect(history).toHaveLength(result.simulationStepCount + 1)
    expect([...result.connectionUtilizationHistoryByBrickId.values()].reduce(
      (bytes, values) => bytes + values.byteLength,
      0,
    )).toBe(bricks.length * (result.simulationStepCount + 1) * Float32Array.BYTES_PER_ELEMENT)

    const simulationStep = 1.5
    const frame = getDisasterFrame(
      result,
      result.options.durationSeconds * simulationStep / result.simulationStepCount,
    )
    const expected = (history?.[1] ?? 0) + ((history?.[2] ?? 0) - (history?.[1] ?? 0)) * 0.5
    expect(frame.connectionUtilizationByBrickId.get(topId)).toBeCloseTo(expected, 6)
    expect(result.peakConnectionUtilizationByBrickId.get(topId) ?? 0)
      .toBeCloseTo(Math.max(...(history ?? [])), 5)
    expect(result.governingFailureModeByBrickId.get(topId)).toBeDefined()
  })

  it('applies full self-weight from the first rain frame instead of ramping gravity with rainfall', () => {
    const bricks = createStableStack()
    const result = runDisasterSimulation(bricks, {
      scenario: 'rain',
      intensity: 10,
      physicsProfile: 'realistic',
    })

    expect(result.connectionUtilizationHistoryByBrickId.get(bricks[1].id)?.[0] ?? 0)
      .toBeGreaterThan(0)
  })

  it('tips a ground-connected component under self-weight when its center of mass leaves the support hull', () => {
    const base = makeBrick('brick-1x1', 'gray', 0, 0, 0)
    const deck = makeBrick('brick-1x4', 'gray', 0, 1.2, 0)
    deck.pose.rotationQuarterTurns = 1
    const weights = [2.4, 3.6, 4.8].map((yStud, index) => ({
      ...makeBrick('brick-1x1', 'gray', 3, yStud, 0),
      id: `gravity-cantilever-weight-${index}`,
    }))
    const bricks = [base, deck, ...weights]
    const result = runDisasterSimulation(bricks, {
      scenario: 'wind',
      intensity: 0,
      directionDegrees: 0,
      physicsProfile: 'realistic',
    })

    expect(result.analysis.tippingMargin).toBeLessThan(0)
    expect(result.failureTimeByBrickId.get(base.id)).toBe(0)
    expect(result.initialStaticFailureCount).toBe(bricks.length)
    expect(result.failureModeByBrickId.get(base.id)).toBe('ground-overturn')
    expect(result.failureHingeByBrickId.get(deck.id)?.pivot.y).toBe(0)
    expect(getDisasterFrame(result, 0.5).rotationsByBrickId.get(deck.id)?.angle ?? 0)
      .toBeGreaterThan(0)
  })
})
