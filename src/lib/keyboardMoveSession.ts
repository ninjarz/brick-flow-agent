import type { PlacedBrick } from '../types/bricks'
export type MoveDelta = { xStud?: number; yStud?: number; zStud?: number }

/** One immutable scene, one in-flight collision job and a lossless input queue. */
export const createKeyboardMoveSession = (options: {
  source: PlacedBrick[]
  valid: () => boolean
  validate: (from: PlacedBrick[], steps: MoveDelta[]) => Promise<PlacedBrick[] | undefined>
  preview: (bricks: PlacedBrick[]) => void
  commit: (bricks: PlacedBrick[]) => void
  close: () => void
  error: (error: unknown) => void
}) => {
  const changed = (a: PlacedBrick[], b: PlacedBrick[]) => a.some((brick, index) =>
    Math.abs(brick.pose.xStud - b[index].pose.xStud) > 1e-9 || Math.abs(brick.pose.yStud - b[index].pose.yStud) > 1e-9 || Math.abs(brick.pose.zStud - b[index].pose.zStud) > 1e-9)
  let accepted = options.source
  let pending: MoveDelta[] = []
  let running = false, ended = false, closed = false
  const close = () => { if (!closed) { closed = true; pending = []; options.close() } }
  const flush = async () => {
    if (running || closed) return
    if (!options.valid()) { close(); return }
    running = true
    try {
      while (pending.length && !closed) {
        const steps = pending; pending = []
        const next = await options.validate(accepted, steps)
        if (closed || !options.valid()) { close(); return }
        if (next && changed(next, accepted)) { accepted = next; options.preview(next) }
      }
      if (ended && !closed) {
        if (changed(accepted, options.source)) options.commit(accepted)
        close()
      }
    } catch (error) { if (!closed) { options.error(error); close() } }
    finally { running = false }
  }
  return {
    move(delta: MoveDelta) { if (!closed) { ended = false; pending.push(delta); void flush() } },
    finish() { if (!closed) { ended = true; void flush() } },
    cancel: close,
  }
}
