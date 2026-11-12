import { expect, it, vi } from 'vitest'
import { createStreamedAssembly } from './streamedAssembly'

it('emits completed nested commands before the array finishes and ignores later chunks', () => {
  const emit = vi.fn()
  const push = createStreamedAssembly(emit)
  push('{"comm')
  push('ands":[{"brickId":"brick-1x1","repeat":{"count":[1,1,1],"step":[0,0,0]},"label":"brace }"}')
  expect(emit).toHaveBeenCalledTimes(1)
  expect(emit.mock.calls[0][0].commands).toHaveLength(1)
  push(',{"brickId":')
  expect(emit).toHaveBeenCalledTimes(1)
  push('"brick-1x2"}]}')
  expect(emit.mock.calls[1][0].commands).toHaveLength(2)
  push('\n')
  expect(emit).toHaveBeenCalledTimes(2)
})
