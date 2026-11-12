import { expandAssemblyProgram } from '../lib/llmAssembly'

self.onmessage = ({ data }: MessageEvent<{ args: Parameters<typeof expandAssemblyProgram> }>) => {
  try { self.postMessage({ bricks: expandAssemblyProgram(...data.args) }) } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
