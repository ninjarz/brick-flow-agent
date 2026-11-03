import { useCallback, useRef, useState, type SetStateAction } from 'react'

/** Async commands must see the latest requested value, even while React is
 * batching pointer events. Evaluate updates once, outside the render phase. */
export const useIntentState = <T,>(initial: T) => {
  const [state, setState] = useState(() => initial)
  const latest = useRef(state)
  const update = useCallback((value: SetStateAction<T>) => {
    const next = typeof value === 'function' ? (value as (current: T) => T)(latest.current) : value
    latest.current = next
    setState(() => next)
  }, [])
  return [state, update, latest] as const
}
