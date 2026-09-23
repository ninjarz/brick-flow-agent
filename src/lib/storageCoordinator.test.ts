import { afterEach, expect, it } from 'vitest'
import { coordinateStorageWrite, pauseAndDrainStorageWrites, resumeStorageWrites } from './storageCoordinator'

afterEach(resumeStorageWrites)
it('drains existing writes and refuses autosave before clearing can complete', async () => {
  let finish!: (value: boolean) => void
  let persisted = false
  const active = coordinateStorageWrite(async () => {
    await new Promise<boolean>((resolve) => { finish = resolve })
    persisted = true
    return true
  })
  const drain = pauseAndDrainStorageWrites()
  let ranLateWrite = false
  expect(await coordinateStorageWrite(async () => { ranLateWrite = true; return true })).toBe(false)
  expect(persisted).toBe(false)
  finish(true)
  await drain
  expect(await active).toBe(true)
  expect(persisted).toBe(true)
  expect(ranLateWrite).toBe(false)
})
