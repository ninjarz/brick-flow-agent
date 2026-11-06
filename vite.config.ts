import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { readFileSync } from 'node:fs'
import { llmProxyPlugin } from './server/llmProxy'

const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

// https://vite.dev/config/
export default defineConfig({
  base: '/brick-flow-agent/',
  // Large scene data stays a JSON string until runtime, keeping Rollup memory bounded.
  json: { namedExports: false, stringify: true },
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  plugins: [react(), llmProxyPlugin()],
  worker: {
    format: 'es',
    // Workers have their own Rollup graph and need the same geometry bound.
    rollupOptions: { maxParallelFileOps: 8 },
  },
  build: {
    rollupOptions: {
      // Bound simultaneous geometry transforms to keep large replica builds
      // within Node's default heap rather than raising its memory limit.
      maxParallelFileOps: 8,
      output: {
        manualChunks(id) {
          // The 3.2 MB castle plan is a static dependency but changes far less
          // often than app code. Isolating it keeps the shell small and gives
          // the plan its own long-lived browser cache entry.
          if (id.includes('/src/data/legoHogwartsPlan.json')) return 'hogwarts-plan'
          if (!id.includes('/node_modules/')) return undefined
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor'
          if (id.includes('/lucide-react/')) return 'icons-vendor'
          return undefined
        },
      },
    },
  },
})
