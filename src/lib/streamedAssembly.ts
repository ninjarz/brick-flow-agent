/** Emits only complete command objects from an unfinished JSON commands array. */
export const createStreamedAssembly = (onProgram: (program: { commands: unknown[] }) => void) => {
  let text = ''
  let cursor = 0
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  let foundArray = false
  let finished = false
  const commands: unknown[] = []
  return (chunk: string) => {
    if (finished) return
    text += chunk
    if (!foundArray) {
      const match = /"commands"\s*:\s*\[/.exec(text)
      if (!match) return
      cursor = match.index + match[0].length
      foundArray = true
    }
    let changed = false
    for (; cursor < text.length; cursor++) {
      const char = text[cursor]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') quoted = true
      else if (char === '{') { if (depth === 0) start = cursor; depth++ }
      else if (char === '}' && depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          try { commands.push(JSON.parse(text.slice(start, cursor + 1))); changed = true } catch { return }
          start = -1
        }
      } else if (char === ']' && depth === 0) { finished = true; cursor = text.length; break }
    }
    if (changed) onProgram({ commands: [...commands] })
  }
}
